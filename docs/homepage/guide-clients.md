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

## Context usage

The ring in the run coordinator, agent, and global coordinator chat fills as the active model
context grows. Click it to see used tokens, the context window, and the token count above which
automatic compaction starts. It also shows the remaining tokens to that threshold. Estimates are
marked; after compaction the ring measures the summary and retained context. Near the threshold,
the ring uses the warning color. Limits belong to the selected model and apply from the next turn.
The control also works with read access; script and external runtimes have no built-in context ring.

## Keep and restore context

Long conversations summarize older work automatically. With the bundled context plugin, recent
file excerpts can remain verbatim alongside the summary. An agent can keep important results
explicitly and retrieve earlier originals even after they leave its active context:

| Function | Use |
| --- | --- |
| `context_list({ query: "src/example.ts" })` | Find earlier results by path, tool name, or text, with short references and previews. |
| `context_recall({ reference: "result-3" })` | Restore the original text; use the returned character offset for another page. Native calls also restore images. |
| `context_keep({ references: ["result-3"] })` | Keep an important result verbatim through future compactions. |
| `context_keep({ references: ["result-3"], keep: false })` | Release a previously kept result. |

The retained set has a token budget; oversized results remain available through paged recall.
Keeping results requires `plugin.state.write`; searching and restoring do not. References belong
to this agent's conversation, including context inherited by a fork, and survive a server
restart. A restored file excerpt is a historical snapshot. Read the file again for its current
contents. An incomplete summary leaves the original active context intact.

Oversized tool results carry a truncation notice and an `@attachments/<name>` reference to the full text.
The agent reads that file in parts. This also applies to old results after restart. If context
recovery cannot finish a summary, the chat reports its short cause, such as an output limit or an
empty summary; send another message to retry. Compaction reserves room for the next model response,
including reasoning, before requesting it.
This also works within a long tool loop: completed work can move into the summary while the same
turn continues. Its original results and reasoning remain in the journal.

## Selection controls and tables

Short option groups form one square segmented control, with dividers between choices and a
tinted fill on selected segments. A group chooses one value, or several independently when
multiple selection is available. Tab enters the group; arrow keys move between enabled
segments, Home and End move to the first and last, and Space or Enter selects or deselects.
Settings theme and zoom, sharing access levels, and view and grouping choices use these controls.
Single required choices keep the current value when its selected segment is pressed again.
Workspace machine and folder choices use segments for up to five values and selection menus
for longer lists. Model and reasoning selection stay in menus.

Selection menus open below their button, or above when there is less room, and stay at least
as wide as it. Selectors with more than eight choices show a search field. Type part of a label
to narrow the list; matching ignores case. Use the arrow keys to move through the results,
Enter to choose, and Escape to close. "No matching options." means no choice matches the search.

A row of tabs that does not fit its width never cuts a tab off or wraps it into a second row.
The active tab and the tabs before it stay; the rest move into "More tabs" (...) at the end of the
row. Its menu lists exactly the hidden tabs; choosing one shows it and puts its tab at the end of the
row. Use the arrow keys between the visible tabs, Tab to reach "More tabs", and Enter, the arrow keys,
and Escape in its menu. Start's widgets in a narrow panel, the two Runs tabs, the Settings areas, and
the views of an inspected actor work this way.

Toolbar filters with up to five values show their choices as multiple-selection segments.
Select several values together; "Clear" or deselecting them all removes the restriction.
Longer lists show the filter name and the number of chosen values, or "All" when unrestricted. Open the
dropdown to search and check several values; "Clear" returns it to "All". A dot can identify a
value's color, and a count shows its number of entries in either form.

Large lists fill the available page width as one framed card whose rows are separated by visible lines.
The page scrolls, and the column headers remain visible below a sticky toolbar. A list inside a bounded
panel scrolls within that panel; columns wider than the page scroll sideways with the frame. Click a sortable
column heading to change the row order; expandable group rows show their entry count in a small outlined badge on a
tinted band. Column headings use sentence case on a band of their own with a strong lower edge, and the
sorted column is emphasized. Hovering a row tints it lightly, and a selected row is tinted and framed like every other
selected item. Use the arrow keys, Home, and End to move between rows, Enter or a
double-click to open an entry, and Space to select it when selection is offered or to toggle
a group.
Lists that load incrementally can request more entries near their end and show a loading
status or "Load more" below the rows.

In grids and tables with resize handles, drag the right edge of a column header with a mouse
or touch to change its width, or double-click the handle to fit the visible content. Columns
retain their minimum width; a flexible grid column fills the remaining space. The browser
remembers widths for that list at the same server address. Widen a column to read
the full value of truncated text; columns that allow wrapping grow their rows instead. From a focused resize
handle, Left and Right change the
width (Shift makes larger steps), Home sets the minimum, and Enter or End fits the content.
If saved widths are damaged or saving fails, an error and "Reset column widths" remain
visible. If the browser blocks storage access, the list still shows its initial widths;
"Retry column widths" enables resizing after access returns.

## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows chat with an addressee selector, mini-app tabs, and the inspection bar on the right.
Without `run`, it shows the shared Start page. `run-panel.html?page=<id>` opens a page that a plugin adds.
`run-panel.html?layout=app&run=<id>&element=<app-id>` shows one mini-app without the tab bar.
The browser docking layout and addressee are stored per run in the browser. Starting or opening
a run focuses its visible chat input once it is ready, including a remembered chat partner.
Clicking or typing elsewhere while it loads cancels that focus request.

The run title opens "Run details". Its panel reads as one column of labelled rows: label on the
left, full value on the right, with a short explanation below it. A contributed branch can appear
first, ahead of workspace and other facts. It includes all run metadata and start option badges
(an option already shown as metadata appears once), the full run title, and any connection
error or sharing access. Branches, paths, process names, and errors wrap as the panel narrows.
The workspace says where files and commands run; sandbox protection explains whether commands
are isolated from other work on that machine; system prompts name their instructions and who receives them.
Running work shows the agent and elapsed time without overlapping. Processes appear as ordinary
rows with their full names, open ports, and individual stop controls.
"Stop run" sits in a separate footer below the facts and directly stops all work and background
commands without confirmation, keeping actors available for your next message. A failure stays
visible in full and can be retried. "Run details", "Run script", and "Share" use the same square dropdown below the header,
up to 800 pixels wide with a small inset on the side of their button. Each dims the page below the header and keeps
its content within the available width. The close button, Escape, or clicking outside closes it. Focus returns
to its button unless it has moved elsewhere.

With write rights, the run header offers "Run script" right of the window buttons, behind a thin
divider. Its dropdown lists the run scripts you may start, in two columns when there is room
and one column in narrow panels.
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

Opening a window without a remembered place splits the largest visible window other than the
main Chat into equal halves. If only Chat is visible, it splits Chat. Wider windows split side
by side, taller windows top and bottom; a square splits side by side. The new window takes the
right or bottom half. This works at every workspace width for mini-apps, Agents, inspection
tools, actor chats, and documents, including apps that appear later. Your dragged windows keep
their places. The active tab is one square filled shape
flush with the strip, without a border, holding its grip, maximize, and close buttons. The strip
clips to the card's rounded top corners. Drag a tab to arrange windows, or drag
the grip on the active tab to move only that window; the other tabs stay in their area.
A compass appears over the area under the pointer: its four sides split that area in half,
and its center merges windows as tabs. Dropping on a tab strip also merges. The four outer
workspace guides dock along the whole edge. A translucent rectangle previews the result.
Escape cancels a drag. Each area, including an empty one, is a rounded, thin-bordered card.
Small gaps separate the cards and the workspace edge; the focused card has an accent border.
Drag the three-dot grips in the gaps to resize areas. Vertical gaps have vertical dots,
horizontal gaps horizontal dots. The grips brighten on hover and use the accent color while
dragging. The tab-strip and flyout drag grips use the same dots.

Dragging the only window to a side of its own area leaves an empty half. Drop another window
there or use "Close area". Moving all windows into another area removes their empty source.
Each tab's X closes that window. Only empty areas have an additional X, when another area
remains. Chat can be closed too. By default, the run header lists Chat, every plugin view shown as a
window, and every app as buttons with their existing icons, whether shown or not; the button of a
visible window appears pressed.
Clicking a closed window restores it as a tab in its remembered group if that group still
exists. If the group was removed, it splits the largest visible window by the same rule.
Clicking a window that waits as a background tab brings that tab to the front.
Clicking a visible window focuses its area. All window buttons, "Empty space", and "Reset layout" remain directly available. They fill
the space between the fixed controls first, then continue across the full header width when
needed. Adding apps keeps the title and actions such as "Share", "Run script", and Settings
in place. The title, and after it the global coordinator, shrinks before the fixed actions wrap on
desktop widths. The title and long button labels truncate; Run details shows the full run title,
and each window shows its own title. Controls retain complete accessible names.
Narrow panels can also wrap fixed controls. The header grows and pushes the workspace down;
its controls are never clipped, hidden in a window menu, or placed in a horizontal scroll area.
Each window button has a grip at its left edge, shown on hover or focus and always on touch
screens. Drag a button within the header to reorder the buttons across rows; a thin line marks
where it lands. Drag it into the workspace to get the same compass and edge guides as for a tab:
the drop opens or moves that window there. A press without movement still counts as a click,
and Escape cancels the drag. Alt+Left Arrow and Alt+Right Arrow move a focused button. New
windows join at the end.

