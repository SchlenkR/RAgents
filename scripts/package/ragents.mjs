#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateProcessTree, watchOwnerLifetime } from "../../packages/workspace-executor/src/owner-lifetime.mjs";
import { ensureHostLinks } from "./host-links.mjs";

const AGENT_CLI = "scripts/agent/agent-cli.ts";

export const commands = {
  acp: "scripts/acp/acp-cli.ts",
  connect: "scripts/remote/connect.ts",
  start: "scripts/remote/start.ts",
  provision: "scripts/provision/run-provision.ts",
  "workspace-client": "scripts/workspace-client/run-workspace-client.ts",
  plugin: "scripts/plugin/plugin-cli.ts",
  run: AGENT_CLI,
  send: AGENT_CLI,
  journal: AGENT_CLI,
  stop: AGENT_CLI,
  resume: AGENT_CLI,
  script: AGENT_CLI,
  share: AGENT_CLI,
};

const usage = `Usage: ragents <command> [arguments]

  acp [--profile <p>]             serve Agent Client Protocol v1 over stdio for an editor
  run <folder> "<task>"            start the host without UI, create a run and wait for the end
                                   (--share <user>[:read|:write], --share-all <read|write>)
  send <run> "<text>"              follow-up task in the same run; continues a paused run
  journal <run> [--tools]          read the history of a run
  stop <run> [--turn|--run]        pause the whole run; --turn ends only the running turn of the
                                   primary actor, --run is the emergency stop
  stop --host                      stop the remembered host
  resume <run>                     continue a paused run without a message
  script <run> [<entry>]           list the run scripts or start one inside the run (--input <json>)
  share <run> [<user>[:read|:write]...] [--all <read|write>] [--none]
                                   print or replace whom a run is shared with
  connect <server-url>             fetch the client profile with its bundles and start the local server with it
  start <profile|path>             start a profile of the package, an own profile file or a
                                   fetched revision; the UI comes prebuilt
  provision [<profile>|--workspace] fetch the plugins' tools
  workspace-client <server-url>    register this machine as a workspace
  plugin build <folder...>         build plugin source folders into bundles (--out, --watch)
  --version, -v                    the installed version
  --help, help                     this usage

run, send, journal, stop, resume, script and share take another profile with --profile <profile|path>: a name
next to the host or the path to an own ragents.config.<profile>.ts. RAGENTS_PROFILE sets
the same for all commands of a shell; if the profile requires sign-in, the user's
personal token goes into RAGENTS_TOKEN.
`;

/** In the package and the standalone archive its own manifest, in a checkout the root one. */
const packageVersion = (root) => {
  const file = path.join(root, "package.json");
  const version = JSON.parse(readFileSync(file, "utf8")).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) throw new Error(`${file} names no version`);
  return version;
};

const main = () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "help") {
    console.log(usage);
    process.exit(0);
  }
  if (command === "--version" || command === "-v") {
    console.log(packageVersion(root));
    process.exit(0);
  }
  const script = command ? commands[command] : undefined;
  if (!script) {
    console.error(command ? `Unknown command: ${command}\n\n${usage}` : usage);
    process.exit(1);
  }
  ensureHostLinks(root);
  const passed = script === AGENT_CLI ? [command, ...rest] : rest;
  const workspace = command === "workspace-client";
  const detached = rest.includes("--detached");
  const child = spawn(process.execPath, ["--import", "tsx", path.join(root, script), ...passed], {
    cwd: path.join(root, "apps/server"),
    env: { ...process.env, RAGENTS_CWD: process.cwd(), ...(workspace ? { RAGENTS_WORKSPACE_OWNER_PID: String(process.ppid) } : {}) },
    stdio: workspace ? ["ignore", "inherit", "inherit", "ipc"] : "inherit",
    detached: workspace && process.platform !== "win32",
  });
  if (workspace) {
    let stopReason;
    let deadline;
    const requestStop = () => {
      if (child.connected && stopReason) child.send({ type: "workspace-stop", reason: stopReason }, () => undefined);
    };
    const release = watchOwnerLifetime({ detached, onStop: (reason) => {
      stopReason = reason;
      requestStop();
      deadline = setTimeout(() => { if (child.pid) terminateProcessTree(child.pid); }, 20_000);
    } });
    child.on("message", (message) => { if (message?.type === "workspace-ready") requestStop(); });
    child.once("exit", () => {
      release();
      clearTimeout(deadline);
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
    });
  }
  const forward = (signal) => () => child.kill(signal);
  if (!workspace) {
    process.on("SIGINT", forward("SIGINT"));
    process.on("SIGTERM", forward("SIGTERM"));
  }
  child.once("error", (error) => {
    console.error(`ragents ${command} could not be started: ${error.message}`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
};

// npm installs the command as a link; the comparison therefore needs the real path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
