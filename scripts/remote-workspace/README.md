# Check runner: workspace on another machine

Checks runs whose workspace is on a workspace client, that is, on a foreign machine. The foreign
machine is a Linux container with its own file system, its own process table, its own `localhost`
and a different platform; any access by the server to its own machine thus stands out.

```sh
pnpm check:remote-workspace                 # folder /work/project, which exists only in the container
pnpm check:remote-workspace --shared-path   # the same path also on this machine, with different content
pnpm check:remote-workspace --vscode        # additionally the VS Code host test against the same server
pnpm check:remote-workspace --browser       # additionally browser_navigate on a page in the container
```

Prerequisites: macOS with OrbStack or Docker Desktop (`host.docker.internal` reaches a server on
`127.0.0.1` there), Node 22, a checkout with `pnpm install`. The first image build needs network
(Node image, npm, with `--browser` Chromium from Debian); after that these layers come from the cache.
With `--vscode` a separate VS Code window opens.

## Procedure

1. `scripts/package/build-package.ts` builds the host package from the working tree into a temp folder.
   The `Dockerfile` first installs the dependencies from the package manifest with npm on Linux
   (cached layer), then the package files; `node_modules` of this machine never go into the container.
2. `script-model.ts` starts a model relay on `127.0.0.1` that executes programs instead of a language
   model: a task carries `SCRIPT:<base64url>` with tool calls, the model emits one of them per request
   and then a closing sentence. No cloud access, no randomness.
3. A dedicated server with `--port 0`, its own `DATA_DIR` under `/tmp` and the profile
   `ragents.config.remote-check.ts`: `alice` and `bob` as operators, `admin` with `*`, each with
   password and personal token from the environment, and without `AGENT_MODELS`, so that agent and
   coordinator both name the same model `script`. The profile carries the actor programs, and
   `SKILLS_DIR` points to a folder in the temp folder with the skill `check-notes` and a
   template next to it. The server inherits only `PATH`, `HOME`, language and
   `TMPDIR` of the caller, so no profile key from the shell overrides the check profile.
4. In the container `ragents workspace-client` runs as the workspace of `alice`.
5. The checks go through the message layer (contracts from the plugins' `contract.ts`) and
   `docker exec`; each writes one line `ok`, `FAILED` with cause, or `--` (skipped).

## Checks

- Workspace: registers with platform `linux`, its own machine name and its folder; `bob` and
  `admin` do not see it; `bob` cannot bind a run to it (`workspace-client-disconnected`).
- Run: `alice` binds a run to the folder in the container.
- Tools: `bash` reports Linux, the container and the folder; `read` reads the file from the container;
  `write` writes there and nowhere on the server; `typescript_eval` works in a folder in the
  server's data folder; the system prompt names Linux and the workspace's folder, but no
  raw line `Current working directory` and not the folder in which the agent runtime works on the
  server; the workspace logs the calls; a binary chat attachment is under
  `attachments/` in the container, where `bash` reads it, and neither in the data folder nor in the
  server's copy.
- Server roots: another run of `alice` on the folder in the container creates an
  actor program with `actor_program_create`, reads the template's `package.json`, writes and edits it
  under `@actors/...` and activates it; its domain test passes only after editing, and the activated function returns
  the check run's nonce. The package is in the server's data folder and nowhere in the container,
  the workspace logs only the one `bash` without alias for this run. `bash` with
  `cwd: "@actors/..."` reports the server's platform and machine and `RAGENTS_ACTORS_DIR`, without `cwd`
  Linux in the container without the variable. A task following the skill reads SKILL.md and template through
  `@skills/check-notes/` and runs `bash` there on the server; the system prompt names the skill
  in catalog and preload under `@skills`, no server path, describes the server's
  roots and names `RAGENTS_ACTORS_DIR` only for the bash there.
- New folder: another run of `alice` with a new folder per run on the workspace gets a
  folder under the runs folder in the container; `write` and `bash` work in it, it is not created
  on the server, and deleting the run removes it in the container.
- Files: list and preview show the container; the channel reports a change made via `docker exec`.
- Processes: a marked process in the container appears, a marked decoy process on this
  machine does not; ending takes effect in the container.
- Services: a marked echo service in the container appears with its port; `alice` opens a tunnel
  stream to it, the workspace in the container dials back to the server, and bytes from this machine
  come back unchanged before the stream closes with code 1000; `bob` (`run-not-found`) and `admin`
  (`run-workspace-owner-only`) open no stream.
- Rights: `bob` does not see the run (`run-not-found`); `admin` sees it and its journal, but reads neither
  files nor processes of the workspace (`run-workspace-owner-only`), does not write into it and ends
  no process (`run-owner-only`).
- Stop: the emergency stop by `admin` cleans up the marked processes in the container and on the server;
  `ragents.runs.stopAll` is allowed for them.
- Disconnect: `docker stop` removes the workspace from the registry, the files tab and a tool call
  fail because of it; after `docker start` it registers again and the tools run again.
- Stream loss: `docker network disconnect` takes the network away from the container, the workspace inside lives on;
  `alice` stops the run during this time, the stop succeeds, the marked process in the container keeps running.
  After `docker network connect` the workspace registers again, the server catches up on the stop, and
  the process ends.
- Optional: `--browser` opens a page that runs only on `localhost` in the container; `--vscode` runs
  `apps/vscode/tests/host/launch.mjs` with `RAGENTS_HOST_TEST_WORKSPACE` as `bob`. The script model
  recognizes that test's tasks by their wording (`vscode-step.ts`).

## Cleanup

The runner ends only what it started itself: the server and the VS Code launcher through their
own PID or their own process group (only while its leader lives), containers only
through the label `ragents.remote-workspace-check.session`, images only with its label, processes on
this machine only if their environment carries a run marker of this server or the marker
`RAGENTS_REMOTE_CHECK_SESSION=<runner PID>-<session>`. This also applies on Ctrl-C and errors.
After a hard abort the server ends itself through `RAGENTS_PARENT_PID`; the next check run cleans up
containers, temp folders and processes of a dead runner at its start. If a
check fails, the logs (server, workspace, script model, image, VS Code) remain under
`/tmp/ragents-rwc-logs-<session>`.

The VS Code test instance runs with its own `--user-data-dir` and `--extensions-dir` and inherits no
`VSCODE_*` or `ELECTRON_*` variables; it therefore cannot attach to any running instance. If
its launcher aborts, it ends the instance through its own PID.

## Files

| File | Content |
| --- | --- |
| `run-remote-workspace-check.ts` | entry point, procedure, cleanup |
| `checks.ts` | the checks |
| `script-model.ts` | the script model as a model relay |
| `container.ts`, `Dockerfile` | package, image and container |
| `processes.ts` | start, end and find own processes |
| `vscode-step.ts` | the optional VS Code step |
| `report.ts` | lines and summary |
| `ragents.config.remote-check.ts` | the check profile |

Type check: `pnpm exec tsc -p scripts/remote-workspace/tsconfig.json`.