Move any entry's button between the header and right sidebar rail: drag a rail button onto a
header insertion line, or drag a header button onto the rail. An empty rail appears as a drop
target during a button drag. Right-click either button for "Move to header" or "Move to sidebar";
from the keyboard, focus it, press Shift+F10, then choose the action with arrow keys and Enter.
The menu moves a button to the end of the header. Moving a button leaves its panel open, closed,
or in its current dock area. A rail button for an already docked window selects that window;
it does not open a second copy.

After the window buttons, "Empty space" is always directly available.
Clicking it adds an empty pane through the same largest-window rule; dragging the button
places the pane on a docking guide. You can add several. An empty
pane is a window like any other: move it, split beside it, merge it as a tab, maximize it, or
close it with X, which removes it. It shows "Drag an app or actor here". Dropping a header
button or a tab anywhere on a shown empty pane, or on the compass center labeled "Replace empty
pane", puts that window in its place. Empty panes survive reload.

"Show app..." follows "Empty space" if you may work in the run; in VS Code it sits after the app
buttons. It lists the mini-apps you may show here: your global apps under "Global apps", then the
apps of your other runs under each run's title, and marks a view the run already shows as "Shown".
Choosing one adds a window titled with the app's name and "(read-only)" and opens it, in VS Code as
an editor tab. The window says "Read-only" and where the app lives, follows the app's state live,
and refuses every action of the app; "Remove" takes the window out of the run for everyone. Another
viewer of a shared run who may not read the app's run sees "This app is not available to you." in
that window, and a removed app or run is reported there the same calm way. The rest of the run
stays as it is.

The "Reset layout" icon after the window buttons and "Empty space"
rebuilds the layout by opening windows in catalog order with the same placement rule, restores
default button positions and order and the inspection rail, and removes empty panes.
Maximize appears only with multiple areas, in the active tab just
before its X; Restore or Escape returns to the split layout. Tabs support arrow
keys, Home, and End, and focused dividers support arrow keys.

Inspection puts its actor selector in the window title row. A second, horizontally scrollable
row holds the actor name, Stop or Restart, chat display switches, and detail-view icons with
accessible names. The conversation has no separate bottom toolbar.

The inspection rail on the right contains files, documents, functions, executions, and
language-server diagnostics according to the run and your permissions. A small blue dot at the
top right of a rail button means the view has content or new activity. Hover or focus a button
to see its tooltip immediately to the left, above the flyout and workspace panels. Hover a button to
preview its view in a flyout; move away from both flyout and rail to hide it.
Click a rail button to open or focus its flyout. X hides it. The flyout is 630 pixels wide,
limited by the available space. Its keyboard-accessible "Move into layout" button restores the
view's remembered group when it still exists, otherwise it splits the largest visible window
by the same rule. Dragging onto a guide uses your chosen target.
Pressing a flyout grip keeps the preview open through the gesture, without making it sticky;
after release it stays only while the pointer is over the flyout or rail. The rail and flyout
share the card frame. The flyout has a drop shadow; layout cards stay flat.

Drag a rail button or the view's header grip into the workspace to make it a regular window.
Its button stays in the rail until you move the button itself. The window uses the same tabs,
splits, docking guides, maximize, drag, and close controls as Chat and apps. Closing it or
dragging its tab back onto the rail or flyout returns the hidden panel to the rail.
"Return to sidebar" opens and focuses its flyout instead, keeping the button in its chosen place.

A plugin can also show its view as a window instead of in the rail. Its button then sits with the
window buttons in the run header by default, and the view appears, moves, splits, and closes like
an app. You can move its button into the rail using the same drag or menu actions. A small blue
dot on its directly available header button means the view has content or new activity.

The browser remembers areas, sizes, active tabs, closed windows, empty panes, the header button
order, and button positions for each server and run. Flyouts close on reload; saved layouts
with the removed sidebar mode or width also reconcile to a closed flyout. New apps appear without
taking focus. A window that is unavailable for a while, such as the app of a stopped actor or a
view whose run details arrive late, keeps its place: its area gives its space to the others and
its button leaves the header until it returns, then both are back where they were, without taking
the selection from the tab shown meanwhile. While a run loads, such areas stay as empty cards.
The app of a later start of the same run script takes over the area of the earlier one; while both
are shown, each has its own. Only closing a window or "Reset layout" gives up its place. A run
whose details are briefly missing from the server's list keeps its tabs and details meanwhile.
Chat drafts, app input, and visited tool state survive tab switches,
moves, and close/reopen while the run stays open. Hidden panels pause their background refreshes and
receive current run data when shown again; their drafts and existing app frames stay in place.
This does not pause a mini-app's own code inside its frame. Reloading the page restores the
layout but not unsent input.

