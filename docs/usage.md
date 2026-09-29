# Usage

What a user sees and does in the web interface, in the run panel, in the VS Code extension, and
from the command line. Installation, startup, access, package, distributed work, and data storage
are in `docs/operations.md`, build, checks, and publishing in `docs/development.md`. How agents use
TypeScript functions, snippets, actor programs, and run scripts is in
`docs/spec/typescript-platform.md` and `docs/spec/actor-programs.md`; the structure of the system
in `docs/spec/`, the why in `docs/decisions.md`.

<!-- guide:getting-started -->
## Create your first run

The top-left corner opens the run overview. Choose "New run" to open the start selection. It
shows the same tiles as the start page in VS Code: "New chat" or the server's default
template first, then skill templates with a prepared task and script templates with programmed
setups. "New chat" opens an empty run whose task you write in its chat; a template starts with one
click. Some templates collect values in a setup dialog first ("Set up"); a skill template then
continues in the preparation chat. There you can discuss the task, give a clear go-ahead such as
"Start", or choose "Create run". Merely confirming a detail does not start
anything. In the browser a new run always works on the server; only VS Code and `ragents run`
bind a run to a workstation.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear on
the surface when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Use the surface

A run's surface consists of tiles. Each tile shows an actor or mini-app, and together they
fill the available space. There is no panning or zooming. Tiles use flat surfaces, outlines,
and rounded corners without depth. Mini-app content appears at its original size both in the
tile and in full view.

Drag an actor or mini-app from the header onto one of a tile's docking targets. Left and right
create a side-by-side split; top and bottom create a vertical split. Targets at the outer edge
split the entire surface. Before you release, a preview shows the resulting area. Drag an
existing tile by its title bar; the X removes it from the layout. Its content remains available
through the header. Without access to the actors view, removal and reordering are disabled: the
X and drag handle are hidden. Dividers for adjusting size ratios remain available.

Drag a divider to the desired ratio; releasing it saves the value. Escape cancels the active
resize. With keyboard focus on a divider, arrow keys change its size while Home and End set the
allowed limits. When space is tight, the "Visible tile" selector displays one item at a time
without discarding the layout. You can also ask the coordinator: "App on the left, chat on the
right, 50:50" or "One tile on top, two below at a 2:1 ratio." Until a layout is specified, the
surface arranges visible participants itself. Your changes remain saved until the program
changes its layout. A new program layout is applied automatically so added tiles appear at
once. "Apply program layout" in the status bar can reset your own layout earlier.
<!-- /guide:getting-started -->

## Switch runs

The square corner at the top left of the header (or `Cmd+I` on macOS or `Ctrl+I`) opens the run
overview as a modal dialog below the header, including the bottom status bar. The header stays
usable. The run cards show
title, processing status, creation date with time, last update, and additional plugin details. The cards are grouped by
last activity into Today, Yesterday, and further days; blue marks running
work, a violet hint new activity since you last looked, and this personal
read state applies per user in this browser. Selecting a card
opens the run and closes the overview. Clicking the corner again, Escape, or a
click on the dimmed background closes it and returns focus to the corner.
"New run" in the run bar switches to the start dialog. Creating as well as single and
multiple deletion appear depending on your permissions; the multiple selection offers All, None,
and a deletion confirmation. Deleted runs disappear from the list immediately; the server then
handles the cleanup (processes, working directory, archive) in the background. Errors stay
visible. Long lists can be scrolled. A run whose journal the server could not load (for example
an older file format) appears in the overview in red as "Locked" with the cause. It
cannot be opened, but it can be deleted individually or in the multiple selection; deleting moves
its files unchanged into the archive. With sign-in, only someone who may see all runs sees such a run.
As long as no finished automatic title exists, the run list shows the original
task. After successful generation and storage, the short heading appears without
waiting for the next regular list refresh. When generation is disabled or has failed, the task
stays visible. Titles deliberately set in the run or setup take precedence;
a different model selection does not rename existing titles.

The global coordinator sits directly in the header, independent of this. Opening the
run overview closes its history, but keeps the conversation, draft, and attachments.

## Run chat and surface

The narrow status bar at the bottom edge of the window spans the entire application width. It
holds `Journal` and, as soon as you have rearranged something yourself, "Apply program layout".
Conversations live in the tiles and in the
actor pop-outs. By default, the run coordinator is only reachable in the actor bar above the surface.
Clicking its entry opens the chat as a pop-out below it. These
chat views are up to 784 pixels wide and adapt to narrow windows. Other
LLM entries open their chat, TypeScript entries their actor view.

Pop-outs keep a small distance from the control that opened them. Dimming pop-outs, dialogs,
and the chat sheet use the same stronger background. In the addressee pop-out, the
search by handle or task sits directly next to the title and also searches hidden actors.

