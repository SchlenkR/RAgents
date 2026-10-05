import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright-core";
import type { WorkspaceExecutorMachine } from "@ragents/workspace-executor";
import { BROWSER_EXECUTABLE_VARIABLE } from "./contract.js";
import { startBrowserProxy, type BrowserNetworkPolicy, type BrowserProxy } from "./network.js";

type Playwright = typeof import("playwright-core");

const assertWebRtcPolicy = async (page: Page, timeoutMs: number): Promise<void> => {
  await page.goto("chrome://prefs-internals", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const preferences = JSON.parse(await page.locator("body").innerText()) as { webrtc?: { ip_handling_policy?: { value?: unknown }; ip_handling_url?: { value?: unknown } } };
  const overrides = preferences.webrtc?.ip_handling_url?.value;
  if (preferences.webrtc?.ip_handling_policy?.value !== "disable_non_proxied_udp" || !Array.isArray(overrides) || overrides.length !== 0) {
    throw new Error("Chromium did not enforce the required WebRTC network policy.");
  }
};

/** Proxy credentials must never answer an origin's HTTP authentication challenge. */
const authenticateProxy = async (page: Page, proxy: BrowserProxy): Promise<void> => {
  const session = await page.context().newCDPSession(page);
  session.on("Fetch.requestPaused", (event: { requestId: string }) => {
    void session.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => undefined);
  });
  session.on("Fetch.authRequired", (event: { requestId: string; authChallenge: { source?: string; origin: string } }) => {
    const isProxy = event.authChallenge.source === "Proxy" && event.authChallenge.origin === proxy.settings.server;
    void session.send("Fetch.continueWithAuth", {
      requestId: event.requestId,
      authChallengeResponse: isProxy
        ? { response: "ProvideCredentials", username: proxy.settings.username, password: proxy.settings.password }
        : { response: "CancelAuth" },
    }).catch(() => undefined);
  });
  await session.send("Fetch.enable", { handleAuthRequests: true });
};

/** playwright-core lives in the node_modules of this machine's host and is loaded only on call, never with the contribution. */
export const hostPlaywright = async (machine: WorkspaceExecutorMachine, hostRoot: string | undefined): Promise<Playwright> => {
  const loaded = await import(pathToFileURL(machine.hostPackageFile(hostRoot, "playwright-core")).href) as { default: Playwright };
  return loaded.default;
};

/** This machine's Chrome: the one from its environment, otherwise the Chromium that provisioning fetches for playwright-core. */
export const browserExecutable = async (playwright: Playwright, environment: NodeJS.ProcessEnv = process.env): Promise<string> => {
  const configured = environment[BROWSER_EXECUTABLE_VARIABLE];
  const candidate = configured ? configured : playwright.chromium.executablePath();
  if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  throw new Error((configured
    ? `${BROWSER_EXECUTABLE_VARIABLE} names ${configured}; there is no executable browser there on this machine. `
    : `There is no executable browser on this machine: ${BROWSER_EXECUTABLE_VARIABLE} is not set and Chromium is missing at ${candidate}. `)
    + "A workspace fetches Chromium with pnpm provision --workspace, a server with pnpm provision <profile>; "
    + `${BROWSER_EXECUTABLE_VARIABLE} names an existing Chrome, on a server in the profile section ragents.browser, `
    + "on a workspace in its environment.");
};

/** Starts Chrome headless with this machine's environment and the run's marker so the process view can attribute it. */
export const launchChromium = async (
  machine: WorkspaceExecutorMachine,
  hostRoot: string | undefined,
  runId: string,
  timeoutMs: number,
  networkPolicy?: () => Promise<BrowserNetworkPolicy>,
  environment: NodeJS.ProcessEnv = machine.processEnvironment(runId),
): Promise<Browser> => {
  const playwright = await hostPlaywright(machine, hostRoot);
  const executablePath = await browserExecutable(playwright);
  const proxy = networkPolicy === undefined ? undefined : await startBrowserProxy({ policy: networkPolicy, timeoutMs });
  let profile: string | undefined;
  let started: Browser | undefined;
  let cleaning: Promise<void> | undefined;
  const cleanup = (): Promise<void> => cleaning ??= (async () => {
    await proxy?.close();
    if (profile !== undefined) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  })();
  try {
    if (proxy !== undefined) {
      profile = await mkdtemp(path.join(tmpdir(), "ragents-browser-profile-"));
      await mkdir(path.join(profile, "Default"), { mode: 0o700 });
      await writeFile(path.join(profile, "Default", "Preferences"), JSON.stringify({ webrtc: { ip_handling_policy: "disable_non_proxied_udp" } }), { mode: 0o600 });
    }
    const options = {
      executablePath,
      headless: true,
      chromiumSandbox: true,
      timeout: timeoutMs,
      env: environment,
      ...(proxy === undefined ? {} : {
        proxy: proxy.settings,
        args: [
          "--disable-quic",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        ],
      }),
    };
    const persistent = profile === undefined ? undefined : await playwright.chromium.launchPersistentContext(profile, options);
    const browser = persistent === undefined ? await playwright.chromium.launch(options) : persistent.browser();
    if (browser === null) { await persistent!.close(); throw new Error("The restricted browser has no browser process."); }
    started = browser;
    if (proxy !== undefined) {
      await persistent!.setHTTPCredentials(null);
      const check = await persistent!.newPage();
      await assertWebRtcPolicy(check, timeoutMs);
      await check.close();
      const originalNewContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const check = await persistent!.newPage();
        try { await assertWebRtcPolicy(check, timeoutMs); } finally { await check.close(); }
        const context = await originalNewContext(options);
        try {
          await context.setHTTPCredentials(null);
          const originalNewPage = context.newPage.bind(context);
          context.newPage = async () => {
            const page = await originalNewPage();
            await authenticateProxy(page, proxy);
            return page;
          };
          const page = await context.newPage();
          await page.goto(proxy.authenticationUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          await page.close();
          return context;
        } catch (error) {
          await context.close();
          throw error;
        }
      };
      const originalClose = browser.close.bind(browser);
      browser.close = async (options) => {
        try { await originalClose(options); } finally { await cleanup(); }
      };
      browser.once("disconnected", () => { void cleanup().catch((error) => console.error("Browser network cleanup failed:", error)); });
    }
    return browser;
  } catch (error) {
    await started?.close();
    await cleanup();
    throw error;
  }
};