In VS Code, click an app entry to open or focus its single editor tab; moving that tab between
editor groups does not create a second one. The run panel stays on chat. Its inspection rail
retains the popout: the same icon, Escape, X, or backdrop closes it, and its selected tab is
remembered per run. Plugin views that the browser shows as windows stay in this rail. Questions
and news stay in the chat, and unsent drafts stay with their addressee when you switch actors.
Inspection views that retain their state pause background refreshes while the popout is hidden
and resume with current run data on reopening.

The chip at the left of the chat input names the addressee, the actor your messages go to.
Beside it, a spinner and count show how many subagents are working, excluding the coordinator.
The count stays the same when you choose another addressee; click it to open the graph.
An actor in a room, such as one a run script started, appears with its address `room.handle`;
the actors of the main room appear with their handle alone.
While it names another actor than the run's first chat partner, usually the coordinator, an x
next to the name ("Back to @coordinator") returns to that actor at once without opening anything.
Clicking the chip opens a graph of who created whom drawn from top to bottom, like the
agent view of a coding assistant: the coordinator at the top, one level below and connected by
lines the executable actors it started, below those their own subagents. An agent card shows a
state ring beside `@handle`, followed by up to three lines of its task.
TypeScript actors appear as program boxes with square corners, a dashed border, and a thin
code-icon band. They show their display name, active program name, and function and view counts
from the program definition, never input JSON or repeated messages. Without definition metadata,
the card says "Program definition unavailable". The state icon and name are vertically centered
in both kinds.
The ring spins while the actor works and also shows idle, waiting for your input, stopped,
cancelled, or failed work; its accessible label names the state. An agent's task is the
description given when the actor was created, otherwise its full first assignment, otherwise
its display name. Open the actor's chat or Inspection to read its complete task or program facts. Lines into working
actors are highlighted.
The same cards appear in the Agents window, this chooser, and VS Code. Four or more similar siblings, such as 37 rule reviewers named
`review-...`, appear as one stacked group card with their shared handle prefix, their number,
and a count per state; click it to show the members in a frame below it, click again to hide
them. A group that contains the current addressee opens by itself. More children than fit side
by side wrap into further rows. The pop-out has no title and grows with the graph, upward to the
top of the window and across its width; a small graph keeps it compact. A larger graph pans:
drag the background or a group card with the left mouse button, or scroll with the mouse wheel, the
trackpad, or a finger. Panning stops 40 pixels beyond the outermost cards, and a short press on
a card still picks it. The graph opens with the current addressee centered and highlighted.
Clicking an actor makes it the addressee and closes the graph; Tab moves through the cards and
brings a hidden card into view, and Escape, a click outside, or the x in the top right corner
closes. All actors permitted by your access rights are available, including stopped actors.
TypeScript actors require inspection rights.

"Agents" is an ordinary run window once the run state is available. Its browser
header button opens or focuses the same window, revealing it when it is hidden behind another tab
or maximized area. Move, dock, resize, close, and reopen it like a mini-app; its place is remembered
with the run's layout. The graph pans within the window and follows live actor states. Picking an
actor makes it the main chat's addressee while the graph stays open. Its button can move to the
sidebar like any window button. In VS Code, "Agents" in the inspection rail opens the same graph
in the existing tool popout.

In the browser, drag an actor from either graph or the addressee chip
onto the workspace's docking guides to open a separate chat addressed to that actor. Drop on
an empty pane to replace it. The main chat keeps its addressee. Actor windows can be moved,
closed, and reopened from their header buttons, and their positions survive a page reload.
Dropping the same actor again moves its existing window. Escape or a drop outside a target
cancels; Reset layout removes the separate actor windows. In VS Code, dragging any graph card
continues to pan the graph.


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
`RAGENTS_TOKEN`. For workstation registration, the extension downloads the host itself:
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
server entry. A local profile therefore needs no checkout. There is no setting for the host: only
an extension started from a checkout (`scripts/start-vscode.sh`) uses that checkout instead of the
package; its version and contribution states must match the server, or registration fails without
fetching another host.
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
the pill's accessible name reads `Environment <name>`.
The choice is remembered per workspace; reopening selects it again when still configured,
otherwise the first configured environment. Switching changes the interface without stopping
runs or disconnecting other servers or workstations. The selected server supplies its plugin
header already on Start, including its global coordinator when installed. If that environment
needs sign-in, is starting, or cannot be reached, the local shell shows its status and the
appropriate sign-in, connect, or retry action on a Server page showing only this environment.
The gear opens connection and profile management for all configured environments.