Clicking again, Escape, clicking outside, or the X in the pop-out header closes the pop-out; unsent text is kept
when closing and switching actors. Through the actor list you can additionally give it its
own tile. In the view bar, the speech bubble selects the history, the other
icons each select a detail view. For actors with an installed program, the Code tab shows
the TypeScript sources and other files of that version, with file selection and syntax highlighting.
This also applies to TypeScript actors without a mini-app or published functions. This
requires the technical read permissions.
On the left of the actor bar above the surface, `Show` switches between `All`, `Active`, `Visible`,
`LLM agents`, and `TypeScript` without changing its width. The default is `Active`;
`All` additionally shows stopped actors. As long as no actor is stopped, both look the same.
`Visible` shows only actors that currently have a tile, and always the
primary actor. The two type filters also show stopped actors
of the respective type. The actor list and chats open at the same distance directly below the button.
This only changes the direct actor entries and does not change the layout.
The selection is stored per run in the browser. Under `Actors` you always find the
complete list. Buttons of open pop-outs stay visibly pressed.
The message draft is kept when switching. In the primary actor's chat,
`Stop run` with confirmation stays reachable.

`Journal` in the status bar opens the actual events of the run above it.
The newest come first; the search finds event contents and actor handles. An entry
can be expanded to the complete JSON. Initially 100 matches are visible, more
can be loaded. The open view follows changes of the run and offers Refresh.
Clicking outside or tabbing out of the view closes it; Escape and X return focus to Journal.

`Actors` in the actor bar above the surface lists all participants, including you and stopped
actors. Click the name of an AI or TypeScript actor to open its chat and
details on the right; this does not create a tile.

On the right of every entry is the `Surface` checkbox. Without your own choice, the main actor and
actors with their own mini-app are not on the surface; that way the app needs no additional space
for its owner. All other actors are on it. The checkbox affects the initial
layout of a run without a preset and the actor selection of the run panel; it does not change an
already saved layout. The selection is kept in this browser per server address
and run; read permissions are enough. It changes neither the run nor its journal.

The tab icons at the top next to Settings and Help select the bar's view.
The panel button in the same title bar collapses it completely. After that, only the button
for opening it is visible; it restores the last used width. Selecting
a name in the actor list opens the bar as well. Visited views keep their state.
The icon names appear after 50 milliseconds of hover or immediately on keyboard focus directly
below the header. When moving to the next icon, the hint stays visible and changes
immediately; small gaps between the buttons do not interrupt it.
The panel button is as large as Settings and Help; Escape removes a visible
hint without moving focus.

Input directly in an agent tile is sent to the
respective actor. As in the actor chat of the bar, attaching files and the display of the
steps from hidden to complete are available, without model or thinking level selection.
The "current" mode shows the running step as a quassel chip. For access without technical
read permissions it says "Thinking" or "Tool running", without tool names, contents, or
expandable details. When the step ends, the chip disappears; a message you
send in the meantime leaves it in place. The animated
work scenes stay visible as long as the agent is working, also during longer thinking pauses.
In the run chat they run as long as any agent or program of the run is working, that is, also
while the coordinator is waiting for actors it has tasked; tiles and pop-outs show only the
respective actor.
Sending requires write permissions on the run and an actor that is not stopped; failed inputs
remain available through the shared chat input. Every tile scrolls its own content;
at the end of the history it automatically follows new messages again. You open the chat with all details
through the actor list or the direct entries in the actor bar above the surface.

History and input use the same available width. In every chat, also with a different
addressee, in tiles, in the preparation chat, and with the global coordinator, the clock button
at the bottom next to the step display switches the timestamps on and off. The choice is stored in the browser per run
and actor and applies wherever this chat appears. The arrow to the end appears
only at a distance of more than 120 pixels; scrolling back a little still keeps new responses at the
chosen reading position.

Details of the chats and tiles: responses appear as Markdown already during output,
with headings, lists, tables, and code blocks; formatting that is still open is
rendered provisionally. On your own messages, a copy icon appears at the top right on hover or
keyboard focus; it copies the original text with its
line breaks and confirms with a check mark.
If you send another message while a response is running, it does not wait for the end
of the turn: an agent feeds it into the running turn before its next model request
(steering). During this time the send button is labeled "Feed into running turn", and the
history shows "Fed into running turn" below the message. A TypeScript actor and
a text over 30000 characters, however, get their own turn. The response stays
together before your new message. An open question appears in every chat with
input directly above it, in the run chat as in tiles and in the run panel, and you answer it
there too; several are stacked, and if they take more than half the chat height, this area scrolls
on its own. Once answered or discarded, it moves as a record to its place in the history. With read access
you see the question and options without controls. If the agent is currently waiting for you to answer its
question, your message counts as skipping: the question closes as not
answered, and the agent reads your message. If your message is still unread with it
when it wants to ask, the question does not appear at all. Below the last entry, about two
lines of free scroll space remain. If the chat's actor currently has a turn and the input is empty,
"Stop work" interrupts only this turn; the actor then accepts the next message.
If it is stopped, the reason together with "Restart" appears in place of the input. The display of tool calls
(icons, compact lines, complete) applies per chat; other chats and runs keep their
setting, as do the width and collapsed state of the bar per run. With many entries
in the actor bar above the surface, arrow buttons for scrolling appear on the left and right; the
mouse wheel and trackpad also move the entries horizontally. Mini-apps get a shared
inner padding in the tile; their scrollbar sits at the right edge of the tile, and the space for
status messages below the app content stays reserved, so that the start, completion, and errors of an
action do not shift the app. Every sub-area can be split again, for example into one upper
tile and two lower ones at a ratio of two thirds to one third; coordinators can also set such
layouts on request.

