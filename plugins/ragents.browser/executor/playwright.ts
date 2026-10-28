import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright-core";
import type { WorkspaceExecutorMachine, WorkspaceProcessContext } from "@ragents/workspace-executor";
import { BROWSER_CHROMIUM_SANDBOX_VARIABLE, BROWSER_EXECUTABLE_VARIABLE } from "./contract.js";
import { startBrowserProxy, type BrowserNetworkPolicy, type BrowserProxy } from "./network.js";

type Playwright = typeof import("playwright-core");

/** What Chromium or Playwright log when this machine cannot set up Chromium's sandbox, such as a hardened container. */
const SANDBOX_FAILURE = /Chromium sandboxing failed|No usable sandbox|sys_chroot|SUID sandbox|Failed to move to new namespace/;

const socketPathError = (socket: string, platform: NodeJS.Platform, cause?: unknown): Error => new Error(
  `Chromium singleton socket path "${socket}" is ${Buffer.byteLength(socket, "utf8")} bytes; `
  + `the ${platform} Unix socket limit is ${platform === "darwin" ? 104 : 108} bytes including the terminator. `
  + "Use a shorter browser temporary directory.", cause === undefined ? undefined : { cause });

export const assertBrowserSocketPath = (socket: string, platform: NodeJS.Platform = process.platform): void => {
  if (platform !== "linux" && platform !== "darwin") return;
  if (Buffer.byteLength(socket, "utf8") >= (platform === "darwin" ? 104 : 108)) throw socketPathError(socket, platform);
};

const browserFailure = (error: unknown, sandboxed: boolean): unknown => {
  const socket = /Socket path too long:\s*([^\r\n]+)/.exec(error instanceof Error ? error.message : String(error))?.[1];
  if (socket !== undefined) return socketPathError(socket.trim(), process.platform, error);
  return sandboxed ? sandboxFailure(error) : error;
};

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

/** Chromium's own sandbox stays on unless this machine's environment turns it off with "0"; the profile's false becomes "0". */
export const chromiumSandbox = (environment: NodeJS.ProcessEnv = process.env): boolean => {
  const configured = environment[BROWSER_CHROMIUM_SANDBOX_VARIABLE];
  if (configured === undefined || configured === "" || configured === "1") return true;
  if (configured === "0") return false;
  throw new Error(`${BROWSER_CHROMIUM_SANDBOX_VARIABLE} is true or false in the profile section ragents.browser `
    + `and "1" or "0" in an environment, not "${configured}".`);
};

/** A launch that aborts in Chromium's sandbox setup names the cause and the setting; it stays an error and never retries. */
const sandboxFailure = (error: unknown): unknown => {
  const line = (error instanceof Error ? error.message : String(error)).split("\n").find((entry) => SANDBOX_FAILURE.test(entry));
  if (line === undefined) return error;
  return new Error(`Chromium's sandbox cannot start on this machine (${line.trim().replace(/^\[pid=\d+\]\[\w+\]\s*/, "").slice(0, 200)}). `
    + `Set ${BROWSER_CHROMIUM_SANDBOX_VARIABLE} to false only when this machine runs in an isolated container: `
    + "a server takes it from the profile section ragents.browser, a workstation as \"0\" from its own environment.", { cause: error });
};

