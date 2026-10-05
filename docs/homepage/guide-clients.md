# Web and editors

Use the same runs in the browser, VS Code, and ACP editors; automate them through the API and command-line tools.

## MCP server status

When a run has configured MCP servers, "MCP servers" shows each server's transport, negotiated
protocol, state, error, and tool count. Connections open when an agent first resolves its tools.
Errors stay visible; a call to a disconnected server's known tool reports its cause and starts
reconnection. Tool-list changes appear for agents at their next model step.

Agents use these tools like other native tools, named `mcp__<server>__<tool>`. They also receive
server instructions and connection failures in their prompt. Configure servers in the profile
as described in [Connect MCP servers](guide-getting-started.html#connect-mcp-servers).
Stopping or deleting the run closes its MCP connections.

## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows chat with an addressee selector, mini-app tabs, and the inspection bar on the right.
Without `run`, it shows the shared Start page.
`run-panel.html?layout=app&run=<id>&element=<app-id>` shows one mini-app without the tab bar.
The browser docking layout and addressee are stored per run in the browser. Starting or opening
a run focuses its visible chat input once it is ready, including a remembered chat partner.
Clicking or typing elsewhere while it loads cancels that focus request.

With write rights, the run header offers "Run script" right of the window buttons, behind a thin
divider. It opens a scrollable list of the run scripts you may start below the header, as wide as
the window allows up to 800 pixels and ending at its right edge, in two columns when there is room.
The scripts appear as the same compact cards as on the Start page with title, two lines of
description, and an always-visible play icon at the top right; hover or keyboard focus emphasizes
the icon, and the whole card starts the script. Those you can start come first, the others
follow greyed out with the reason when a script cannot
join this run, because its `RUN.md` does not set `embeddable: true` or because it fixes a start
option to a value the run does not have. A click starts it inside the run without a start value;
its card shows a spinner and "Starting ..." in the icon position and the other cards are
locked until the server accepts the start, then the list closes;
the primary actor stays, every start gets a room of its own with its own participants (`name`,
`name-2`, ...), its main view becomes available as an app, and its output and summary appear in
the chat as `@room.handle: ...`. If the start is refused,
the list stays open and shows why. The same labeled button works in the VS Code run panel and
wraps with the other header actions when space is short.

At a workspace width of at least 1000 pixels, the browser places Chat on the left and mini-apps
on the right, each taking half the space. This also happens when the first app appears later.
Narrower workspaces use tabs in one area. The default adapts to width until you arrange windows
yourself; saved custom layouts stay as you left them. The active tab is one filled shape without
a border that holds its grip, maximize, and close buttons. Drag a tab to arrange windows, or drag
the grip on the active tab to move all windows of its area together.
A compass appears over the area under the pointer: its four sides split that area in half,
and its center merges windows as tabs. Dropping on a tab strip also merges. The four outer
workspace guides dock along the whole edge. A translucent rectangle previews the result.
Escape cancels a drag. Each area, including an empty one, is a rounded, thin-bordered card.
Small gaps separate the cards and the workspace edge; the focused card has an accent border.
Drag the three-dot grips in the gaps to resize areas. Vertical gaps have vertical dots,
horizontal gaps horizontal dots. The grips brighten on hover and use the accent color while
dragging. The tab-strip drag grips and sidebar resize grip use the same dots.

Dragging the only window to a side of its own area leaves an empty half. Drop another window
there or use "Close area". Moving all windows into another area removes their empty source.
Each tab's X closes that window. Only empty areas have an additional X, when another area
remains. Chat can be closed too. The run header always lists Chat, every plugin view shown as a
window, and every app as buttons with their existing icons, whether shown or not; the button of a
visible window appears pressed.
Clicking a closed window opens it beside the current area in a wide browser workspace, or as a
tab when narrow. Clicking a window that waits as a background tab brings that tab to the front.
Clicking a visible window changes nothing. All window buttons, "Empty space", "Reset layout",
bar contributions such as "Agents", "Share", "Run script", and the other header icons remain
directly available in the browser and VS Code, regardless of width or window count. Whole
buttons wrap onto further rows when needed, with labels visible within their available width.
The title can shrink or occupy its own row. The header grows and pushes the workspace down;
its controls are never clipped, hidden in a window menu, or placed in a horizontal scroll area.
Each window button has a grip at its left edge, shown on hover or focus and always on touch
screens. Drag a button within the header to reorder the buttons across rows; a thin line marks
where it lands. Drag it into the workspace to get the same compass and edge guides as for a tab:
the drop opens or moves that window there. A press without movement still counts as a click,
and Escape cancels the drag. Alt+Left Arrow and Alt+Right Arrow move a focused button. New
windows join at the end.

After the window buttons, "Empty space" is always directly available.
Clicking it adds an empty pane beside the current area in a wide workspace, or as a tab when
narrow; dragging the button places the pane on a docking guide. You can add several. An empty
pane is a window like any other: move it, split beside it, merge it as a tab, maximize it, or
close it with X, which removes it. It shows "Drag an app or actor here". Dropping a header
button or a tab anywhere on a shown empty pane, or on the compass center labeled "Replace empty
pane", puts that window in its place. Empty panes survive reload.

The "Reset layout" icon after the window buttons and "Empty space"
restores the automatic layout, the button order, and the inspection rail, and removes empty
panes. Maximize appears only with multiple areas, at the right end of the area header just
before the last tab's X; Restore or Escape returns to the split layout. Tabs support arrow
keys, Home, and End, and focused dividers support arrow keys.

Inspection puts its actor selector in the window title row. A second, horizontally scrollable
row holds the actor name, Stop or Restart, chat display switches, and detail-view icons with
tooltips. The conversation has no separate bottom toolbar.

The inspection rail on the right contains files, documents, functions, executions, and
language-server diagnostics according to the run and your permissions. A small blue dot at the
top right of a rail button means the view has content or new activity. Hover or focus a button
to see its tooltip immediately to the left. Hover a button to
preview its view in a flyout; move away from both flyout and rail to hide it.
Click a rail button or the flyout's pin to dock the view beside the workspace, reserving space.
While docked, another rail button switches content in place; clicking the active button hides
it. Unpinning or X also hides it and returns to hover-only behavior. The pin is filled only
while docked, and its tooltip names the next action. Reload restores docked views and their
width, but never a hover preview. The return-to-sidebar button docks the tool beside the layout.
Pressing a flyout grip keeps the preview open through the gesture, without making it sticky;
after release it stays only while the pointer is over the flyout or rail. Resize either mode
using its left edge. The rail and side views share the card frame. Only the hover flyout has
a drop shadow; docked cards stay flat.

Drag a rail button or the view's header grip into the workspace to make it a regular window.
Its rail button disappears until you close the window, use its return-to-sidebar button, or
drag it back onto the rail or sidebar. A docked tool uses the same tabs, docking guides,
maximize, and close controls as Chat and apps.

A plugin can also show its view as a window instead of in the rail. Its button then sits with the
window buttons in the run header, and the view appears, moves, splits, and closes like an app; it
never appears in the rail and has no return-to-sidebar button. A small blue dot on its directly
available header button means the view has content or new activity.

The browser remembers areas, sizes, active tabs, closed windows, empty panes, the header button
order, and sidebar settings for each server and run. New apps appear without taking focus;
unavailable apps disappear. Chat drafts, app input, and visited tool state survive tab switches,
moves, and close/reopen while the run stays open. Reloading the page restores the layout but not
unsent input.

In VS Code, click an app entry to open or focus its single editor tab; moving that tab between
editor groups does not create a second one. The run panel stays on chat. Its inspection rail
retains the popout: the same icon, Escape, X, or backdrop closes it, and its selected tab is
remembered per run. Plugin views that the browser shows as windows stay in this rail. Questions
and news stay in the chat, and unsent drafts stay with their addressee when you switch actors.

The chip at the left of the chat input names the addressee, the actor your messages go to.
An actor in a room, such as one a run script started, appears with its address `room.handle`;
the actors of the main room appear with their handle alone.
While it names another actor than the run's first chat partner, usually the coordinator, an x
next to the name ("Back to @coordinator") returns to that actor at once without opening anything.
Clicking the chip opens a graph of who created whom drawn from top to bottom, like the
agent view of a coding assistant: the coordinator at the top, one level below and connected by
lines the executable actors it started, below those their own subagents. Each card
shows the handle, the state ("working" with a spinner, "waiting for input" when the actor waits
for your answer, "waiting", or "stopped"), a time, and the task. A working actor shows how long
its current turn has been running and counts up every second; the others show "last turn" with
the duration of their last finished turn, or no time if they never finished one. The task is the
description given when the actor was created, otherwise the first line of its first assignment,
otherwise its display name. A badge counts the inputs waiting for the actor, and lines into
working actors are highlighted. Four or more similar siblings, such as 37 rule reviewers named
`review-...`, appear as one stacked group card with their shared handle prefix, their number,
and a count per state; click it to show the members in a frame below it, click again to hide
them. A group that contains the current addressee opens by itself. More children than fit side
by side wrap into further rows. The pop-out has no title and grows with the graph, upward to the
top of the window and across its width; a small graph keeps it compact. A larger graph pans:
drag with the left mouse button anywhere, also on a card, or scroll with the mouse wheel, the
trackpad, or a finger. Panning stops 40 pixels beyond the outermost cards, and a short press on
a card still picks it. The graph opens with the current addressee centered and highlighted.
Clicking an actor makes it the addressee and closes the graph; Tab moves through the cards and
brings a hidden card into view, and Escape, a click outside, or the x in the top right corner
closes. All actors permitted by your access rights are available, including stopped actors.
TypeScript actors require inspection rights.

"Agents" in the run header opens the same graph with the title "Agents" as soon as the run has an
actor besides you; it grows down to the bottom of the window and pans the same way. Clicking an
actor there also makes it the chat's addressee. Its labeled button wraps with the other header
actions when space is short.


The extension lives under `apps/vscode`. All configured **servers** can remain connected at the
same time, while one selected **environment** supplies the visible Start page, Runs, templates,
and plugin interface. A server in the `ragents.connections` setting is
either a server (`name` and `url`; it connects automatically when activated and the panel asks
for sign-in when needed) or a local profile (`name` and `profileFile`, the path to a
`ragents.config.<profile>.ts`). When activated, the extension starts a local profile silently in
the background with `--port 0`. The environment shows "starting" and then "ready", so its interface and
templates are immediately available; a stopped local profile can be started again from Server. The
host runs until the VS Code session ends and terminates with it, even if the window reloads, VS
Code crashes, or it is forcibly closed. Before starting, the extension provisions the profile's
tools; the web interface comes finished with the host. With a checkout as host, the host refuses
to start while its built-in bundles or its web interface are outdated and names the build
command. If a server distributes a client profile, the extension
fetches it after sign-in like `pnpm connect`, starts its host locally, and supplies the token as
`RAGENTS_TOKEN`. For workstation registration without an explicit `ragents.hostPath`, the
extension downloads the host itself:
`npm install --prefix <globalStorage>/hosts/<package-version> @schlenkr/ragents@<package-version>`,
using the `npm` available on `PATH` and the configured process environment, including registry
settings. If npm cannot provide that version and the server offers its own host package, the
extension downloads it after sign-in, verifies its SHA-512 integrity, and installs it with npm
into the same cache. This also supports servers deployed from an unpublished local build; see
[Deploy from a local build](../operations.md#deploy-from-a-local-build). For workstation registration,
each server supplies its RAgents version through
`ragents.plugins.bootstrap`; for a distributed profile, through `ragents.profile.describe`;
for a local profile, the extension supplies its own `ragents.packageVersion` from `package.json`.
Different server versions get separate hosts; a cached version is reused across restarts.
Workstation registration needs no previous local profile or distributing server. npm output
appears in the `RAgents` output channel, fetching progress and failures with their cause in the
server entry. A local profile therefore needs no checkout. `ragents.hostPath` remains an explicit
override pointing to a checkout or installed package; its version and contribution states must
match the server, or registration fails without fetching another host.
The status bar shows the number of connected servers and opens the start page when clicked. See
the root `README.md` for details.

Install the extension from the Marketplace as `purestate.ragents-vscode` using "Extensions:
Install Extension" or `code --install-extension purestate.ragents-vscode`. The Marketplace
delivers the build for your platform, which carries ripgrep for the `bash` tool (see
[Work on Windows](guide-distributed.html#work-on-windows) for the Windows bash). To install a locally
packaged file, run `pnpm package:vscode`, which builds the universal
`dist/ragents-vscode-<version>.vsix` and one `dist/ragents-vscode-<platform>-<version>.vsix` per
platform, such as `darwin-arm64`, then use "Extensions: Install from VSIX" or
`code --install-extension dist/ragents-vscode-darwin-arm64-<version>.vsix --force`. `scripts/vscode/install-local.sh`
performs both steps with the file for this machine, rebuilds the built-in plugins, and
rebuilds the web interface if it no longer matches its sources, so that hosts from this checkout
start again. The script then restarts manually launched
servers (`scripts/start.sh`, identified by `RAGENTS_LAUNCH=start.sh` in their environment, with logs under
`<data-directory>/logs/server-<time>.log`) and waits for `/health`. Hosts started by the extension
are left alone and restart with the reload. Afterward, reload VS Code with "Developer: Reload
Window" and reopen the run panel. If `code` is not on `PATH`, it is available at
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`. An installed extension
needs no checkout; it fetches the host from `@schlenkr/ragents` when first required by a server
or local profile.

The extension shows Start, Runs, and the run panel from the selected server, plus its own "Server"
configuration page. All appear in the RAgents panel of VS Code's secondary sidebar.
Navigation and commands live in the view title
bar, following VS Code conventions: Start (home), Runs (list), "Switch environment"
(server-environment icon), Server (gear), "New run", and "Refresh". They remain available
while the panel shows a run. Start has no separate page header; Runs and Server show their
title next to a back arrow to Start, and the logo at the top left of the run panel ("Back to
Start") also returns there. There is no Explorer tree in the activity bar. The view badge counts
pending inputs in the selected environment, and Refresh refreshes that environment.

"Switch environment" opens VS Code's native Quick Pick for configured servers and local profiles.
The title `RAgents: <name>` and the header pill showing the name identify the selection;
the pill's tooltip reads `Environment <name>`.
The choice is remembered per workspace; reopening selects it again when still configured,
otherwise the first configured environment. Switching changes the interface without stopping
runs or disconnecting other servers or workstations. The selected server supplies its plugin
header already on Start, including its global coordinator when installed. If that environment
needs sign-in, is starting, or cannot be reached, the local shell shows its status and the
appropriate sign-in, connect, or retry action on a Server page showing only this environment.
The gear opens connection and profile management for all configured environments.

Start and Runs in both hosts, and Server in VS Code, share a centered content area up to
1280 pixels wide, with side padding. The Runs search field and rows stay within this area,
including on ultrawide displays. The outer header remains full width. All three pages begin their
content at the same distance below the header, and on Start each section label stands well apart
from the section above it. In both hosts, logo, global coordinator button, Settings, and Help share
the header. The logo leads back to Start there, so the run header has no back arrow of its
own; Runs keeps its back arrow ("Back to Start") next to its title in the browser as in VS Code. An open run places its layout actions in the run header, without a separate
toolbar row. The run header wraps onto further rows when needed in either host; VS Code keeps
its app editor tabs.

**Start** arranges template cards in several columns when space allows, up to five at the
maximum content width, and one in narrow panels. Cards stay between 240 and 320 pixels wide,
shrinking only when the panel is narrower.
It has no server block. **New** comes first when the selected server permits new runs. The first
entry is its default template, marked "Default" in the title row, or "New chat". Remaining
templates follow without duplicating the default. Each flat card shows a title and two lines
of description, with an always-visible action icon at the top right: plus for "New chat",
play for a direct start, and sliders for "Set up". Hover or keyboard focus emphasizes the icon.
The whole card is clickable, with accessible name "New chat", `Start <title>`, or
`Set up <title>`. There is no category row or bottom action bar, and skill and script templates
share the same card appearance. Clicking an entry creates and starts the run on its server
and opens the run panel. Until the run opens, the entry shows "Starting ..." with a
spinner in the icon position and all other entries stay locked; a cancelled folder choice
or a failed start unlocks them again. Cancelling a template's guide returns to the same server's Start page.

The new run uses your open folder as its workspace, asking you to choose when several are open.
If the template defines its own workspace, such as one server folder per run, VS Code does not
ask. Until content appears, the panel shows a progress bar and the current step: starting,
loading, preparing, or setting up. A startup or setup error appears in the same place while the
chat input remains usable. The loading state disappears with the first mini-app or chat item; an
empty chat without a template does not show it. If a run cannot be started, for example because
the user may not create runs, the panel explains why and offers "Back to Start".
For a new run, the visible chat input receives focus as
soon as it becomes writable. Opening an existing run does the same for its selected chat partner.

**Continue** follows with this server's five most recent runs in a fixed-column
grid with status, title, and right-aligned time. Rows are
the same as in the browser: below the title the owner and short details such as the workspace,
the whole row is clickable, and a dot in the status icon marks activity you have not viewed in
any host yet. Shared runs carry their sharing icon next to the title, and runs you may share
end with "Share ..." (see [Share runs](#share-runs)). "All N runs" opens this server's Runs page.
The trash button ("Delete run ...") beside a run on Start and Runs opens its deletion
confirmation. Runs shared with you have no delete button.
Plugin sections appear directly below Continue when installed, for example a list of work
documents from all runs you can see. Clicking such an entry can open its run. Empty sections
show no heading or gap.

**Runs** shows this server's complete list in the same grid, with search, "Hide ended", and a
selection mode that deletes several runs after a dialog confirmation. Checkboxes occupy an
additional first column; row actions disappear during selection. A run the
server has locked, for example because its journal uses an older format, shows a warning icon whose
tooltip names the cause; it does not open, but the selection mode deletes it.

**Server** is the configuration page. You can add, edit, sign in, sign out, connect,
disconnect, and remove servers with confirmation, then open `settings.json` from the link
at the bottom. If a connected server does not accept this window's folders as a workstation, its
entry says "Workstation not registered" with the cause.
Before registration, the entry shows `Fetching host package <version> ...` and
`Provisioning workstation tools ...`. If npm and the server download cannot supply the host,
or the download's integrity differs, the entry shows the cause. Every registration selects and
verifies the server's exact host version and provisions its tools, even if no executor
contributions are requested.

The extension compares its own RAgents version with the version each server reports. If they
differ, the Server row, the status bar, and a notification show "RAgents
version mismatch: extension 0.1.9, server 0.1.8 - ...", followed by
what to update: the extension if it is older, the server if it is older, or the host in
`ragents.hostPath` for a local profile. A server that reports no version counts as older. While the
workstation stays registered, this is a warning and everything keeps working. When the server
rejects the workstation for the same reason, because the workspace executor versions differ or the
host the extension uses lacks a plugin bundle the server's executor carries, or carries it in
another version, it is an error that also names the server's cause; the same error appears when
both report the same version but their builds differ. The notification appears once per server
and message; "Show extension" opens the extension page for the update, and
"Show servers" opens the Server page.

Every status uses a colored icon and a tooltip with the same vocabulary everywhere. A run is
"running", "paused", "waiting for input" (with the number of open inputs),
"idle", "ended", "failed", or "cancelled". A
server is "connected", "ready", "starting", "sign-in required",
"unreachable", "stopped", "failed", or "no access". Time is compact and omits "ago": `now`, `5min`,
`3h`, `2d`, then a date after seven days. A function or mini-app name never appears as a status.
Status icons never resemble a stop button: paused is a circle with a pause sign, cancelled a
slashed circle, ended a check mark, and idle or stopped an empty circle. Actual stop buttons consistently use a filled red square: "Stop
run" in the run-panel header and run menu, "Stop work" beside the
chat input, and the stop controls for run processes.

"Stop work" pauses the whole run and is not the end of it. It appears in every chat input
while any actor of the run is working: no turn of any actor starts any more, the running turns
of all actors end, also those of the agents the coordinator started, and the text already written
stays. Nothing is lost: what arrives in the meantime, such as a sub-agent's report, waits. Above
the input one line says "Paused - 3 inputs waiting" with "Resume". "Resume" continues without a
message; a message you send continues as well and reaches the coordinator together with
everything that waited, your message last, so it is the current instruction. Agents the
coordinator started continue only once it addresses them again. Every turn that no message of
yours started carries a line about its trigger in the chat, such as "New turn, triggered by
turn.finished of @implementer". To end everything, use "Stop run" with its
confirmation; to stop a single actor for good, use "Stop" on its actor card. If a chat's actor has
been stopped, the input is replaced by `@handle stopped: <reason>` and, with permission to operate
and inspect the run, "Restart". Restarting the former primary actor makes it the
primary actor again, and the run chat continues.

Click a mini-app in the run panel to open or focus its editor tab. Move and close that tab with
VS Code; opening it again reuses its current group or creates one editor after it was closed. Text artifacts and the journal open as read-only documents, while other artifacts
open in the browser. `RAgents: New run` uses a Quick Pick for the selected environment's templates.
The first entry is its default, marked "Default", or the free task without
a template. The commands `RAgents: Disconnect`, `RAgents: Connect`, and
`RAgents: Sign out` apply to the selected run's server or ask when several match.

When the run chat or a hosted mini-app input has focus, VS Code shortcuts such as Cmd/Ctrl+P
and Cmd/Ctrl+Shift+P still work using your keybindings, including key chords. This also applies
to nested hosted mini-app frames. Text entry, selection, undo, and clipboard actions remain in
the input field. After pasting, focus stays in that input, including in nested mini-apps and
when the clipboard is empty. You can continue typing or undo without clicking the input again.
Dictation tools that paste their result, such as HEX, use the same input path.
Keys already handled by the chat or mini-app are not also executed as VS Code commands.
In a regular browser, native keyboard and clipboard behavior remains in use.

To make RAgents smaller or larger independently of VS Code's window zoom, set `ragents.zoom`
in VS Code Settings. The value is a percentage from 50 to 200, with 100 as the default;
for example, `"ragents.zoom": 90` makes the whole interface 10% smaller. It applies to Start,
Runs, Server, the run panel, and mini-app editor tabs, including nested mini-apps. Changes take
effect immediately without reloading the page or losing input drafts. Regular browser pages
are unaffected. This scales text, controls, and spacing together; it is independent of
`editor.fontSize` and the built-in chat font settings.

If a server profile requires users, both the selected environment's sign-in action and the Server row open the
same sign-in dialog. For a profile with `ACCESS_TOKEN`, the dialog requests that token. User name
and password are stored per server address in VS Code SecretStorage and reused silently next
session. The session token is stored there as well and sent as a bearer token; iframes receive it
in their URL (the server accepts a bearer token or the `access` query parameter for GET requests).
Images, links, and downloads of documents and of the chat never carry it: they load through
short-lived grants that the panel renews while a run is open.
After expiry or a server restart, that server asks for sign-in again without affecting others.
`RAgents: Sign out` revokes the session.

## Share runs

With sign-in, the owner of a run and users with `runs.read.all` can share it with other users of
the same profile. Click "Share ..." at the end of its row on Start or Runs, or "Share" in the run
header. A new empty run offers "Share" before its first message; the choice applies as soon as the
run is created. The "Share run" dialog names the run and shows a list: "Everyone" first, then
every other user of the profile, each row with the switch "Off", "Can view", or "Can operate". A
user gets the higher of "Everyone" and their own row. "Save" stays disabled until something changes
and while saving; when the server refuses, the reason appears in the dialog, which keeps your
changes. "Cancel" or Escape closes it without saving. The dialog is the same in the browser and in
VS Code; the labeled header button wraps with the other actions when space is short.

"Can view" shows the run, its chat, apps, and journal as far as your own permissions go, but
operates nothing: the run header shows "View only", the chat input is disabled with "Shared with
you for viewing only", and "Stop run", "Run script", answers to questions, and app actions are
missing. "Can operate" works in the run within your own permissions, and the header shows "Shared".
In someone else's run that only its owner operates, the chat input says "Only its owner operates
this run"; "Stop run" and the stop button in the chat input stay. A run shared with you is never deleted by you. If a share is taken
back while you have the run open, the panel returns to Start and shows "This run is no longer
available to you."

## Connect an editor over ACP

An editor with Agent Client Protocol support starts `ragents acp` and chats with a run bound to
its project folder. In Zed, add this to your settings:

```json
{
  "agent_servers": {
    "RAgents": { "command": "ragents", "args": ["acp"] }
  }
}
```

The command uses the `developer` profile by default. Set model access in the environment
inherited by the editor and provision the profile's tools once with `ragents provision developer`.
For a different profile, add `"--profile", "/path/to/ragents.config.custom.ts"` to `args`;
`RAGENTS_PROFILE` selects it through the environment. In a checkout, `pnpm ragents acp` is
available; stdio clients must launch `pnpm --silent ragents acp` so pnpm's script banner does not
enter the protocol stream. `--data-dir <folder>` or `DATA_DIR` selects a separate host data folder.

The editor receives streamed replies, thinking, tool progress, file changes, and the agent's
plan. Cancel interrupts the primary actor's current turn; the next prompt can continue the run.
Supported editors can list runs for the project folder, load their history, and change the
selected model. Questions appear as an editor form when the client supports form elicitation;
otherwise they appear with their options in the chat, and you answer in the next prompt.
The same run remains available in the browser and VS Code under the same user.
Profiles with at most 20 skill templates expose them as slash commands using their template
identifiers. Each command applies the template's prompt and skill, with any text after the
command added as task details, as when starting that template in the web. Closing the editor
connection cancels active prompts and disconnects its
workstations; the host and runs remain available.

The command finds or starts the host like `ragents run`. When no remembered host answers,
`RAGENTS_URL` selects an existing server; `RAGENTS_TOKEN` supplies its bearer token when sign-in
is required. For a server on another machine, the ACP process offers the project folder as a
workstation and runs file and shell
tools there. A network workstation requires a signed-in user on the server. Connection,
sign-in, and folder refusals are reported as protocol errors.

MCP servers supplied by the editor belong to this run and execute on the machine holding its
folder. Their connection definitions and secrets stay outside the journal and model context;
the profile must include `ragents.mcp`. The protocol is stable ACP v1 over stdin and stdout,
with all command logs on stderr. This command's stdio protocol is distinct from the host's
JSON-RPC API described below.

## Run external ACP actors

Configured ACP agents run as participants alongside the coordinator and TypeScript actors.
After [configuring adapters](guide-getting-started.html#configure-external-acp-agents),
ask the coordinator to assign work to one of the available runtimes. The actor uses its
adapter's coding tools in the run's workspace, on the server or workstation that holds that
folder.

For agent-driven setup, `model_list` names the configured runtimes and their titles. Select one
with `agent_spawn`, for example through `typescript_eval`:

```ts
await context.functions.agent_spawn({
  name: "reviewer",
  description: "Reviews the proposed changes",
  runtime: "acp.codex",
  tools: null,
  instructions: "Review the changes and report defects with evidence.",
  prompt: "Review the current diff in the workspace.",
});
```

Choose a configured runtime; a missing name is an error that lists the available choices.
External actors own their model and tool selection, so omit `model`, `provider`, `thinking`,
and `forkOf`, and use `tools: null`. The actor needs the inherited `workspace.use` capability
and the shared run workspace; leave `isolateWorkspace` omitted or set it to `false`. Explicit
isolation is rejected. RAgents functions are not offered to their agents. To
subscribe before work begins, omit `prompt`, subscribe to the actor's response events, then send
its task with `actor_input`. Further messages wait for its next turn instead of steering a
running prompt.

Open the actor's chat to see streamed replies and thinking, tool progress, and plan lines. A
permission request appears as a question with the adapter's offered choices and holds its turn
until answered; dismissing it or interrupting the turn cancels the request. Turn interruption
also cancels the adapter's prompt and keeps its partial reply visible. Stopping the actor or
run closes its adapter and terminals.

The actor keeps one external session between turns. After a server restart it continues only
when the adapter advertises session loading and can load that session. Otherwise it reports a
blocking cause; no empty conversation silently replaces it. Text is always supported; images
and embedded resources require the adapter's advertised capabilities. Missing installation,
sign-in, unsupported content, and workspace refusals show their causes in the actor's history.

## Control RAgents as an agent

An AI agent working on the same machine controls RAgents through seven `ragents` subcommands. In
a checkout, use `pnpm ragents <command>`. These commands are the agent-facing contract: `run` and
`send` wait for the turn to end, and every command returns an exit code.

```sh
ragents provision developer                                  # once per machine
ragents run selftest/workspace-project "Fix the type error in src/broken.ts"
ragents send <runId> "Read README.md and report the passphrase"
ragents journal <runId> --tools
ragents stop <runId>                                         # pause the whole run until send or resume
ragents resume <runId>                                       # continue a paused run without a message
ragents stop <runId> --turn                                  # interrupt only the primary actor's active turn
ragents stop <runId> --run                                   # emergency stop: halt the whole run
ragents stop --host                                          # stop the remembered host
ragents script <runId>                                       # list the run scripts and whether each can join the run
ragents script <runId> <entry> --input '{"topic":"Launch"}'  # start one inside the running run
ragents run "Review the change" --share bob --share carol:write   # share the new run before the task goes out
ragents share <runId>                                        # whom the run is shared with
ragents share <runId> bob:write --all read                   # replace the sharing; --none shares with nobody
ragents --help                                               # same as ragents help
ragents --version                                            # the installed version, same as ragents -v
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

The folder is optional: `ragents run "<task>" [--entry <template>]` selects no binding, so the
profile's default or the template's fixed start options apply. A single value is always the task,
even if it looks like a path; with two values the first is the folder. If the template fixes
`ragents.workspace.binding` (`fixed-start-options`) and a folder is given anyway, the command fails
with that cause before it creates anything on the server. `--workstation` requires a folder.

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
pauses the whole run through `ragents.runs.pause`, exactly like the stop button in the chat: no
turn of any actor starts any more, the running turns of all actors end, and what arrives in the
meantime waits. `resume <runId>` continues it through `ragents.runs.resume`; `send` continues it
too, and its message reaches the primary actor last, after everything that waited. A sub-agent
continues only once it is addressed again. `stop <runId> --turn` interrupts only the active turn
of the run's primary actor through `ragents.runs.interruptTurn`: the run and all actors stay
active, and without an active turn nothing happens. `stop <runId> --run` is the emergency stop
(`ragents.chat.stop`): it aborts every turn and stops all actors of the run. `stop --host` terminates exactly the PID in `host.json`, never a
process pattern, and only if the host at the recorded address reports that same PID from
`/health`; otherwise it fails, leaves the process alone and removes the stale record.
`script <runId>` lists the run scripts through `ragents.runs.scripts`, one per line with id, title,
and the reason if one cannot join; `script <runId> <entry> [--input <json>]` starts it inside the
run through `ragents.runs.startScript` as the run's user and prints `script: @<handle>, start <n>`;
a refusal is an error with exit code 1. `--json` prints the RPC results instead.

`run --share <user>[:read|:write]` (repeatable, `read` without a level) and `--share-all
<read|write>` share the new run with users of the profile or with all of them, through
`ragents.runs.share` on the fresh run identifier after the start options and before the task; a
refusal, for example a user the profile does not have or a profile without sign-in, ends the
command before anything is sent. `share <runId>` prints whom a run is shared with, one line per
target (`everyone: read`, `bob (Bob): write`, or `nobody`), through `ragents.runs.sharing`;
`share <runId> <user>[:read|:write]... [--all <read|write>]` replaces the whole sharing and prints
the result the same way, `--none` shares the run with nobody. Both need sign-in and only work for
the run's owner or a user with `runs.read.all`; `--json` prints the RPC result. `ragents --help` and `ragents help` show usage and exit with 0; invoking the
command without arguments is an error with exit code 1. `ragents --version` and `ragents -v` print
the version of the installed package and exit with 0.

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

stdout contains function calls (`> <name>`, then `< <name> <duration>s ok`, `error`, or
`cancelled`) as far as the server shows them to the user (`runs.inspect`), the model response,
and finally the fixed line `run: <id>`. Every question the agent asks in the turn appears as one
line `? [<header>] <question> Options: "<label>" (<description>), ...`, with `(several allowed)`
when it takes several options; the last line of a call ends with
`- answer with: ragents send <runId> "<answer>"`. The turn ends with the questions, and one
message from `send` closes all of them and reaches the agent as its next input, so answer every
question in that text. `journal` shows each question as a `QUESTION` line. Messages from the command itself go
to stderr. With `--json`, the same steps are emitted as newline-delimited JSON instead (`tool`,
`tool-end`, `question` with `id` and `questions` as the agent asked them, `output`, and finally `turn`,
the others carrying the objects of the run view). Exit code 0 means the turn
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

A run script whose `RUN.md` sets `embeddable: true` also starts inside a running run:
`ragents.runs.startScript` with `runId`, `entry`, and `input` waits and returns the script actor,
its address `room.handle`, and which start of its package this was, or the reason in `error`. The
primary actor stays; every start opens a room of its own, so a repeated start gets its own actors.

`ragents.runs.share` with `runId` and `sharing` (`everyone` and `users` with `userId` and
`access`, each `read` or `write`) replaces whom a run is shared with, also on an identifier without
a run before its first message; `ragents.runs.sharing` reads it together with the users it can be
shared with. Rules, errors, and what each access permits are in `docs/spec/profiles.md`, Sharing in
detail.

Without HTTP, use stdio: `pnpm start -- --stdio` exchanges one JSON message per line through
stdin and stdout and opens no port. The startup modes are:

- `--stdio` without `--port`: stdio only, no HTTP server.
- `--port 0`: a private port; the server reports it on stdout as
  `{"ragents":{"url":"...","token":"...","pid":1234}}`.
- `--port N`: fixed port N instead of `host.PORT` from the profile file.