## Attachments in the chat

The chat input clears text and attachments immediately on sending. Until the request ends,
further send actions and new attachments are blocked. You can start a new text as long as
the respective view allows input. On an error, the original input returns
automatically if you have not changed anything in the meantime. Otherwise your new text stays
unchanged; the failed task is available separately with a preview. With
"Insert unsent input" you append it together with its attachments to the current draft.

Images, videos, and files can be dragged into the chat input or selected through the attachment
button. You paste images and files from the clipboard with Cmd+V or Ctrl+V.
Before sending, previews with file names and a remove button appear. You can also send without
additional text. This applies to new runs, the global coordinator,
the actor view, and chat controls in actor views.

A message takes up to eight files with a total of 20 MiB. Images, videos, and native PDFs
need a suitable model; the input reports missing capabilities and keeps the selection.
Text files are read as UTF-8. Other files are available to the agent through its file tools:
they are stored under `attachments/` in the run's workspace, so with a workstation
on its machine; their further processing depends on these tools. On errors,
the message and files stay in the composer. You can download sent attachments again from the history.

## Selectable model

If the product allows it (`MODEL_SELECTABLE`, preset to on in `core`) and the user's
permissions allow free starts (`runs.create`), writing (`runs.write`), and technical views
(`runs.inspect`), you choose the coordinator's model in the run's chat input, in the browser
as in the VS Code run panel, through a keyboard-operable selection menu to the right of the
input's switches. The thinking level sits compactly next to it as a second selection menu and offers only
the levels of the selected model, including extended levels such as `max` where
supported. `AGENT_MODEL_REASONING` is only needed to deliberately restrict these
model capabilities; invalid levels abort the configuration.

If the profile works with aliases (`MODEL_ALIASES` in the `host` section, `AGENT_PROVIDER: "alias"`
in the product plugin), the selection shows only the alias names, without provider and without the real
model name, and the journal stores the same names. The thinking levels are those of the model behind
the alias, unless the alias offers its own with `thinkingLevels`; then exactly this
selection appears in the menu, and a chosen level goes out as the model level it points to.
If an alias brings its own thinking level (`thinking`), it is preselected when switching to this alias.
Each alias also states from how many tokens on the history is compacted
(`compaction`, rules in [profiles.md](spec/profiles.md)):

```typescript
host: {
  MODEL_ALIASES: [
    { alias: "team-standard", model: "openrouter/z-ai/glm-5.3-flash", thinking: "high",
      compaction: { threshold: 160_000, keepRecentTokens: 24_000, summaryTokens: 12_000 } },
    { alias: "team-fast", model: "openrouter/z-ai/glm-5.3-flash", thinking: "low",
      compaction: { threshold: 100_000, keepRecentTokens: 16_000, summaryTokens: 8_000 } },
  ],
},
"ragents.product": {
  AGENT_PROVIDER: "alias",
  AGENT_MODEL: "team-standard",
},
```

The choice is already available in the empty run after "New chat" and then applies to the first turn;
without a choice the run starts with the default from the settings. After that it stays in the same
input and applies from the coordinator's next turn; a running turn keeps its model, the
history is preserved. If the conversation already contains images, videos, or files that the new
model cannot process, the server rejects the switch with a reason. Without one of the
permissions, the selection is missing entirely, and the server rejects a choice. In the preparation chat of a
skill template with a guide, the same selection is in the task input; the input starts
there with three lines and grows up to eight lines, further start options are below it.
Only selectable, unlocked start options are offered.
The choice is `AGENT_MODELS` - a REAL list in the configuration file, not a value
with separators:

```ts
AGENT_COORDINATOR_MODEL: "deepseek/deepseek-v4-flash-0731",
AGENT_COORDINATOR_THINKING: "off",
AGENT_MODELS: ["qwen/qwen3.8-max", "deepseek/deepseek-v4-flash-0731", "z-ai/glm-5.3"],
```

Without `AGENT_MODELS`, the models the product configures anyway are available, each once,
even if agent and coordinator name the same model; a model must not appear twice only in an
explicit `AGENT_MODELS`. The server does not accept models of other profiles or free names. The
choice applies to the coordinator; unlike the system prompt, it is not frozen with the
first message.
`AGENT_COORDINATOR_MODEL` is the explicit default and not simply the first list entry.
It must be in `AGENT_MODELS`; a contradictory configuration hard-aborts the startup. The
`relay` profile starts with the same model and the same coordinator thinking level. Under
Settings, Models, it can get its own default for new relay actors.

## Selectable system prompts