Start uses the full available width with wider side padding at desktop widths. Runs in both hosts and Server in
VS Code share a centered content area up to 1280 pixels wide. The Runs search field and rows
stay within this area, including on ultrawide displays. All panel pages leave 12 spacing units (`pb-12`,
the page step, 45.12 px at a 16 px root) below their last content, including narrow
Start tabs; this space scales with zoom. The outer header remains full width.
All three pages begin their content at the same distance below the header, with more space at
desktop widths, and on Start every
widget stands 12 spacing units apart from its neighbors horizontally and vertically, including
stacked regions in narrow tabs and the edit list. In both hosts, logo, global coordinator button, Settings, and Help share
the header. The logo leads back to Start there, so the run header has no back arrow of its
own; Runs keeps its back arrow ("Back to Start") next to its title in the browser as in VS Code. An open run places its layout actions in the run header, without a separate
toolbar row. With an open run, the logo, global coordinator, run title, run controls, and
settings share one header row whenever they fit, in both the browser and VS Code. Mini-app
buttons use the remaining width between the fixed controls, then continue over the full width
in further rows. VS Code opens them in editor tabs; the browser opens them in its
workspace. Narrow panels can also wrap fixed controls.

A plugin can add pages to the application. Each page has a button with its icon and title next to the
global coordinator button; the titles shorten when the header is narrow. A page replaces Start or
the open run in the main area as plain content on the normal background, and the main area scrolls as a whole.
The open page's button is highlighted. The logo returns to Start, and opening a run leaves the page. In the
browser the address names the open page (`?page=<id>`), so a reload, a bookmark, and the browser's back and
forward buttons keep it; back leads from a page to what it replaced, such as the run that was open. An
address that names a page that does not exist or that you may not see shows Start with a notice.

**Start** is a dashboard of widgets over the full width of the window: **New**, **Continue**, and those that plugins add,
all of them widgets of the same kind. What fits
depends on the width of Start itself, not of the window, so a narrow VS Code panel behaves like a
narrow window. From 1100 pixels Start has six columns and every widget starts at its configured
width, New two and Continue four. In the saved order, every widget takes the topmost free place
where its width and content height fit, then the leftmost. Later widgets can fill room above a wider
widget placed lower: with Continue three columns wide and a global app four columns wide below it,
New two columns wide starts at columns four and five beside Continue. Empty widgets take no room. From
700 pixels Start has three columns and every widget starts at half its configured columns, rounded up,
so New and Continue still share a row. After placing the widgets, Start grows them to the right into
free columns, top to bottom and left to right, up to each widget's maximum width. The added space
must be free for the widget's full content height. For example, with New set to three columns,
Continue to two beside it, and a three-column plugin widget below New, Continue grows to three
columns and fills the sixth column. Your configured width stays the minimum; this growth changes
only the width shown, never the saved layout. When a widget's content grows, the widgets below it
move down with it. Tabs and one-column layouts keep their behavior. Below 700 pixels Start shows one widget at a time with tabs at the top;
the chosen tab is remembered for this server address. A plugin widget without a title follows
below the tabs, and a widget with nothing to show has neither a place nor a tab.

Arrange Start in its edit mode. "Edit" at the top right of Start, or the pencil at the end of the
tabs in a narrow panel, switches to it; "Editing Start" above the widgets shows the mode until
"Done" saves the layout. "Cancel" or Escape discards every change. While you edit, every widget
gets a dashed frame and its content rests: drag a widget by the handle before its title onto another
widget, before it on its left half and after it on its right half (on the upper or lower half of a widget
across the whole width), or below all widgets to move it to the end; the other widgets slide out of the
way as you drag, without sliding when your system reduces motion; drag its right edge, anywhere along it, to
change its width: the columns of Start appear as guides, a label at the pointer shows the width
("4 of 6 columns"), and the width snaps to each column between the narrowest and widest the widget
allows, while the other widgets reflow; Escape during the drag puts the width back. The title row
shows the grown width, such as "2 of 6". Dragging the edge and resizing with the keyboard start
from that shown width; a drag that reaches no other column keeps your configured width.
"x" removes the widget from Start. "Add widget" below the widgets opens a gallery of every widget
that is not on Start, each with a short description and its width; choosing one adds it at the end
in its usual width. "Reset layout" goes back to the order, widths, and settings Start comes with. With the
keyboard, focus a widget's handle: the arrow keys move it, Shift with Left or Right makes it one
column narrower or wider, and Delete removes it; a screen reader hears every change. In a narrow panel the edit mode
lists the widgets as rows with a handle, up and down buttons, and "x"; widths are chosen on a wider
Start. At medium widths the edge and the keys move by the three columns shown, and the tabs of a
narrow panel follow your order. A layout saved before widgets had settings is not taken over; Start
shows its usual layout until you save a new one.

