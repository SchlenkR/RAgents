# Web and VS Code

Use the same runs in the browser and in the VS Code extension; automate them through the API and command-line tools.

## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows a run in a narrow layout with mini-app chips, the selected app, actor chips, chat, and the
tab bar on the right. Without `run`, it shows the run list with "Neuer Run" as the first
card. `run-panel.html?layout=app&run=<id>&element=<app-id>` shows one mini-app without the tab bar.
Run-panel state, including the selected app and actor, view mode, chat width, collapsed chat
height, open tab, and tab-area height, is stored per run in the browser.

The narrow tab bar on the right contains the same tabs as the full web view: files, documents,
functions, executions, and language-server diagnostics, depending on the run and the user's
permissions. The tab name appears in a tooltip. A small counter sits at the top right of its
button, while a dot at the bottom right indicates new activity since the last view. Clicking a
button opens that tab below the chat with its name and an X in the header. Clicking the same
button or the X closes it; another button switches tabs. Drag the top handle or use the up and
down arrow keys to change the area's height. At least 160 pixels remain for the chat. The open
tab and height are stored per run in the browser, per VS Code window, and independently from the
full web view.

Once a mini-app is selected, three header buttons control the run-panel view: "Nur Chat" (chat
only, speech bubble), "Chat unten" (chat below, a sheet over the app), and "Chat rechts" (chat
right, beside the app). "Chat rechts" is the default. While the panel is narrower than the
configured width, that option is disabled and the chat stays below. "Nur Chat" gives the chat the
entire panel: the mini-app
recedes, nothing slides in or out, and an open sheet closes cleanly. Switching back rebuilds the
mini-app, so unsaved input in it is lost. The choice is stored per run and survives a restart.
The extension can also open a mini-app as an editor tab in the center, which works well with
"Nur Chat" in the run panel.

In "Chat unten", the handle controls the expanded chat height. Dragging up makes it taller;
dragging down makes it shorter. The chosen height is stored per run. The collapsed chat always
shows only the handle, status, and complete input, including multiple input lines. Hovering or
writing opens the chat to the chosen height (90 percent of the panel by default). Dragging leaves
the chat open at its new height. Clicking the handle opens or closes it. With
keyboard focus on the handle, up and down change the height, Home and End select its limits, and
Escape cancels an active drag.

The collapsed chat keeps its rounded border, background, and shadow. The compact handle row
shows keyboard focus on the small grip itself.

The extension lives under `apps/vscode`. It works with all configured **servers at the same
time**; there is no single active connection. A server in the `ragents.connections` setting is
either a server (`name` and `url`; it connects automatically when activated and its card asks
for sign-in in the panel) or a local profile (`name` and `profileFile`, the path to a
`ragents.config.<profile>.ts`). When activated, the extension starts a local profile silently in
the background with `--port 0`. The page shows "startet" (starting) and then "bereit" (ready), so its card and
templates are immediately available; a stopped local profile can be started again from its chip. The
host runs until the VS Code session ends and terminates with it, even if the window reloads, VS
Code crashes, or it is forcibly closed. Before starting, the extension provisions the profile's
tools; the web interface comes finished with the host. With a checkout as host, the host refuses
to start while its built-in bundles or its web interface are outdated and names the build
command. If a server distributes a client profile, the extension
fetches it after sign-in like `pnpm connect`, starts its host locally, and supplies the token as
`RAGENTS_TOKEN`. If `ragents.hostPath` is empty and the extension is not running from a checkout,
as with an installed `.vsix`, it downloads the host itself:
`npm install --prefix <globalStorage>/hosts/<paketfassung> @schlenkr/ragents@<paketfassung>`,
using the `npm` available on `PATH`. For a distributing server, that server specifies the version
through `ragents.profile.describe`; for a local profile, the extension supplies its own
`ragents.packageVersion` from `package.json`, keeping extension and host compatible. npm progress
and output appear in the `RAgents` output channel. Downloaded versions remain installed, and a
failure appears as the reason in the server row. A local profile therefore no longer needs
a checkout. `ragents.hostPath` remains an override pointing to a checkout or installed package.
The status bar shows the number of connected servers and opens the start page when clicked. See
the root `README.md` for details.