The core itself no longer brings ANY content system prompt. `ragents.product/preamble.hbs`
only says that you are running as a coordinator in RAgents; the mechanics are with the plugin that
explains them (profiles and the restart rule in `ragents.orchestration`, `ask_user` in `ragents.ask`),
and tone and behavior come from the prompt files.

Every `.md` or `.hbs` in a plugin's `prompts/` folder or in `SYSTEM_PROMPTS_DIR` is an
entry of the list: ID = file name without
extension, label = first `# ` heading. In the preparation chat you switch them on and off individually -
SEVERAL at the same time are allowed, the order in the prompt follows the catalog, not the
click order. The text goes into the prompt IN ADDITION to the preamble and is frozen with the first message.
`SYSTEM_PROMPT_DEFAULT` accordingly takes a list of IDs.

The "Also pass on to the agents" checkbox in the preparation chat decides the scope:
without the check mark, the prompt applies only to the coordinator; with the check mark, it is also in the
system prompt of every agent the coordinator creates. Plain LLMs with `tools: []` are deliberately
excluded and receive only their own prompt. `SYSTEM_PROMPT_SHARE_DEFAULT=1`
presets the checkbox; the scope is frozen into the run's journal together with the selection.

The file storage stays isolated per run
(`sessions/<id>/plugins/ragents.documents/documents`, service `documentStoreToken` of
`ragents.documents`); `DOCUMENTS_DIR` places it with one subfolder per run under an
external path, but deliberately stays unset so that test runs never write into someone else's
storage. A system prompt of the same name in the plugin folder and in
`SYSTEM_PROMPTS_DIR` is a hard error.

## Skill templates in the start selection

The start selection shows every template as a tile with category, title, and description, in the same
form as Start in VS Code; categories are freely chosen and not a list from the code. Every
skill template contains a short, freely worded start task that describes the desired result
without platform knowledge; its `description` explains what the demo is meant to show. The
settings show the same prompt with a copy action. Format and rules of the templates are
in [plugins.md](spec/plugins.md) under "Skills and starting tasks" and "Reference cases from
ragents.reference", the templates and building blocks of the actor programs in
[actor-programs.md](spec/actor-programs.md).

"Start" starts the run immediately with the skill's task. "Set up" first opens the
guide; after that it leads into the preparation chat in the next dialog step. There the
task can be discussed with a separate coordinator instance, and model, thinking level,
system prompts, and workspace are available for selection. After your explicit go-ahead in any wording, it starts
the run; no fixed sentence is needed. "Create run" starts directly. Both paths take over
conversation, skill, and attachments; the button also takes the last unsent addition. Back
discards the local preparation history and leads to the start selection. At startup, the
skill is taken over with the task; the edited task takes precedence over example text in the skill.
As the machine, the workspace in the browser offers only the server, in the VS Code run panel also
the connected workstations.

## Start run scripts

The homepage samples are available in the start selection as run scripts: collection board,
balcony wizard, study afternoon, and word game. In the built-in help, "Start sample" selects
the matching template directly. An existing setup dialog still comes first.
Word game and study afternoon first set up their participants and mini-app without a model call;
the work begins with the start button in the app. Their homepage previews use
the same interfaces with labeled example data and do not call any models.

How a run script is structured, which start value it receives, and how `fixed-start-options` fixes a
start option is in [typescript-platform.md](spec/typescript-platform.md) under
"Run scripts as prepared actor programs" and in [plugins.md](spec/plugins.md) under
"PluginHost registrations"; the setup dialogs of the reference cases under
"Reference cases from ragents.reference".

## Settings

The surface in the Schichtwerk style shows matte tiles with rounded edges, without depth.
Lavender marks the main actor, clay color other AI actors, mustard yellow
TypeScript actors, and blue-gray the mini-apps. The fronts stay straight and even.
Round buttons with an X close dialogs; a round arrow leads back to the previous view.
The hints on the button name the respective action.
Selection menus open above or below their button depending on space and stay fully reachable even in narrow
input and dialog areas. Escape first closes the open menu.

Under "Appearance", "Schichtwerk" you choose Light, Dark, or System. The default is Dark;
System follows the operating system's color scheme setting, also on later changes.
The choice immediately affects the interface, tiles, and shared actor view controls, without reloading chats
or apps. It is stored in the browser for the same server address and synchronized with
other open tabs. Changing it requires settings write permissions.
Your own fixed actor view colors stay in place. Colors, fonts, radii, shadows, and
animations are maintained centrally for development in `apps/web/src/ui/theme.css`.
Actor views use the same shadcn/ui controls as the host, with the colors from the tokens.
They follow the same light/dark choice; there is no separate selection for them.

The gear first opens "Models". "Global coordinator" changes its own selection
from the next work step. The first global selection is stored independently and
stays separate from the product defaults even after a restart. "New runs and agents" offers model and thinking level for every role of the
product; in core these are coordinator, relay, and standard. Save the
complete draft. New actors and defaults of runs not yet started use it
immediately; existing actors and an explicitly made start selection are kept.

