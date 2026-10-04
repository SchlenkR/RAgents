import "../../apps/server/src/host-resolution.ts";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { readHostRecord, writeHostRecord } from "../../apps/server/src/host-record.ts";
import { hostRoot } from "../../apps/server/src/host-version.ts";
import { selectProfileTarget, type ProfileTarget } from "../../apps/server/src/profile-target.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { RpcError } from "../../packages/ragents/src/rpc/protocol.ts";

export const DEFAULT_PROFILE = "developer";
const HOST_START_TIMEOUT_MS = 120_000;
export const HEALTH_TIMEOUT_MS = 2_000;
export const defaultProfile = (): string => process.env.RAGENTS_PROFILE ?? DEFAULT_PROFILE;

export const loadProfile = (selection: string, root = hostRoot()): Promise<ProfileTarget> => selectProfileTarget(selection, root);

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const healthy = async (baseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
};

export const note = (line: string): void => { process.stderr.write(`${line}\n`); };

const tail = (file: string, lines: number): string =>
  (statSync(file, { throwIfNoEntry: false })?.isFile() ? readFileSync(file, "utf8") : "").split("\n").slice(-lines).join("\n");

/** The remembered host, otherwise RAGENTS_URL, otherwise the address from host.PORT of the profile. */
export const addressOf = async (target: ProfileTarget): Promise<string> => {
  const noted = readHostRecord(target.dataDirectory);
  if (noted && await healthy(noted.url)) return noted.url;
  return process.env.RAGENTS_URL ?? target.baseUrl;
};

const startHost = async (target: ProfileTarget): Promise<void> => {
  mkdirSync(target.dataDirectory, { recursive: true });
  const log = path.join(target.dataDirectory, "host.log");
  const handle = openSync(log, "a");
  const child = spawn(process.execPath, ["--import", "tsx", path.join(hostRoot(), "apps/server/src/main.ts")], {
    cwd: path.join(hostRoot(), "apps/server"),
    detached: true,
    stdio: ["ignore", handle, handle],
    env: {
      ...process.env,
      PRODUCT_PROFILE: target.profile,
      PRODUCT_PROFILE_FILE: target.profileFile,
      PORT: String(target.port),
      DATA_DIR: target.dataDirectory,
    },
  });
  child.unref();
  closeSync(handle);
  if (!child.pid) throw new Error(`The host ${target.profile} could not be started; the log is in ${log}.`);
  note(`== Host ${target.profile} starting on ${target.baseUrl} (log ${log})`);
  const deadline = Date.now() + HOST_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthy(target.baseUrl)) {
      writeHostRecord(target.dataDirectory, {
        profile: target.profile,
        url: target.baseUrl,
        pid: child.pid,
        log,
        startedAt: new Date().toISOString(),
      });
      note(`== Host ready at ${target.baseUrl} (PID ${child.pid})`);
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await delay(500);
  }
  throw new Error(`The host ${target.profile} does not respond at ${target.baseUrl}. End of ${log}:\n${tail(log, 20)}`);
};

export const ensureHost = async (target: ProfileTarget): Promise<string> => {
  const address = await addressOf(target);
  if (await healthy(address)) return address;
  if (process.env.RAGENTS_URL) throw new Error(`No RAgents server responds at ${process.env.RAGENTS_URL} (RAGENTS_URL).`);
  await startHost(target);
  return target.baseUrl;
};

export const hostClient = (baseUrl: string): RpcClient => {
  const token = process.env.RAGENTS_TOKEN;
  return new RpcClient({
    baseUrl,
    fetch: (input, init) => fetch(input, {
      ...init,
      headers: {
        ...init?.headers as Record<string, string> | undefined,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
  });
};

export const LOGIN_REQUIRED = "The profile requires sign-in; set RAGENTS_TOKEN to your user's personal token "
  + "(in the profile `token: env(...)`).";

/** A 401 is not worth a server error message, but a hint to the profile's personal token. */
export const withLoginHint = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (error instanceof RpcError && error.status === 401) throw new Error(`${LOGIN_REQUIRED} ${error.message}`);
    throw error;
  }
};