const browserMachServices = async (executable: string, context: WorkspaceProcessContext): Promise<readonly string[]> => {
  const bundle = /^(.*\.app)\/Contents\//.exec(await realpath(executable))?.[1];
  if (!bundle) throw new Error("The isolated macOS browser needs an application bundle. Set BROWSER_EXECUTABLE_PATH to the executable inside a Chrome or Chromium .app, or switch the run to Full access.");
  const launch = await context.sandbox!.wrap({ command: "/usr/bin/plutil", args: ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")] });
  const result = await promisify(execFile)(launch.command, [...launch.args], { cwd: context.root, env: context.env, timeout: 5_000 });
  const identifier = result.stdout.trim();
  if (!/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/i.test(identifier)) throw new Error("The browser application bundle has no valid identifier. Configure an installed Chrome or Chromium, or switch the run to Full access.");
  return ["org.chromium.crashpad.child_port_handshake.*", `${identifier}.MachPortRendezvousServer.*`];
};

/** Starts Chrome headless with this machine's environment and the run's marker so the process view can attribute it. */
export const launchChromium = async (
  machine: WorkspaceExecutorMachine,
  hostRoot: string | undefined,
  runId: string,
  timeoutMs: number,
  networkPolicy?: () => Promise<BrowserNetworkPolicy>,
  environment: NodeJS.ProcessEnv = machine.processEnvironment(runId),
  processContext?: WorkspaceProcessContext,
): Promise<Browser> => {
  const playwright = await hostPlaywright(machine, hostRoot);
  const executablePath = await browserExecutable(playwright);
  const isolated = processContext?.externalAgentEnvironment !== undefined && processContext.sandbox !== undefined;
  const sandboxed = chromiumSandbox() && !isolated;
  const proxy = networkPolicy === undefined ? undefined : await startBrowserProxy({ policy: networkPolicy, timeoutMs });
  let temporary: string | undefined;
  let started: Browser | undefined;
  let cleaning: Promise<void> | undefined;
  let launcher: string | undefined;
  let temporaryAlias: string | undefined;
  const cleanup = (): Promise<void> => cleaning ??= (async () => {
    if (launcher !== undefined) {
      const recorded = await readFile(path.join(launcher, "process.pid"), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (recorded !== undefined) await machine.stopProcessGroup(Number(recorded), "Browser");
    }
    try { await proxy?.close(); }
    finally {
      if (temporary !== undefined) await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      if (launcher !== undefined) await rm(launcher, { recursive: true, force: true });
      if (temporaryAlias !== undefined) await rm(temporaryAlias, { recursive: true, force: true });
    }
  })().catch((error: unknown) => {
    cleaning = undefined;
    throw error;
  });
  try {
    temporary = await mkdtemp(path.join(isolated ? processContext.logDirectory : process.platform === "win32" ? tmpdir() : "/tmp", "ragents-browser-"));
    await chmod(temporary, 0o700);
    temporary = await realpath(temporary);
    let launchTemporary = temporary;
    if (isolated) {
      if (process.platform === "darwin") {
        temporaryAlias = await realpath(await mkdtemp("/tmp/ragents-b-"));
        await chmod(temporaryAlias, 0o700);
        launchTemporary = path.join(temporaryAlias, "tmp");
        await symlink(temporary, launchTemporary, "dir");
      } else {
        launchTemporary = `/tmp/ragents-b-${randomUUID().slice(0, 8)}`;
      }
    }
    assertBrowserSocketPath(path.join(launchTemporary, "org.chromium.Chromium.XXXXXX", "SingletonSocket"));
    const profile = proxy === undefined && !isolated ? undefined : path.join(temporary, "profile");
    if (profile !== undefined) {
      await mkdir(path.join(profile, "Default"), { recursive: true, mode: 0o700 });
      if (proxy !== undefined) await writeFile(path.join(profile, "Default", "Preferences"), JSON.stringify({ webrtc: { ip_handling_policy: "disable_non_proxied_udp" } }), { mode: 0o600 });
    }
    let executable = executablePath;
    if (isolated) {
      launcher = path.join(path.dirname(processContext.home), "launchers", randomUUID());
      await mkdir(launcher, { recursive: true, mode: 0o700 });
      const argumentsFile = path.join(launcher, "command.sh");
      const launch = await processContext.sandbox!.wrap({
        command: "/bin/sh",
        args: [argumentsFile],
        ...process.platform === "darwin" ? {
          directoryAliases: [{ path: launchTemporary, target: temporary }],
          machServices: await browserMachServices(executablePath, processContext),
        } : {},
      });
      const program = path.join(launcher, "launcher.cjs");
      const source = `const fs = require("node:fs");
const { spawn } = require("node:child_process");
fs.writeFileSync(${JSON.stringify(path.join(launcher, "process.pid"))}, String(process.pid), { mode: 0o600 });
const quote = value => "'" + value.replaceAll("'", "'\\\\''") + "'";
const prepare = ${JSON.stringify(process.platform === "linux" ? `ln -s '${temporary.replaceAll("'", "'\\''")}' '${launchTemporary}'\n` : "")};
fs.writeFileSync(${JSON.stringify(argumentsFile)}, prepare + "exec " + ["env", "-u", "ELECTRON_RUN_AS_NODE", ${JSON.stringify(`TMPDIR=${launchTemporary}`)}, ${JSON.stringify(`MAC_CHROMIUM_TMPDIR=${launchTemporary}`)}, ${JSON.stringify(`CFFIXED_USER_HOME=${processContext.home}`)}, ${JSON.stringify(`TMP=${launchTemporary}`)}, ${JSON.stringify(`TEMP=${launchTemporary}`)}, ${JSON.stringify(executablePath)}, ...process.argv.slice(2)].map(quote).join(" ") + "\\n", { mode: 0o600 });
const launch = ${JSON.stringify(launch)};
const child = spawn(launch.command, launch.args, { stdio: [0, 1, 2, 3, 4], env: process.env, cwd: ${JSON.stringify(processContext.root)} });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exit(1); });
child.on("exit", code => process.exit(code ?? 1));
`;
      await writeFile(program, source, { mode: 0o600 });
      executable = path.join(launcher, "chromium");
      const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
      await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(program)} "$@"\n`, { mode: 0o700 });
    }
    const args = [
      ...isolated ? ["--disable-gpu"] : [],
      ...proxy === undefined ? [] : ["--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
    ];
    const options = {
      executablePath: executable,
      headless: true,
      chromiumSandbox: sandboxed,
      timeout: timeoutMs,
      env: { ...environment, TMPDIR: launchTemporary, TMP: launchTemporary, TEMP: launchTemporary,
        ...isolated && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
        ...isolated && process.platform === "darwin" ? { MAC_CHROMIUM_TMPDIR: launchTemporary, CFFIXED_USER_HOME: processContext.home } : {},
      },
      ...args.length > 0 ? { args } : {},
      ...(proxy === undefined ? {} : { proxy: proxy.settings }),
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
    }
    const originalClose = browser.close.bind(browser);
    browser.close = async (options) => {
      try { await originalClose(options); } finally { await cleanup(); }
    };
    browser.once("disconnected", () => { void cleanup().catch((error) => console.error("Browser cleanup failed:", error)); });
    return browser;
  } catch (error) {
    try { await started?.close(); } finally { await cleanup(); }
    throw browserFailure(error, sandboxed);
  }
};