The selection contains only configured models and their supported thinking levels; invalid
drafts are rejected before saving. The available model list is still maintained in the
profile file. Storage, precedence, and startup errors of the saved defaults are in
[profiles.md](spec/profiles.md) under "Editable model defaults".

The coordinator's role is called `coordinator`, that of the agents `standard`. Under
"New runs and agents" you can choose their thinking levels separately. The defaults are in the
profile file, in core under `ragents.product`:

```typescript
AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash",
AGENT_COORDINATOR_THINKING: "high",
AGENT_MODEL: "z-ai/glm-5.3-flash",
```

A product plugin can register further roles with its own keys; saved roles
can be edited separately. The current model catalog offers `low`, `high`, and `max` for
GLM 5.3 and GLM 5.3 Flash.
Saved model settings take precedence over the profile file. Changes
in the interface apply to newly created actors without a restart; config and run prompt changes
require a restart and, for the new coordinator prompt, a new implementation run.

Under "Headings" you independently choose the model for short automatic
list titles. With a large model list, the search helps. "Save" applies the selection,
"Discard changes" discards only the draft. "No automatic headings" followed by
saving disables new generations; existing titles are kept.
The selection applies from the next generation and does not change any agent models.

Offered are text models of the configured `COMPACTION_PROVIDER` that can work without
reasoning; default, storage, and error cases are in [profiles.md](spec/profiles.md) under
"Model for automatic headings".

"Appearance" contains the interface choice and the run panel settings. "Plugins" contains
"By plugin" and "By capability" as technical catalogs with search. Clicking the
owner opens the complete plugin page. "Runtime" shows technical facts,
models, profiles, and the system prompt. Models and Appearance work independently of
loading these catalogs. Plugin forms are additionally reachable at their plugin.

Under "Run panel" you determine from which panel width the chat sits to the right of the mini-app
(default 900 pixels) and how sluggishly the sheet reacts to the mouse (default 160
milliseconds until it slides up, 150 milliseconds until it slides back). Changing it
requires settings write permissions. The setting stays stored locally in the browser for the same server address
and is not saved as a profile value on the server. Reset restores
the defaults.

## Global coordinator

With `ragents.overseer` in `host.PLUGINS`, the "Global coordinator" input sits to the right
of the overview buttons. Focusing the input expands the history
below it. Enter sends, Shift+Enter inserts a line. The input stays at the top; attachments
can be selected, dragged in, or pasted as in other chats. The dropdown holds
history, model choice, reasoning, details, and reset. Send and stop stay at the input.

`Reset conversation` sits next to model and reasoning in the global chat's dropdown and opens
a dialog over the entire global chat. Its background becomes blurred and cannot be
operated in the meantime; focus starts on Cancel. The confirmed action deletes
history, input draft, attachments, and model context, and first stops a running response. Normal runs,
their journals, and the model and reasoning choice are kept. After completion, the
next message starts a fresh conversation. On an error, a message stays visible;
a started reset can be repeated and is completed after a server restart.
There is no automatic reset.

You choose model and reasoning level in the dropdown above the history. You find the same selection
in the settings under Models and at `ragents.overseer`. It is stored per profile
and applies from the next work step; a running response is not
switched. Other runs keep their models. An incompatible model, for example one without
support for images already sent, is rejected and the previous selection stays.

When sending, the global coordinator learns whether you are on the start view, in the run overview,
or in a run, which area you have opened, and which element you have selected.
For example, open the Files tab and ask at the top "What is in this run?".
Run title, short run reference, and actor name are added on the server; you do not need to
copy them. Your visible question text stays unchanged.

This orientation captures the state at the time of sending. If you switch the run afterwards, the
question already sent still refers to its original selection, even if it is still
in the queue. Without a UI detail sent along, there is no current location.
Through this context, the coordinator receives neither screenshots nor form texts nor
complete run contents. The detail helps with assigning your question and grants no
additional task; a view change alone triggers no model request.

Escape first closes an open selection menu and then the history. A click outside
or tabbing out of the entire area closes it as well. This ends no work and
discards no draft. Overview, Settings, and Help close the history; on a
run switch, conversation and input are kept. The overview corner and `Cmd+I` or
`Ctrl+I` open only the run overview.

Only the first opening connects the stream. Already during the send request and afterwards while
work is running, the frame around the input pulses, as with working agents in their tile.
With reduced motion
the frame stays highlighted. A lost connection blocks sending, but keeps the draft.
After reconnecting, short answers from the meantime are taken into account, without showing old toasts
again on the first connection or a replay.

Every signed-in user has their own global coordinator; without sign-in there is exactly
one. It oversees the runs its user sees, reads their journals, and can start new runs
with a task or an installed run script; it acts with the access and
permissions of its user, and new runs belong to that user. Created runs can be opened
through the run list. The stop button at its input appears only while the global
coordinator itself has a turn, and interrupts only that turn; it stops another run on
request through the management methods. Without write permission,
the read-only input stays focusable and opens the readable history; sending is
blocked. There is no additional dropdown arrow.