Some widgets can be configured. In edit mode they have a gear, "Configure", before "x" in their title
row, also in a narrow panel's list. It opens a small dialog with the widget's settings, such as
"Number of runs" for Continue (15 by default, from 3 to 100) and "Show descriptions" for New. A value
the setting does not allow is named below its field, for example "This value is above the maximum
100.", and "Apply" then keeps the dialog open. "Apply" shows the change on the widget at once, "Done"
saves it with your layout, and "Cancel" discards it together with the other changes; "Cancel" or
Escape in the dialog closes only the dialog. Configure exists only in edit mode, so Start changes in
one place. If a saved value no longer fits a widget, for example after a plugin narrowed a range, the
widget says so in a line above its content, such as "Number of runs: the saved value 500 is above the
maximum 100, so the default 15 applies.", and uses the default until you configure it again.

Start keeps the layout and the widgets' settings on the server for your user, so the browser and VS
Code show the same arrangement; without sign-in there is one layout for the server. The chosen tab of a narrow panel
stays with this browser or VS Code panel. A widget added to the server later appears at its usual
place, and a widget you removed stays removed, also after it was unavailable for a while. A widget
that a plugin delivers only after Start opened, such as a global mini-app, takes its saved place and
width, also when it arrives while you edit, and a widget that cannot load shows why in its own place.

Each widget arranges its content for its own width. Template cards stand in several columns when
the widget is wide enough, between 240 and 320 pixels wide; in a widget narrower than about 450
pixels they become compact rows across its width with one line of description, as in the New
widget beside Continue.
It has no server block. **New** comes first; it stays empty, and so out of sight, when the selected
server does not permit you new runs. With "Show descriptions" off, every card shows only its title. The first
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

The new run always works in an open folder of the window, asking you to choose when several are
open. If the template defines its own workspace, such as one server folder per run, VS Code does
not ask. Without an open folder, VS Code does not start the run and asks you to open one first.
While the window is still registering as a workstation with the server, the run waits and a
notification shows the current step. If the server does not accept the workstation, the run does
not start either; an error message and Start name the cause, such as "Workstation not registered:"
followed by the server's reason. If the server refuses the folder when the run opens, the chat
shows "The run cannot start as prepared:" with the cause and does not send, and a template does
not open its setup dialog. Go back to Start and try again.

Until content appears, the panel shows a progress bar and the current step: starting,
loading, preparing, or setting up. A startup or setup error appears in the same place while the
chat input remains usable. The loading state disappears with the first mini-app or chat item; an
empty chat without a template does not show it. If a run cannot be started, for example because
the user may not create runs, the panel explains why and offers "Back to Start".
For a new run, the visible chat input receives focus as
soon as it becomes writable. Opening an existing run does the same for its selected chat partner.