Install the extension from the Marketplace as `purestate.ragents-vscode` using "Extensions:
Install Extension" or `code --install-extension purestate.ragents-vscode`. To install a locally
packaged file, run `pnpm package:vscode` (task `vscode: package`), which builds
`dist/ragents-vscode-<version>.vsix`, then use "Extensions: Install from VSIX" or
`code --install-extension dist/ragents-vscode-<version>.vsix --force`. The `vscode: install`
task (`scripts/vscode/install-local.sh`) performs both steps, rebuilds the built-in plugins, and
rebuilds the web interface if it no longer matches its sources, so that hosts from this checkout
start again. The script then restarts manually launched
servers (`scripts/start.sh`, identified by `RAGENTS_LAUNCH=start.sh` in their environment, with logs under
`<data-directory>/logs/server-<time>.log`) and waits for `/health`. Hosts started by the extension
are left alone and restart with the reload. Afterward, reload VS Code with "Developer: Reload
Window" and reopen the run panel. If `code` is not on `PATH`, it is available at
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`. An installed extension
needs no checkout; it fetches the host from `@schlenkr/ragents` when first required by a
distributing server.

The extension is an app with four pages: Start, Runs, the run panel, and "Server". All appear in
the RAgents panel of VS Code's secondary sidebar. Navigation and commands live in the view title
bar, following VS Code conventions: Start (home), Runs (list), Server (gear), "Neuer Run" (new run), and "Aktualisieren" (refresh). They remain available
while the panel shows a run. Start has no separate page header; Runs and Server show their
title next to a back arrow to Start, and the run panel's back
arrow also returns there. There is no Explorer tree in the activity bar. The view badge counts
pending inputs across all servers.

**Start** begins with **Server**. Equal-width chips appear two per row at 420 pixels and in
a single row from 560 pixels. Each chip is a split button. Its left side shows a status icon,
name, and when needed an action label: none for a connected or ready server (clicking opens
Runs filtered to it), "Anmelden" (sign in) when authentication is required or access was denied,
"Erneut versuchen" (try again) when unreachable or failed, "Starten" for a stopped local profile,
and "Verbinden" (connect) for a stopped server. "startet ..." (starting) is not a button. A monospace line below identifies the server:
`local / <profile>` for a local profile, the server host and non-default port, or `<host> / local`
when a server distributes a client profile whose host runs here.

The right side contains a plus button for a new run. If the server's profile defines
`defaultStartEntry` (see [profiles.md](../spec/profiles.md)), it starts that template; otherwise it
starts an empty chat. Without permission to start, an equally wide empty space remains. For a
failed, unreachable, or rejected server, its status icon is also a button. It opens a
popover with the status, full selectable message, "Ausgabe öffnen" (open output), and either
"Erneut versuchen" or "Anmelden". A lock opens the same sign-in dialog.

Below that, **Weiter** (continue) shows the five most recent runs from all servers in a fixed-column
grid with status, title, right-aligned time, and, when more than one exists, server. "Alle N
Runs" opens the Runs page. **Neu** (new) appears when at least one server is reachable and permits
new runs. Entries are grouped by server when needed. The first entry is its default template,
marked "Standard" (default), or "Neuer Chat" (new chat) in the "Ohne Vorlage" (without template)
category. Remaining templates follow,
without duplicating the default. Clicking an entry creates and starts the run on its server
and opens the run panel.

The new run uses your open folder as its workspace, asking you to choose when several are open.
If the template defines its own workspace, such as one server folder per run, VS Code does not
ask. Until content appears, the panel shows a progress bar and the current step: starting,
loading, preparing, or setting up. A startup or setup error appears in the same place while the
chat input remains usable. The loading state disappears with the first mini-app or chat item; an
empty chat without a template does not show it. VS Code never displays the run panel's run-list
view. If a run cannot be started, for example because the user may not create runs, the panel
explains why and offers "Zur Start-Seite" (back to Start). For a new run, the visible chat input receives focus as
soon as it becomes writable. Opening an existing run does not move focus there automatically.

**Runs** shows the complete list in the same grid, with search, "Beendete ausblenden" (hide finished), a server
filter carried over from Start, and a selection mode that deletes several runs after a dialog
confirmation. Checkboxes occupy an additional first column without shifting the others.

**Server** is the configuration page. You can add, edit, sign in, sign out, connect,
disconnect, and remove servers with confirmation, then open `settings.json` from the link
at the bottom.

Every status uses a colored icon and a tooltip with the same vocabulary everywhere. A run is
"läuft" (running), "wartet auf Eingabe" (waiting for input, with the number of open inputs),
"ruht" (idle), "beendet" (ended), "fehlgeschlagen" (failed), or "abgebrochen" (cancelled). A
server is "verbunden" (connected), "bereit" (ready), "startet" (starting), "Anmeldung nötig"
(sign-in required), "nicht erreichbar" (unreachable), "gestoppt" (stopped), "gescheitert"
(failed), or "kein Zugriff" (no access). Time is compact and omits "vor" (ago): `jetzt`, `5 min`,
`3 h`, `2 d`, then a date after seven days. A function or mini-app name never appears as a status.
Status icons never resemble a stop button: cancelled is a slashed circle, ended a check mark, and
idle or stopped an empty circle. Actual stop buttons consistently use a filled red square: "Run
stoppen" (stop run) in the run-panel header and run menu, "Arbeit stoppen" (stop work) beside the
chat input, and the stop controls for run processes.

Stopping work in a chat and stopping the run are different things. "Arbeit stoppen" appears in a
chat input only while that chat's own actor has a turn running, and it interrupts just that turn:
the text already written stays, running function calls are cancelled, and the actor stays active
and answers the next message. Actors it has started keep working, and when only another actor is
busy, the input pulses but offers no stop. To end everything, use "Run stoppen" (stop run) with its
confirmation; to stop a single actor for good, use "Stop" on its actor card. If a chat's actor has
been stopped, the input is replaced by `@handle gestoppt: <reason>` and, with permission to operate
and inspect the run, "Neu starten" (restart). Restarting the former primary actor makes it the
primary actor again, and the run chat continues.

The arrow on a mini-app in the run-panel stage opens it as a central editor tab; "Zurück ins Panel"
(back to the panel) closes the tab. Text artifacts and the journal open as read-only documents, while other artifacts
open in the browser. `RAgents: Neuer Run` uses a Quick Pick grouped by server and template.
The first entry for each server is its default, marked "Standard", or the free task without
a template. The commands `RAgents: Trennen` (disconnect), `RAgents: Verbinden` (connect), and
`RAgents: Abmelden` (sign out) apply to the selected run's server or ask when several match.

When the run chat has focus, VS Code shortcuts such as Cmd/Ctrl+P and Cmd/Ctrl+Shift+P still
work using your keybindings. Text entry, selection, undo, and clipboard actions remain in the
input field. Keys already handled by chat, such as Enter to send, are not also executed as VS
Code commands.

If a server profile requires users, both the lock on Start and the Server row open the
same sign-in dialog. For a profile with `ACCESS_TOKEN`, the dialog requests that token. User name
and password are stored per server address in VS Code SecretStorage and reused silently next
session. The session token is stored there as well and sent as a bearer token; iframes receive it
in their URL (the server accepts a bearer token or the `access` query parameter for GET requests).
After expiry or a server restart, that server asks for sign-in again without affecting others.
`RAgents: Abmelden` revokes the session.

## Control RAgents as an agent

An AI agent working on the same machine controls RAgents through four `ragents` subcommands. In
a checkout, use `pnpm ragents <command>`. These commands are the agent-facing contract: each one
waits for the turn to end and returns an exit code.

```sh
ragents provision developer                                  # once per machine
ragents run selftest/workspace-project "Fix the type error in src/broken.ts"
ragents send <runId> "Read README.md and report the passphrase"
ragents journal <runId> --tools
ragents stop <runId>                                         # interrupt the primary actor's active turn
ragents stop <runId> --run                                   # emergency stop: halt the whole run
ragents stop --host                                          # stop the remembered host
ragents --help                                               # same as ragents help
```

`run` checks `GET <address>/health` to see whether the profile host is already running. If not,
it starts a detached process with its log at `<data-directory>/host.log`, then records the
address and PID in `<data-directory>/host.json`. It creates a run bound to the absolute folder as
an existing folder on the server (binding `{ machine: "server", folder: { path } }` through
`ragents.startOptions.select`), sends the task (`ragents.chat.send`), and follows
the turn triggered by its message until it ends. Like the web interface and VS Code, it subscribes
to the `ragents.run` channel and reads `ragents.runs.view` after every change, so it needs only
`runs.read` and also works against a server with a different data directory or on another machine.
If the profile does not provide `ragents.workspace.binding` because it creates its own workspace,
the folder remains unbound and the command reports this on stderr.

`--workstation <id>` binds the folder on the workstation registered at the host under that ID
instead of the server (binding `{ machine: { client, label }, folder: { path } }`, the label taken
from the registered workstations); `<folder>` is then the path on that workstation. The
counterpart is `pnpm workspace-client <server-url> <folder> --id <id>`. Without a registered
workstation of that ID the command fails and names the registered ones.

`--entry <template>` additionally starts the run through a skill or script template. If that program
chooses its chat partner during setup, the task waits instead of failing. `send` performs the
same operation in an existing run. `journal` reads the history from the profile's data directory
without a server, using the same code as `pnpm driver journal`; with `RAGENTS_URL` set, it reads it
from the server through `ragents.runs.events`, which requires `runs.inspect`. `stop <runId>`
interrupts only the active turn of the run's primary actor through `ragents.runs.interruptTurn`,
exactly like the stop button in the chat input: the run and all actors stay active and accept the
next task, and without an active turn nothing happens. `stop <runId> --run` is the emergency stop (`ragents.chat.stop`): it aborts every turn
and stops all actors of the run. `stop --host` terminates exactly the PID in `host.json`, never a
process pattern, and only if the host at the recorded address reports that same PID from
`/health`; otherwise it fails, leaves the process alone and removes the stale record. `ragents --help` and `ragents help` show usage and exit with 0; invoking the
command without arguments is an error with exit code 1.

`--profile <profile|path>` selects something other than `developer`: a profile name beside the
host or the path to a custom `ragents.config.<profile>.ts` anywhere on disk. Resolution matches
`ragents start` and is relative to the caller. `RAGENTS_PROFILE` selects the same profile for all
commands in a shell. The file name determines the profile name, while the profile file supplies
the port and data directory as it does for the server. `stop --host` can therefore find the host
for that exact profile:

```sh
export RAGENTS_TOKEN="$MY_RAGENTS_TOKEN"
ragents run ~/projects/example "Implement work item 1234" \
  --profile ~/profiles/ragents.config.custom.ts \
  --entry custom.tickets.implement-task