For a brief answer, the coordinator can use `quick_answer`. The current user question
and its answer appear briefly summarized, each with at most 240 characters,
automatically directly below the header as a toast, also with the
history open. It uses the same background and the same distance as the hints of the
header buttons.
Clicking anywhere on the toast opens the conversation and focuses its input, with
read access the history. The X closes only the toast; the answer
opens nothing by itself and does not interrupt the current input.

The chat uses its own run ID per user (`overseer-...`, without sign-in
`overseer-single`) and the normal journal and run storage. The conversation of the former
shared coordinator (`overseer`) is not taken over and stays unchanged.
The short run references are stored permanently under `plugins/ragents.overseer/run-references.json`
in the data directory. The coordinator does not appear in the normal run list and cannot
be deleted. The bundled profiles contain the plugin; an additional
profile file must also list it in its plugin list.

If the fixed tool selection of the global coordinator changes, an existing conversation reports
`global-tools-changed` on the next send attempt. After the server restart, explicitly confirm
`Reset conversation` once, so that the next message starts with the current tools and
the new prompt instruction; an existing conversation is not adjusted automatically.

Tools, management methods, journal access, and access of the global coordinator
are in [core.md](spec/core.md) under "Global coordinator".

## Stop services and background processes

The process rail shows the run's background processes and services with open ports, on
the machine where the run works: with a workstation its processes, otherwise those of the
server. With write permission, the small stop icon ends exactly the selected process instance.
During the request its button is blocked; errors stay visible at the entry. The next
process state removes ended entries. When stopping and before deleting a run, the
run's executor also cleans up marked processes without an open port, on the workstation as on the
server. An open browser window is not needed for this. If the workstation is currently not
connected or does not respond within ten seconds, the server remembers the stop and
carries it out as soon as the workstation registers again, before any new task of this
run; until then the server log lists it as pending. A server restart forgets it.

How the executor ends processes (SIGTERM, SIGKILL, time limits) and which processes it can assign
to a run is in [plugins.md](spec/plugins.md) under "Workspace,
sandbox tools, and processes".

A deliberately detached Node service can keep running with `child_process.spawn` and the options
`detached: true`, `stdio: "ignore"`, `env: process.env`, followed by `child.unref()`.
On macOS and Linux this uses the Node process interface and needs
no external `setsid` program. The inherited `RAGENTS_RUN_ID` marker must be preserved
so that the service is found again when the run stops. The same mechanism applies regardless
of the interpreter used; without a marker there is no assignment to the run. Which processes the
process table cannot assign per platform despite the marker, such as programs from `/bin` on
macOS, is named in the same section of the spec.

<!-- guide:clients -->
## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows a run in a narrow layout with mini-app chips, the selected app, actor chips, chat, and the
tab bar on the right. Without `run`, it shows the run list with "New run" as the first
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

Once a mini-app is selected, three header buttons control the run-panel view: "Chat only"
(speech bubble), "Chat below" (a sheet over the app), and "Chat right" (beside the app).
"Chat right" is the default. While the panel is narrower than the
configured width, that option is disabled and the chat stays below. "Chat only" gives the chat the
entire panel: the mini-app
recedes, nothing slides in or out, and an open sheet closes cleanly. Switching back rebuilds the
mini-app, so unsaved input in it is lost. The choice is stored per run and survives a restart.
The extension can also open a mini-app as an editor tab in the center, which works well with
"Chat only" in the run panel.

In "Chat below", the handle controls the expanded chat height. Dragging up makes it taller;
dragging down makes it shorter. The chosen height is stored per run. The collapsed chat shows the
handle, status, and complete input, including multiple input lines. An open question sits
completely above the input there as well: the collapsed chat grows by its height, up to half of
the panel, and the status line reads "Waiting for input". Hovering or
writing opens the chat to the chosen height (90 percent of the panel by default). Dragging leaves
the chat open at its new height. Clicking the handle opens or closes it. With
keyboard focus on the handle, up and down change the height, Home and End select its limits, and
Escape cancels an active drag.

The collapsed chat keeps its rounded border, background, and shadow. The compact handle row
shows keyboard focus on the small grip itself.

The chip at the left of the chat input names the addressee, the actor your messages go to.
Clicking it opens the addressee list as a tree of who created whom, like the agent tree of a
coding assistant: the coordinator at the top, below it the agents and TypeScript actors it
started, below those their own subagents. Each entry shows the handle, a very short description
of its job, and its state: "working", "waiting for input" (waiting for your answer),
"idle", or "stopped". The description is the one given when the actor was
created, otherwise the first line of its first assignment, otherwise its display name. Four or
more similar siblings, such as 37 rule reviewers named `review-...`, collapse into one group row
with their shared handle prefix, their number, and a count per state; click it to open or close
it. A group that contains the current addressee opens by itself. With more than twelve actors a
search field appears above the tree; it matches every word against handle, display name, and
description and keeps the creators of each hit visible. Clicking an entry makes it the addressee
and closes the list. Hidden actors, as chosen with "Show" in the footer, sit in their own tree
behind "Hidden actors"; picking one of them also shows it again. In runs recorded before
actors had descriptions, the description falls back to the first assignment or the display name.