**Continue** follows with this server's most recent runs, fifteen unless you configured another
number, in a fixed-column grid with status, title, and right-aligned time. Rows are
the same as in the browser: below the title the owner and short details such as the workspace,
the whole row is clickable, and a dot in the status icon marks activity you have not viewed in
any host yet. Shared runs carry their sharing icon next to the title, and runs you may share
end with "Share ..." (see [Share runs](#share-runs)). In a list narrower than 360 pixels the line
with owner and details is left out, below 280 pixels also the time; this applies on Runs too.
"All N runs" below the list opens this server's Runs page.
The trash button ("Delete run ...") beside a run on Start and Runs opens its deletion
confirmation. Runs shared with you have no delete button.
Plugin widgets follow Continue when installed, for example a list of work documents from all
runs you can see, with the same title row as New and Continue. Clicking such an entry can open its
run. Empty widgets show no heading or gap. If a widget fails, it shows its error and "Retry" in its
own place, and the rest of Start keeps working.

**Runs**, "All runs", shows this server's complete list in the same card, with search, "Hide ended", and a
selection mode that deletes several runs after a dialog confirmation. Checkboxes occupy an
additional first column; row actions disappear during selection. A run the
server has locked, for example because its journal uses an older format, shows a warning icon
whose accessible name identifies the cause; it does not open, but the selection mode deletes it.
"Shared by me" shows your outgoing shares, recipient access, and direct revocation; the same
tabs and actions are available in the browser.

**Server** is the configuration page. You can add, edit, sign in, sign out, connect,
disconnect, and remove servers with confirmation, then open `settings.json` from the link
at the bottom. If a connected server does not accept this window's folders as a workstation, its
entry says "Workstation not registered" with the cause, and new runs there that need the
workstation are refused with it.
Before registration, the entry shows `Fetching host package <version> ...` and
`Provisioning workstation tools ...`. If npm and the server download cannot supply the host,
or the download's integrity differs, the entry shows the cause. Every registration selects and
verifies the server's exact host version and provisions its tools, even if no executor
contributions are requested.

Extension and server do not need the same RAgents version: the interface comes from the server,
and only a small contract between the two must match. The extension compares the number of that
contract, its extension interface, with the number each server reports, not the release versions;
while both numbers are equal, a different release shows nothing. A server that reports no number
is older than this check and gets a warning: "RAgents server 0.1.8 predates the extension
interface check - update the server to 0.1.9." A different number is an error: "RAgents extension
interface does not match: extension 0.1.9 (interface 1), server 0.1.10 (interface 2) - update the
RAgents extension to 0.1.10." The lower number decides what to update: the extension, the server,
or for a local profile the local host ("bring the local host to 0.1.9"). The Server row, the
status bar, and a notification show the notice. When the server rejects the workstation because
the workspace executor versions differ or the host the extension uses lacks a plugin bundle the
server's executor carries, or carries it in another version, it is an error that also names the
server's cause: the notice continues with "The workspace is therefore not registered: ...", and
with equal numbers it reads "RAgents revision does not match the server, the workspace is not
registered: ...". The notification appears once per server and message; "Show extension" opens
the extension page for the update, and "Show servers" opens the Server page.

Every status uses a colored icon and an accessible name with the same vocabulary everywhere. A run is
"running", "stopped", "waiting for input" (with the number of open inputs),
"idle", "ended", "failed", or "cancelled". A
server is "connected", "ready", "starting", "sign-in required",
"unreachable", "stopped", "failed", or "no access". Time is compact and omits "ago": `now`, `5min`,
`3h`, `2d`, then a date after seven days. A function or mini-app name never appears as a status.
Status icons never resemble a stop button: a stopped run is a slashed circle in the warning color,
cancelled work a slashed circle in the muted color, ended work a check mark, and idle work or
a stopped server an empty circle.
Actual stop buttons consistently use a filled red square: "Stop
run" in the run-panel header, Run details footer, and run menu, "Stop work" beside the
chat input, and the stop controls for run processes.

"Stop work" interrupts only the running turn of the actor you chat with. It appears while that
actor has a turn; the working animation in the chat follows the same signal. The text already
written stays, and agents the coordinator started keep working; their next report starts a new
turn of the coordinator. Other actors' work shows in the working-agent count below the input.
Every turn that no message of yours started carries a line about its trigger in the chat, such as
"New turn, triggered by turn.finished of @implementer"; a message from another actor shows quoted below its line. "Stop run" stops all running turns, a
running start, processes, and other external work, without confirmation. Every
active actor remains available, but no turn starts on its own. One line above the input says
"Stopped", or "Stopped - 3 inputs waiting" when inputs have arrived. Your next message
continues the run and reaches the primary actor together with everything that waited, your
message last; other actors wait until directly addressed again.
To stop a single actor for good, use "Stop" on its actor card. If a chat's actor has
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
run is created. The "Share run" dropdown opens below the header or the row's share action and
uses the same panel and content in both places. It names the run and shows a list: "Everyone"
first, then every other user of the profile, each row with the segmented choice "Off", "View", or
"Operate". Names and controls line up in two columns; a long name wraps in a
narrow panel, while its control stays on one line.
View lets the user see the run; Operate also lets them work in it within their own permissions. A user gets the higher of
"Everyone" and their own row. Every choice saves the whole sharing immediately and keeps the
dropdown open with the saved state. Access controls are briefly disabled while saving. If the
server refuses, the reason appears inline and the choices return to the server's saved state.
There is no Save or Cancel. Escape or clicking outside closes the dropdown. The panel is the
same in the browser and in VS Code; the labeled header button wraps with the other actions when
space is short.

To inspect your outgoing shares together, open All runs, then "Shared by me". It lists your
shared runs with Everyone and the individual recipients, each marked View or Operate. Search
matches run titles and recipients. "Revoke" removes that recipient's grant; "Revoke all"
removes all sharing of that run. Removing an individual grant keeps access granted through
Everyone. Changes affect the current server state and preserve other recipients' shares.
While a request is pending the revoke buttons are disabled; a refusal stays inline for retry.
You can see your own shares with read-only access, but changing them requires sharing rights.

"View" shows the run, its chat, apps, and journal as far as your own permissions go, but
operates nothing: the run header shows "View only", the chat input is disabled with "Shared with
you for viewing only", and "Stop run", "Run script", answers to questions, and app actions are
missing. "Operate" works in the run within your own permissions, and the header shows "Shared".
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

The actor keeps one external session between turns. Server restart recovery leaves its active
turn interrupted without sending a replacement task. On your next message, its session can
continue only when the adapter advertises session loading and can load it. Otherwise it reports
a blocking cause; no empty conversation silently replaces it. Text is always supported; images
and embedded resources require the adapter's advertised capabilities. Missing installation,
sign-in, unsupported content, and workspace refusals show their causes in the actor's history.

## Control RAgents as an agent

An AI agent working on the same machine controls RAgents through six `ragents` subcommands. In
a checkout, use `pnpm ragents <command>`. These commands are the agent-facing contract: `run` and
`send` wait for the turn to end, and every command returns an exit code.

```sh
ragents provision developer                                  # once per machine
ragents run selftest/workspace-project "Fix the type error in src/broken.ts"
ragents send <runId> "Read README.md and report the passphrase"
ragents journal <runId> --tools
ragents stop <runId>                                         # stop all run work until the next send
ragents stop <runId> --turn                                  # interrupt only the primary actor's active turn
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

`--entry <template>` additionally starts the run through a skill or script template, and
`--parameters <json>` passes a script template's parameters as a JSON object (`ragents.chat.start`).
If that program chooses its chat partner during setup, the task waits instead of failing. `send` performs the
same operation in an existing run. `journal` reads the history from the profile's data directory
without a server, using the same code as `pnpm driver journal`; with `RAGENTS_URL` set, it reads it
from the server through `ragents.runs.events`, which requires `runs.inspect`. `stop <runId>`
stops the whole run through `ragents.runs.stop`: it records the stop before interrupting all
running turns, aborts a running start, and ends processes and other external work. Every active
actor stays active, no turn starts on its own, and incoming inputs wait. `send` continues the run;
its message reaches the primary actor last, after everything that waited. A sub-agent continues
only once it is addressed again. `stop <runId> --turn` interrupts only the active turn
of the run's primary actor through `ragents.runs.interruptTurn`: the run and all actors stay
active, and without an active turn nothing happens. `stop --host` terminates exactly the PID
in `host.json`, never a process pattern, and only if the host at the recorded address reports that same PID from
`/health`; otherwise it fails, leaves the process alone and removes the stale record.
`script <runId>` lists the run scripts through `ragents.runs.scripts`, one per line with id, title,
and the reason if one cannot join; `script <runId> <entry> [--parameters <json>]` starts it inside the
run with its parameters as a JSON object through `ragents.runs.startScript` as the run's user and prints `script: @<handle>, start <n>`;
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

The address comes from the profile's `host.json`, then `RAGENTS_URL`, then `host.PORT` and
`host.BIND_ADDRESS` in the profile file. When authentication is required, `RAGENTS_TOKEN` is sent as
a bearer token. The data directory is the server's `DATA_DIR`, then `host.DATA_DIR`, then
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
PRODUCT_PROFILE=showcase pnpm driver stop <id>               # stops all run work until the next message
PRODUCT_PROFILE=showcase pnpm driver stop <id> --turn        # interrupts the primary actor's turn
```

`new-run` starts a run script; without an argument it uses `ragents.reference.shared-actor-list`,
which only `showcase` contains, and `new-run <template>` selects another one.

The address comes from `host.PORT` and `host.BIND_ADDRESS` in the profile file, with
`RAGENTS_DRIVER_URL` as an override; the data directory comes from `DATA_DIR` or the profile
default. If the profile defines users,
`RAGENTS_DRIVER_USER` is required. The driver reads that user's password from the same profile
file and signs in through `POST /api/access/login`. If `ACCESS_TOKEN` is set, it sends that as a
bearer token instead. The driver uses `ragents.chat.start`, `ragents.chat.sendToActor`,
`ragents.runs.view` with `ragents.runs.stop` for `stop`, `ragents.runs.interruptTurn` for
`stop --turn`, and `ragents.runs.list`, while reading the journal directly from
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

A run script is started like a function with named parameters. `ragents.runs.scriptParameters`
with `runId` and `entry` returns the parameters a template declares as a closed JSON Schema object
(property kinds string, string with `format: "model"`, integer, number, boolean, or a choice of
strings; required ones under `required`), and `ragents.runs.scripts` lists them per template.
`ragents.chat.start` with `runId`, `entry`, `parameters`, and optional `options` (start option
values by id, for a new run) starts a new run in one call; invalid parameters are refused with
`parameters-invalid` before a run exists, the message naming every violation and all parameters:

```sh
curl -s http://localhost:4710/rpc -H 'content-type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"ragents.chat.start","params":{"runId":"<new-uuid>","entry":"demo.review","parameters":{"topic":"Release notes","rounds":2}}}'
```

A run script whose `RUN.md` sets `embeddable: true` also starts inside a running run:
`ragents.runs.startScript` with `runId`, `entry`, and `parameters` waits and returns the script actor,
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
- `--bind-address A`: the interface to listen on instead of `host.BIND_ADDRESS` from the profile
  file, an IPv4 or IPv6 address or `localhost`; without any, the server listens on all interfaces,
  and a private port from `--port 0` on `127.0.0.1`.