ragents stop --host --profile ~/profiles/ragents.config.custom.ts
```

If the profile requires sign-in through `users`, `RAGENTS_TOKEN` must contain the personal token
declared for that user as `token: env("...")` (see `docs/spec/profiles.md`). A password alone is
not enough because the command has no sign-in dialog. If the token is missing, the command says
that the profile requires authentication and asks you to set `RAGENTS_TOKEN` to the user's
personal token.

stdout contains function calls (`> <name>`, then `< <name> <duration>s ok`, `Fehler`, or
`abgebrochen`) as far as the server shows them to the user (`runs.inspect`), the model response,
and finally the fixed line `run: <id>`. Messages from the command itself go to stderr. With
`--json`, the same steps are emitted as newline-delimited JSON instead (`tool`, `tool-end`,
`output`, and finally `turn`, carrying the objects of the run view). Exit code 0 means the turn
completed; 2 means it was interrupted; 1 means a failed turn or connection problem. If the event
stream or a request breaks while the command waits, it fails with the cause instead of hanging;
the turn may continue on the server.

The address comes from the profile's `host.json`, then `RAGENTS_URL`, then `host.PORT` in the
profile file. When authentication is required, `RAGENTS_TOKEN` is sent as a bearer token. The
data directory is the server's `DATA_DIR`, then `host.DATA_DIR`, then
`~/.local/share/ragents/<profile>`; only `journal` without `RAGENTS_URL` reads from it directly
(`<data-directory>/runs/<runId>/journal.jsonl`). A host started this way also serves the web interface, which comes finished with the host;
`ragents start developer` (or `scripts/start.sh developer` in a checkout) starts it in the
foreground instead. `ragents start` writes the same `host.json` and removes it on shutdown,
so `stop --host --profile <profile|path>` handles either startup path. Only `--port 0` cannot be
remembered because it chooses its own port. The short guide for agents is in
`skills-for-agents/ragents/SKILL.md`.

## Drive runs from external clients

`pnpm driver` (`scripts/driver/run-driver.ts`) creates and controls runs without an interface and
analyzes their journals. It is a testing tool for custom runs and later analysis. An agent should
use `ragents run` instead because it waits and returns meaningful exit codes:

```sh
PRODUCT_PROFILE=showcase pnpm driver new-run                 # creates a run and prints its ID
PRODUCT_PROFILE=showcase pnpm driver send <id> @coordinator "Task ..."
PRODUCT_PROFILE=showcase pnpm driver journal <id> --since 120 --tools
PRODUCT_PROFILE=showcase pnpm driver usage <id>              # model calls and tokens per actor
PRODUCT_PROFILE=showcase pnpm driver stop <id>              # interrupts the primary actor's turn
PRODUCT_PROFILE=showcase pnpm driver stop <id> --run        # emergency stop for the whole run
```

`new-run` starts a run script; without an argument it uses `ragents.reference.shared-actor-list`,
which only `showcase` contains, and `new-run <template>` selects another one.

The address comes from `host.PORT` in the profile file, with `RAGENTS_DRIVER_URL` as an override;
the data directory comes from `DATA_DIR` or the profile default. If the profile defines users,
`RAGENTS_DRIVER_USER` is required. The driver reads that user's password from the same profile
file and signs in through `POST /api/access/login`. If `ACCESS_TOKEN` is set, it sends that as a
bearer token instead. The driver uses `ragents.chat.start`, `ragents.chat.sendToActor`,
`ragents.runs.view` with `ragents.runs.interruptTurn` for `stop`, `ragents.chat.stop` for
`stop --run`, and `ragents.runs.list`, while reading the journal directly from
`${DATA_DIR}/runs/<uuid>/journal.jsonl`.

The same methods are available to any client. The API uses JSON-RPC 2.0. Over HTTP, `POST /rpc`
accepts one message per request, while `GET /rpc/stream` delivers server notifications and
requests as Server-Sent Events:

```sh
curl -s http://localhost:4710/rpc -H 'content-type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"ragents.runs.list","params":{}}'
```

The response contains either `result` or `error`; `error.data` provides `code` and `status`.

Without HTTP, use stdio: `pnpm start -- --stdio` exchanges one JSON message per line through
stdin and stdout and opens no port. The startup modes are:

- `--stdio` without `--port`: stdio only, no HTTP server.
- `--port 0`: a private port; the server reports it on stdout as
  `{"ragents":{"url":"...","token":"...","pid":1234}}`.
- `--port N`: fixed port N instead of `host.PORT` from the profile file.