The extension lives under `apps/vscode`. It works with all configured **servers at the same
time**; there is no single active connection. A server in the `ragents.connections` setting is
either a server (`name` and `url`; it connects automatically when activated and its card asks
for sign-in in the panel) or a local profile (`name` and `profileFile`, the path to a
`ragents.config.<profile>.ts`). When activated, the extension starts a local profile silently in
the background with `--port 0`. The page shows "starting" and then "ready", so its card and
templates are immediately available; a stopped local profile can be started again from its chip. The
host runs until the VS Code session ends and terminates with it, even if the window reloads, VS
Code crashes, or it is forcibly closed. Before starting, the extension provisions the profile's
tools; the web interface comes finished with the host. With a checkout as host, the host refuses
to start while its built-in bundles or its web interface are outdated and names the build
command. If a server distributes a client profile, the extension
fetches it after sign-in like `pnpm connect`, starts its host locally, and supplies the token as
`RAGENTS_TOKEN`. If `ragents.hostPath` is empty and the extension is not running from a checkout,
as with an installed `.vsix`, it downloads the host itself:
`npm install --prefix <globalStorage>/hosts/<package-version> @schlenkr/ragents@<package-version>`,
using the `npm` available on `PATH`. For a distributing server, that server specifies the version
through `ragents.profile.describe`; for a local profile, the extension supplies its own
`ragents.packageVersion` from `package.json`, keeping extension and host compatible. npm progress
and output appear in the `RAgents` output channel. Downloaded versions remain installed, and a
failure appears as the reason in the server row. A local profile therefore no longer needs
a checkout. `ragents.hostPath` remains an override pointing to a checkout or installed package.
The status bar shows the number of connected servers and opens the start page when clicked. See
the root `README.md` for details.

