---
name: ragents
description: Start RAgents locally and have it program a project - bring up the host, bind a run to a project folder, send tasks, and read the journal.
---

# Commissioning RAgents as a programmer

RAgents is a workshop for AI agents. `ragents run` starts the host on this machine,
binds a run to a project folder, and lets a coordinator work in it: reading,
writing, bash, diagnostics via Roslyn (C#), FSAC (F#), and the TypeScript language server.
For each language, `<language>_open` opens one instance per root; several roots stay open side by
side, for example two solutions, and `<language>_close` shuts one of them down again.

## Prerequisites

- Node 22 and the package `@schlenkr/ragents` (`npm install -g @schlenkr/ragents`) or a
  checkout of the repository; there the same commands are called `pnpm ragents ...`.
- `dotnet` (.NET 10 SDK) for diagnostics of C# and F#; without it, only TypeScript remains.
- Model access: either `OPENROUTER_API_KEY` in the shell, or `ragents connect <server-url>`
  against a RAgents server that provides the models.
- Once per machine: `ragents provision developer` fetches language servers and tools into
  `~/.local/share/ragents/developer/tools/`. A second call downloads nothing more.

The `developer` profile runs without sign-in on port 4715, with data under
`~/.local/share/ragents/developer`. `PORT` and `DATA_DIR` override both.

## The five commands

```sh
ragents run /path/to/project "Fix the type error in src/broken.ts and run typescript_diagnostics"
ragents send 7f3c1e64-... "Read README.md and name the password"
ragents journal 7f3c1e64-... --tools
ragents stop 7f3c1e64-...        # interrupt the running turn of the primary actor, the run stays active
ragents stop 7f3c1e64-... --run  # emergency stop: cancel all turns, stop all actors
ragents stop --host              # shut down the remembered host
ragents script 7f3c1e64-... demo.review  # start a run script inside the running run (ragents script <run> lists them)
ragents --help                   # the usage, like ragents help
```

`run` starts the host if nothing answers at its address, creates the run with the absolute
folder as an existing folder on the server (the server runs on the same machine), sends the task,
and blocks until the turn is over. `--profile <profile|path>` selects a different profile,
`--entry <template>` additionally starts the run via a skill or script template.
`--workstation <id>` instead binds the folder on the workspace signed in to the host
with this id (`pnpm workspace-client <server-url> <folder> --id <id>`); `<folder>` is
then its path there. If no such workspace is signed in, `run` aborts with a cause.
The folder is optional: `ragents run "<task>" --entry <template>` selects no binding; then
the profile's default or the template's fixed binding applies. A single value is always the
task. If the template fixes the binding, a named folder is an error with a cause;
`--workstation`, on the other hand, always needs a folder.
`send` continues working in the same run and waits the same way. Both follow the turn via the server,
like the web app and VS Code; this also works when `RAGENTS_URL` points to a server on another machine.
`journal` reads the history from the profile's data folder, with `RAGENTS_URL` from the server
(there with the right `runs.inspect`); `--tools` shows the tool calls instead of the conversation.

## Reading output and exit code

stdout shows the tool calls with name and duration, as far as the server shows them to your user
(right `runs.inspect`), and the model's answer; stderr shows the command's messages
(host start, run id, reason for cancellation). `journal --tools` reads the tools' inputs:

```
> read
< read 0.4s ok
> bash
< bash 12.1s ok
The type error came from greet(42); now it says greet("42").
run: 7f3c1e64-9a2b-4d11-8c30-1f5e9a77c001
```

The last line is always `run: <id>` - `send`, `journal`, and `stop` continue with it.
`--json` returns the same steps as JSON instead of the lines, one per line (`tool`, `tool-end`,
`output`, finally `turn`).
Exit code: `0` the turn is finished, `2` it was cancelled, `1` it failed or the
connection to the host is gone; then the command names the cause instead of waiting, and the turn may
keep running on the server; `journal` shows its state. An exit code `0` means that the turn ended cleanly, not that the
task itself is fulfilled; you check that yourself from the result in the project folder.

## A custom profile

`--profile` takes a name next to the host **or** the path to your own
`ragents.config.<profile>.ts` anywhere; `RAGENTS_PROFILE` sets the same for all
commands. If the profile requires sign-in (`users`), `RAGENTS_TOKEN` holds the user's personal
token that the profile names as `token: env("...")`:

```sh
export RAGENTS_TOKEN="$MY_RAGENTS_TOKEN"
ragents run <folder> "Implement work item 1234" --profile <path>/ragents.config.custom.ts --entry custom.tickets.implement-task
ragents stop --host --profile <path>/ragents.config.custom.ts
```

If the profile creates its workspace itself (no `ragents.workspace`), `<folder>` stays
unbound; the command says so on stderr and the run runs anyway.

An ad hoc profile is a copy: put `ragents.config.developer.ts` next to the template, rename it to
`ragents.config.<name>.ts`, and change `PORT`, `PRODUCT_PROFILE`, `PRODUCT_ID`,
`PLUGINS`, and the models in it. Then `ragents provision <name>` and
`ragents run <folder> "..." --profile <name>`. The vocabulary of the profile file - sections,
`env(...)`, `provisioned(...)`, `anonymousUser`, `users` - is in `docs/spec/profiles.md`.

## What you do not do

- Do not write secrets into a profile file; a key appears there as `env("NAME")` and
  its value in the shell. The profile file rejects plaintext secrets at startup.
- Do not shut down the host with `pkill`, `killall`, or a process pattern. `ragents stop --host`
  takes the PID from `<data folder>/host.json` and thus hits exactly the remembered process - even
  for a host from `ragents start`, which writes the same file.
- Do not start a second host on the same port; an occupied port is a hard startup error.
- Do not restructure the project folder yourself in parallel while a turn is running.
