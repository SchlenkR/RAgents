#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateProcessTree, watchOwnerLifetime } from "../../packages/workspace-executor/src/owner-lifetime.mjs";
import { ensureHostLinks } from "./host-links.mjs";

const AGENT_CLI = "scripts/agent/agent-cli.ts";

export const commands = {
  connect: "scripts/remote/connect.ts",
  start: "scripts/remote/start.ts",
  provision: "scripts/provision/run-provision.ts",
  "workspace-client": "scripts/workspace-client/run-workspace-client.ts",
  plugin: "scripts/plugin/plugin-cli.ts",
  run: AGENT_CLI,
  send: AGENT_CLI,
  journal: AGENT_CLI,
  stop: AGENT_CLI,
  script: AGENT_CLI,
};

const usage = `Usage: ragents <command> [arguments]

  run <folder> "<task>"            start the host without UI, create a run and wait for the end
  send <run> "<text>"              follow-up task in the same run
  journal <run> [--tools]          read the history of a run
  stop <run> | stop --host         cancel the running turn or stop the remembered host
  script <run> [<entry>]           list the run scripts or start one inside the run (--input <json>)
  connect <server-url>             fetch the client profile with its bundles and start the local server with it
  start <profile|path>             start a profile of the package, an own profile file or a
                                   fetched revision; the UI comes prebuilt
  provision [<profile>|--workspace] fetch the plugins' tools
  workspace-client <server-url>    register this machine as a workspace
  plugin build <folder...>         build plugin source folders into bundles (--out, --watch)
  --help, help                     this usage

run, send, journal, stop and script take another profile with --profile <profile|path>: a name
next to the host or the path to an own ragents.config.<profile>.ts. RAGENTS_PROFILE sets
the same for all commands of a shell; if the profile requires sign-in, the user's
personal token goes into RAGENTS_TOKEN.
`;

const main = () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "help") {
    console.log(usage);
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