Install the extension from the Marketplace as `purestate.ragents-vscode` using "Extensions:
Install Extension" or `code --install-extension purestate.ragents-vscode`. The Marketplace
delivers the build for your platform, which carries ripgrep for the `bash` tool (see
[Work on Windows](homepage/guide-distributed.html#work-on-windows) for the Windows bash). To install a locally
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
needs no checkout; it fetches the host from `@schlenkr/ragents` when first required by a
distributing server.

The extension is an app with four pages: Start, Runs, the run panel, and "Server". All appear in
the RAgents panel of VS Code's secondary sidebar. Navigation and commands live in the view title
bar, following VS Code conventions: Start (home), Runs (list), Server (gear), "New run", and "Refresh". They remain available
while the panel shows a run. Start has no separate page header; Runs and Server show their
title next to a back arrow to Start, and the run panel's back
arrow also returns there. There is no Explorer tree in the activity bar. The view badge counts
pending inputs across all servers.

**Start** begins with **Server**. Equal-width chips appear two per row at 420 pixels and in
a single row from 560 pixels. Each chip is a split button. Its left side shows a status icon,
name, and when needed an action label: none for a connected or ready server (clicking opens
Runs filtered to it), "Sign in" when authentication is required or access was denied,
"Retry" when unreachable or failed, "Start" for a stopped local profile,
and "Connect" for a stopped server. "starting ..." is not a button. A monospace line below identifies the server:
`local / <profile>` for a local profile, the server host and non-default port, or `<host> / local`
when a server distributes a client profile whose host runs here.

The right side contains a plus button for a new run. If the server's profile defines
`defaultStartEntry` (see [profiles.md](spec/profiles.md)), it starts that template; otherwise it
starts an empty chat. Without permission to start, an equally wide empty space remains. For a
failed, unreachable, or rejected server, its status icon is also a button. It opens a
popover with the status, full selectable message, "Open output", and either
"Retry" or "Sign in". A lock opens the same sign-in dialog.

Below that, **Continue** shows the five most recent runs from all servers in a fixed-column
grid with status, title, right-aligned time, and, when more than one exists, server. "All N
runs" opens the Runs page. **New** appears when at least one server is reachable and permits
new runs. Entries are grouped by server when needed. The first entry is its default template,
marked "Default", or "New chat" in the "No template"
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
explains why and offers "Go to Start". For a new run, the visible chat input receives focus as
soon as it becomes writable. Opening an existing run does not move focus there automatically.

**Runs** shows the complete list in the same grid, with search, "Hide ended", a server
filter carried over from Start, and a selection mode that deletes several runs after a dialog
confirmation. Checkboxes occupy an additional first column without shifting the others. A run the
server has locked, for example because its journal uses an older format, shows a warning icon whose
tooltip names the cause; it does not open, but the selection mode deletes it.

**Server** is the configuration page. You can add, edit, sign in, sign out, connect,
disconnect, and remove servers with confirmation, then open `settings.json` from the link
at the bottom. If a connected server does not accept this window's folders as a workstation, its
entry says "Workstation not registered" with the cause.

The extension compares its own RAgents version with the version each server reports. If they
differ, the server row, the top of Start, the status bar, and a notification show "RAgents
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
"running", "waiting for input" (with the number of open inputs),
"idle", "ended", "failed", or "cancelled". A
server is "connected", "ready", "starting", "sign-in required",
"unreachable", "stopped", "failed", or "no access". Time is compact and omits "ago": `now`, `5 min`,
`3 h`, `2 d`, then a date after seven days. A function or mini-app name never appears as a status.
Status icons never resemble a stop button: cancelled is a slashed circle, ended a check mark, and
idle or stopped an empty circle. Actual stop buttons consistently use a filled red square: "Stop
run" in the run-panel header and run menu, "Stop work" beside the
chat input, and the stop controls for run processes.

Stopping work in a chat and stopping the run are different things. "Stop work" appears in a
chat input only while that chat's own actor has a turn running, and it interrupts just that turn:
the text already written stays, running function calls are cancelled, and the actor stays active
and answers the next message. Actors it has started keep working, and when only another actor is
busy, the input pulses but offers no stop. To end everything, use "Stop run" with its
confirmation; to stop a single actor for good, use "Stop" on its actor card. If a chat's actor has
been stopped, the input is replaced by `@handle stopped: <reason>` and, with permission to operate
and inspect the run, "Restart". Restarting the former primary actor makes it the
primary actor again, and the run chat continues.

The arrow on a mini-app in the run-panel stage opens it as a central editor tab; "Back to panel"
closes the tab. Text artifacts and the journal open as read-only documents, while other artifacts
open in the browser. `RAgents: New run` uses a Quick Pick grouped by server and template.
The first entry for each server is its default, marked "Default", or the free task without
a template. The commands `RAgents: Disconnect`, `RAgents: Connect`, and
`RAgents: Sign out` apply to the selected run's server or ask when several match.

When the run chat or a hosted mini-app input has focus, VS Code shortcuts such as Cmd/Ctrl+P
and Cmd/Ctrl+Shift+P still work using your keybindings, including key chords. This also applies
to nested hosted mini-app frames. Text entry, selection, undo, and clipboard actions remain in
the input field. Dictation tools that paste their result, such as HEX, use the same input path.
Keys already handled by the chat or mini-app are not also executed as VS Code commands.
In a regular browser, native keyboard and clipboard behavior remains in use.

To make RAgents smaller or larger independently of VS Code's window zoom, set `ragents.zoom`
in VS Code Settings. The value is a percentage from 50 to 200, with 100 as the default;
for example, `"ragents.zoom": 90` makes the whole interface 10% smaller. It applies to Start,
Runs, Server, the run panel, and mini-app editor tabs, including nested mini-apps. Changes take
effect immediately without reloading the page or losing input drafts. Regular browser pages
are unaffected. This scales text, controls, and spacing together; it is independent of
`editor.fontSize` and the built-in chat font settings.

If a server profile requires users, both the lock on Start and the Server row open the
same sign-in dialog. For a profile with `ACCESS_TOKEN`, the dialog requests that token. User name
and password are stored per server address in VS Code SecretStorage and reused silently next
session. The session token is stored there as well and sent as a bearer token; iframes receive it
in their URL (the server accepts a bearer token or the `access` query parameter for GET requests).
After expiry or a server restart, that server asks for sign-in again without affecting others.
`RAgents: Sign out` revokes the session.
<!-- /guide:clients -->

## Settings and behavior of the VS Code extension

- `ragents.theme` (`auto`, `light`, `dark`) takes effect immediately.
- `ragents.zoom` (50 to 200 percent, default 100) scales the entire interface including
   mini-apps immediately, without reloading pages. VS Code's window zoom stays unchanged.
- `ragents.hostEnvironment` lists the names of the environment variables that a locally started
   host receives in addition to the inherited environment. The setting holds only names; the
   command "RAgents: Set secret" puts the values into VS Code's SecretStorage, "RAgents: Delete
   secret" removes them again. When a host starts, the stored values take precedence over
   the inherited environment; if one is missing, the `RAgents` channel names only its name, never a value.
   That way a profile that resolves values through `env("NAME")` also starts in a VS Code that
   comes from the Dock without the shell's variables.

If a server is unreachable, its row on the Server page shows the cause and "Retry", on Start
the same message sits behind the chip's status icon, and the
session retries by itself every five seconds; when connected, the list is reloaded every five
seconds anyway, the event stream reconnects after five seconds and reports the
interruption as a line below its server. The extension only becomes active when one of its
views is opened and does not connect in the background.

Limits: no code actions, no file synchronization, no operation without a server. A local
profile shows its templates only after startup.

<!-- guide:clients -->
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

stdout contains function calls (`> <name>`, then `< <name> <duration>s ok`, `error`, or
`cancelled`) as far as the server shows them to the user (`runs.inspect`), the model response,
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
<!-- /guide:clients -->
