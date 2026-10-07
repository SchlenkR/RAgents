# Usage

What a user sees and does in the web interface, in the run panel, in the VS Code extension, and
from the command line. Installation, startup, access, package, distributed work, and data storage
are in `docs/operations.md`, build, checks, and publishing in `docs/development.md`. How agents use
TypeScript functions, snippets, actor programs, and run scripts is in
`docs/spec/typescript-platform.md` and `docs/spec/actor-programs.md`; the structure of the system
in `docs/spec/`, the why in `docs/decisions.md`.

<!-- guide:getting-started -->
## Create your first run

Start shows one server's permitted templates under "New", then its five recent runs under
"Continue", then any plugin sections, in both the browser and VS Code. Templates begin with
"New chat" or the server's default template, then skill templates with a prepared task and script
templates with programmed setups. "New chat" opens an empty run whose task you write in its chat;
a template starts with one click. Some templates collect values in a setup dialog first ("Set up"); a skill template then
continues in the preparation chat. There you can discuss the task, give a clear go-ahead such as
"Start", or choose "Create run". Merely confirming a detail does not start
anything. In the browser a new run always works on the server; only VS Code and `ragents run`
bind a run to a workstation. VS Code binds every new run to an open folder of its window unless
the template sets its own workspace.

Before starting, "Sandbox protection" lets administrators restrict the run's server-side
code execution. For other users, or when the server requires it, the switch is on and locked.
The choice cannot change after the run starts. Workstation tools use that workstation's
permissions; server-side code still follows the run's protection.

A click shows its effect at once: either the run's progress appears, or the chosen entry shows
a spinner and "Starting ..." at the top right while the other entries stay locked until the
run opens or the start fails; a run script in the run header's "Run script" list does the same. While a template starts,
the panel shows its progress in the chat area and reserves the bottom status bar, keeping the
notice in place when the run connects.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear on
the surface when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Use chat and mini-apps

Activated visible mini-apps become available automatically, including those from an embedded setup.
Programs cannot arrange the host interface. Runs saved with removed layout functions or placements
are locked with an explanation; their original files are kept. Start a new run with updated programs.

Wide browser runs start with Chat beside the mini-apps; narrow ones use one tab group. Drag tabs
onto the docking guides to arrange areas or merge them. Chat and visited apps keep their input
through switches and moves. New apps appear without taking focus; unavailable apps disappear.
Close windows with X. Each window keeps a button in the header or sidebar rail; a pressed button is
visible, and clicking another one shows that window. Drag a header button by its grip to
reorder the buttons, or onto the docking guides to place that window. "Empty space" in the
header adds an empty pane that holds a place until you drop a window onto it. Every button stays
directly available; a narrow header wraps onto further rows and pushes the workspace down.
Drag a button between the sidebar rail and header to choose where it lives, or right-click it
and choose "Move to header" or "Move to sidebar". Shift+F10 opens the same menu from the keyboard.
Moving a button keeps its panel's open state; "Reset layout" restores the plugin defaults.

In VS Code, clicking an app opens or focuses its editor tab. VS Code controls where that tab
appears. Questions and news stay in chat. The selector below the input chooses the addressee;
the run coordinator is selected by default.

<!-- /guide:getting-started -->

## Switch runs

Click the logo at the top left ("Back to Start") to see permitted templates, recent runs, and
plugin sections; it also works with the keyboard. Click a run to continue, or open
All runs for search and selection; the arrow next to the Runs title leads back to Start.
On Start and Runs, the trash button ("Delete run ...") next to a run deletes it after a
confirmation that names the run. To delete several, choose "Select" on Runs. The toolbar on top of
the list card (search, "Hide ended", "Select") stays visible while the list scrolls; in selection
mode it shows "Select all", the selected count, "Delete", and "Cancel" in that order. "Select all" selects every visible run you may delete and becomes
"Select none", which clears those visible selections. You can also check runs individually.
"Delete" is disabled with no selection and asks for confirmation; "Cancel" clears the selection
and leaves selection mode. All actions work with the keyboard. Deleting runs requires permission;
errors remain visible. Locked runs show the cause and cannot be opened, but can be selected
for deletion. If background deletion fails, the run returns as locked with the deletion cause;
its delete action retries the cleanup. Other runs stay usable.
Each row shows the run's state with the number of open inputs and, below the
title, who created it and short details such as a workspace other than the empty folder per run.
Click anywhere on the row to open the run. A dot in the state icon marks activity you have not
viewed yet. The read state belongs to your user on the server: a run you viewed in the browser
also counts as read in VS Code and on your other devices, and other users learn nothing of it.
With sign-in, a run you shared shows a people icon ("Shared") next to its title, and a run
someone shared with you shows "Shared with you - view only" or "Shared with you - can operate";
such a run cannot be selected for deletion. "Share ..." at the end of a row opens the Share
dropdown for runs you may share, as described under [Share runs](#share-runs).

As long as no finished automatic title exists, the run list shows the original
task. After successful generation and storage, the short heading appears without
waiting for the next regular list refresh. When generation is disabled or has failed, the task
stays visible. Titles deliberately set in the run or setup take precedence;
a different model selection does not rename existing titles.

The global coordinator remains in the header with its own conversation, draft, and attachments.
In VS Code, Home and Runs stay within the selected environment; "Switch environment" in the
view title bar chooses another server or local profile.
Settings and Help are buttons at the top right, shown according to your permissions; next to
them, Sign out names your account in its tooltip, and VS Code adds Open in browser. A guided template uses
the preparation dialog and chat before starting.

## Run chat and inspection

Messages, the input composer, and pending actions share a centered column of at most 900 pixels
in main, actor, preparation, and global coordinator chats. Narrow panels use the available width
with side padding. The dock panel stays wide, and the message scrollbar stays at its edge.

The shared panel initially addresses the coordinator. Use the addressee selector at the bottom
of the input to choose another conversation from the graph of all actors. Visited chats keep separate drafts.
Sending requires write permission and a running actor. A stopped actor shows its reason and
Restart; TypeScript actors are operated through mini-apps or functions.

With technical read permission, Inspect actor opens details and installed program sources.
The right-hand inspection rail also provides Documents, Files, Functions, Executions, and other
plugin contributions when available. Clicking a rail button opens its panel; the same button,
Escape, X, or the backdrop closes it. Visited persistent panels keep their state.

A document an agent shows appears as a card in the chat and opens in Documents: text it wrote,
or a file, also an image, from the run's document store `@documents` or from the workspace, also
one on a workstation. A file is read when you open it, so it shows the current content; a workspace
file needs the permission to inspect the workspace. Images and links inside a Markdown or HTML
document resolve relative to the document's folder, so a report under `@documents/review/` shows
the screenshots stored next to it, in the browser and in VS Code. In the chat, an image or link
that an agent names relative to the working directory or with `@documents/...` opens the same
way; addresses with a scheme stay as written. Agents put reports and evidence under `@documents` and
deliverables into the project, and move files between the two with `copy`. Documents lists the
store by folder; Files shows it as a tree next to the working directory.

Click an image in Documents, a Markdown report, or the chat's attachments to open it across
the window. The preview shows a magnifier on hover. The viewer shows the file name; use the
wheel or trackpad pinch to zoom around the pointer and drag to pan when enlarged. + and -
zoom, 0 fits, and the Fit/100 % button or double click switches size. Escape, Close, or a click
outside the image closes the viewer and returns focus to the preview.

An agent's to-do list appears on its actor card with the
completed items checked and the item in progress in its running form, such as "Running tests".

Journal in the bottom status bar shows actual events, newest first, with search, expandable JSON,
and more results on demand. Executions shows recorded TypeScript calls and their results.
Its "Status" toolbar filter lets you select several state segments together, with the number of
executions beside each state; "Clear" or no selected state means all states. Search narrows
actor, code, or result.

Chat responses stream as Markdown in a comfortable reading size and line height: bold text is clearly
heavier, headings step down in size, inline code is a tinted chip, and code blocks, tables, and quotes
sit on their own surfaces. Copy preserves original text and line breaks. Attachments,
timestamps, and the detail-level selector use the same controls in both hosts. A button in the
input toolbar of every chat switches between all replies and only the latest reply between two
of your inputs (hiding the intermediate replies of a long turn; your inputs and the final answers
stay); the choice is kept per chat in the browser, ordinary chats start with all replies and the
global coordinator starts with the latest reply only. Questions appear
directly above the input and remain as receipts in history after answering. An agent can ask up
to four questions at once; they share one card, each with a short label, options with a
description, and a field for a free answer instead. Choose an option per question (several where
the question allows it) or write your own answer, then send all answers with Submit; a single
question with one choice is answered by clicking its option. An agent that asks
ends its turn; your answers reach it together as a new message, and a message you write to it instead
closes its open questions. A message sent during
a model turn steers that turn; Stop work pauses the whole run until you continue it. Stop run ends work
across the run. Read access shows questions and conversations without answer or send controls.

<!-- guide:clients -->
## MCP server status

When a run has configured MCP servers, "MCP servers" shows each server's transport, negotiated
protocol, state, error, and tool count. Connections open when an agent first resolves its tools.
Errors stay visible; a call to a disconnected server's known tool reports its cause and starts
reconnection. Tool-list changes appear for agents at their next model step.

Agents use these tools like other native tools, named `mcp__<server>__<tool>`. They also receive
server instructions and connection failures in their prompt. Configure servers in the profile
as described in [Connect MCP servers](homepage/guide-getting-started.html#connect-mcp-servers).
Stopping or deleting the run closes its MCP connections.
<!-- /guide:clients -->

## Attachments in the chat

The chat input clears text and attachments immediately on sending. Until the request ends,
further send actions and new attachments are blocked. You can start a new text as long as
the respective view allows input. On an error, the original input returns
automatically if you have not changed anything in the meantime. Otherwise your new text stays
unchanged; the failed task is available separately with a preview. With
"Insert unsent input" you append it together with its attachments to the current draft.

Images, videos, and files can be dragged into the chat input or selected through the attachment
button. You paste images and files from the clipboard with Cmd+V or Ctrl+V, including in
the VS Code panel and chats inside mini-apps.
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
input's switches. The thinking level sits compactly next to it as joined segments for up to
five choices, or a selection menu for more. It offers only the selected model's supported levels,
including extended levels such as `max`. `AGENT_MODEL_REASONING` is only needed to deliberately restrict these
model capabilities; invalid levels abort the configuration.

If the profile works with aliases (`MODEL_ALIASES` in the `host` section, `AGENT_PROVIDER: "alias"`
in the product plugin), the selection shows only the alias names, without provider and without the real
model name, and the journal stores the same names. The thinking levels are those of the model behind
the alias, unless the alias offers its own with `thinkingLevels`; then exactly this
selection appears in the control, and a chosen level goes out as the model level it points to.
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

The document store `@documents` stays isolated per run
(`sessions/<id>/plugins/ragents.documents/documents`, service `documentStoreToken` of
`ragents.documents`); `DOCUMENTS_DIR` places it with one subfolder per run under an
external path, but deliberately stays unset so that test runs never write into someone else's
storage. A workspace contribution that runs a run under its own account (`hostSandbox.ident`)
refuses such a run at its start, because the server hands files to that account only inside the run
storage. A system prompt of the same name in the plugin folder and in
`SYSTEM_PROMPTS_DIR` is a hard error.

## Skill templates in the start selection

The start selection shows the same compact cards as Start in VS Code: a title, two lines of
description, and an always-visible action icon at the top right. Hover or keyboard focus
emphasizes the icon; clicking anywhere on the card performs its action. Cards share the same
flat appearance, with no category row or bottom action bar. Categories remain freely chosen
template metadata. Every skill template contains a short, freely worded start task that describes the desired result
without platform knowledge; its `description` explains what the demo is meant to show. The
settings show the same prompt with a copy action. Format and rules of the templates are
in [plugins.md](spec/plugins.md) under "Skills and starting tasks" and "Reference cases from
ragents.reference", the templates and building blocks of the actor programs in
[actor-programs.md](spec/actor-programs.md).

The play icon starts the run immediately with the skill's task. The sliders icon ("Set up")
first opens the guide; after that it leads into the preparation chat in the next dialog step. There the
task can be discussed with a separate coordinator instance, and model, thinking level,
system prompts, and workspace are available for selection. After your explicit go-ahead in any wording, it starts
the run; no fixed sentence is needed. "Create run" starts directly. Both paths take over
conversation, skill, and attachments; the button also takes the last unsent addition. Back
discards the local preparation history and leads to the start selection. At startup, the
skill is taken over with the task; the edited task takes precedence over example text in the skill.
As the machine, the workspace in the browser offers only the server, in the VS Code run panel also
the connected workstations. An existing server folder is available only to administrators;
other users choose a new server folder per run or an offered folder of their own workstation.
Machine and folder choices use joined segments for up to five values and a selection menu
for longer lists.

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

<!-- guide:clients -->
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
remembers widths for that list at the same server address. Hover truncated cell text to read
the full value; columns that allow wrapping grow their rows instead. From a focused resize
handle, Left and Right change the
width (Shift makes larger steps), Home sets the minimum, and Enter or End fits the content.
If saved widths are damaged or saving fails, an error and "Reset column widths" remain
visible. If the browser blocks storage access, the list still shows its initial widths;
"Retry column widths" enables resizing after access returns.
<!-- /guide:clients -->

## Settings

The shared panel uses matte surfaces with rounded edges; page, bars, panels, cards, insets, and
floating panels are clearly separated steps.
Lavender marks the main actor, clay color other AI actors, mustard yellow
TypeScript actors, and blue-gray the mini-apps. The fronts stay straight and even.
Round buttons with an X close dialogs; a round arrow leads back to the previous view.
The hints on the button name the respective action.
Selected cards, rows, options, and tabs use a clearly tinted surface; hover stays subtler, and an
open dropdown shows only a light fill. An expanded group row is not painted as selected.
Maximize actions show selection through their icon and a subtle background, without a border
or ring. Keyboard focus shows a two-pixel ring. Status labels are colored text on a tinted fill: muted green
for completion, red for failure, amber for attention, blue for information, and violet for
ongoing work, in both light and dark appearance.
Buttons, selectors, toggles, tabs, and text inputs share one corner radius, and at the same size one
height, so they align in a toolbar. Dropdown panels, menus, and popovers float with a thin ring and a
shadow and stay fully reachable even in narrow input and dialog areas; the large panels that hang
from the header stay square.
Option groups are segmented controls with one rounded outline and thin dividers; the selected
segment is filled.

Under "Appearance" you choose a palette - Schichtwerk, Graphite, Midnight, or Black - and a color
scheme: Light, Dark, or System. The default is Schichtwerk in Dark; System follows the operating
system's color scheme setting, also on later changes.
Both choices immediately affect the interface, chat, and shared actor view controls, without reloading chats
or apps. They are stored in the browser for the same server address and synchronized with
other open tabs. Changing them requires settings write permissions. Every palette keeps body text
at 7:1 or more and secondary text at 4.5:1 or more against its surfaces, in light and dark.
Your own fixed actor view colors stay in place. Colors, fonts, radii, shadows, and
animations are maintained centrally for development in `apps/web/src/ui/theme.css`; the palettes are
generated from a few seed colors (`pnpm generate:palettes`).
Actor views use the same shadcn/ui controls as the host, with the colors from the tokens.
They follow the same palette and light/dark choice; there is no separate selection for them.

In the browser, "Zoom" under "Appearance" makes the whole interface smaller or larger: 80, 90,
100, 110, 120, 130, or 150 percent, with 100 as the default. Text, controls, spacing, menus, and
mini-apps scale together, immediately and without reloading. The choice is stored in this browser
for the same server address, synchronized with other open tabs, and needs no settings permission.
In VS Code the setting `ragents.zoom` takes its place (see "Settings and behavior of the VS Code
extension").

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

Under Runtime, profile cards show "Turn inactivity limit" or "No turn inactivity limit".
The limit measures time without progress; ongoing model output and tool activity restart it
([core.md](spec/core.md#scheduler-and-turns)).

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

Under "Titles" you independently choose the model for short automatic
list titles. With a large model list, the search helps. "Save" applies the selection,
"Discard changes" discards only the draft. "No automatic titles" followed by
saving disables new generations; existing titles are kept.
The selection applies from the next generation and does not change any agent models.

Offered are text models of the configured `COMPACTION_PROVIDER` that can work without
reasoning; default, storage, and error cases are in [profiles.md](spec/profiles.md) under
"Model for automatic titles".

"Appearance" contains the interface choice and the run panel settings. "Plugins" contains
"By plugin" and "By capability" as technical catalogs with search. Clicking the
owner opens the complete plugin page. "Runtime" shows technical facts,
models, profiles, and the system prompt. Models and Appearance work independently of
loading these catalogs. Plugin forms are additionally reachable at their plugin.

## Global coordinator

With `ragents.overseer` in `host.PLUGINS`, the "Global coordinator" button sits to the right
of the overview buttons and looks like an input field. A click, or Enter or Space while it has
focus, opens the conversation in the shared square header dropdown and dims the page below the
header; the header, with the button, stays bright. In the browser and VS Code, the panel
opens directly below this field, aligned with its left edge, with a small viewport inset. It is
up to 800 pixels wide and uses at least 80 percent of the viewport height when space permits;
short windows limit it to the available height. The chat fills the panel, with the same composer
as a run chat at the bottom. Its input gets the keyboard focus right away: Enter sends, Shift+Enter inserts a line,
and attachments can be selected, dragged in, or pasted. Its toolbar holds details, model choice,
reasoning, reset, send, and stop.
This dropdown is the only place of the conversation; Start has no second coordinator chat.
It belongs to the server shown by the browser or selected in VS Code and oversees that server's
runs. Selecting another environment shows its own coordinator when installed, with a separate
conversation.

`Reset conversation` sits next to model and reasoning in the global chat's dropdown and opens
a dialog over the entire global chat. Its background becomes blurred and cannot be
operated in the meantime; focus starts on Cancel. The confirmed action deletes
history, input draft, attachments, and model context, and first stops a running response. Normal runs,
their journals, and the model and reasoning choice are kept. After completion, the
next message starts a fresh conversation. On an error, a message stays visible;
a started reset can be repeated and is completed after a server restart.
There is no automatic reset.

You choose model and reasoning level in the input toolbar below the history. You find the same selection
in the settings under Models and at `ragents.overseer`. It is stored per profile
and applies from the next work step; a running response is not
switched. Other runs keep their models. An incompatible model, for example one without
support for images already sent, is rejected and the previous selection stays.

When sending, the global coordinator learns whether you are on the start view, in the run overview,
or in a run, which area you have opened, and which element you have selected.
For example, open the Files tab and ask the global coordinator "What is in this run?".
Run title, short run reference, and actor name are added on the server; you do not need to
copy them. Your visible question text stays unchanged.

This orientation captures the state at the time of sending. If you switch the run afterwards, the
question already sent still refers to its original selection, even if it is still
in the queue. Without a UI detail sent along, there is no current location.
Through this context, the coordinator receives neither screenshots nor form texts nor
complete run contents. The detail helps with assigning your question and grants no
additional task; a view change alone triggers no model request.

Escape first closes an open selection menu and then the history; focus returns to the
button. The close button, a click on the header button or on the dimmed area, or tabbing out of
the conversation closes it as well. This ends no work and discards no draft. Overview, Settings,
and Help close the history; on a run switch, conversation and input are kept. The overview corner
and `Cmd+I` or `Ctrl+I` open only the run overview.

Only the first opening connects the stream. While the global coordinator works, the frame of
the button pulses, as with working agents in their chat.
With reduced motion
the frame stays highlighted. A lost connection blocks sending, but keeps the draft.

Every signed-in user has their own global coordinator; without sign-in there is exactly
one. It oversees the runs its user sees, reads their journals, and can start new runs
with a task or an installed run script; it acts with the access and
permissions of its user, and new runs belong to that user. Created runs can be opened
through the run list. The stop button at its input appears while the global coordinator
has a turn and pauses its own run until your next message; it stops another
run on request through the management methods. Without write permission,
the button opens the readable history with the focus in it; the input shows "Read access to
the global coordinator", and sending is blocked.

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

## Open and stop services and background processes

The process rail shows the run's background processes and services with open ports, on
the machine where the run works: with a workstation its processes, otherwise those of the
server. With write permission, the small stop icon ends exactly the selected process instance.
In a narrow header, process labels shrink while ports, stop controls, and "All N" stay reachable.
Long port lists scroll within the strip.
During the request its button is blocked; errors stay visible at the entry. The next
process state removes ended entries. When stopping and before deleting a run, the
run's executor also cleans up marked processes without an open port, on the workstation as on the
server. An open browser window is not needed for this. If the workstation is currently not
connected or does not respond within ten seconds, the server remembers the stop and
carries it out as soon as the workstation registers again, before any new task of this
run; until then the server log lists it as pending. A server restart forgets it.

A click on the port of a service, such as a dev server an agent started, opens it on the machine
where the run works:

- In the browser, a run on the server shows its port as a link to the same host name as the page,
  so `http://<server>:5173/`. A run on a workstation shows only the port; its tooltip names the
  workstation and that the VS Code extension can forward it. Nothing is opened on the wrong machine.
- In VS Code, every port is a button that opens the service in your browser. If the run works on
  this window's workstation, or on the server the extension started itself, it opens
  `http://localhost:<port>/` directly. Otherwise the extension forwards it, as VS Code Remote does:
  it listens on `127.0.0.1` with the same port number if that is free on your machine and no local
  service answers on it, otherwise with a free one, and passes every connection through the server to
  the run's machine. A second
  click reuses the forwarding. It ends when the process or the run stops, when you disconnect the
  server, and when VS Code closes; the `RAgents` output channel lists each connection when it opens
  and closes. Forwarding needs the right `runs.inspect` besides reading the processes.

Forwarding carries the connection's bytes unchanged, so the live reload of a dev server, other
WebSockets, streamed responses, and large downloads and uploads work as on the run's machine. A
reverse proxy in front of the server must pass WebSocket upgrades for this; see
[operations.md](operations.md) under "Run a CLI workstation".

How the executor ends processes (SIGTERM, SIGKILL, time limits), which processes it can assign
to a run, and how forwarding checks a port and opens a stream are in [plugins.md](spec/plugins.md)
under "Workspace, sandbox tools, and processes".

In a protected server run, agents can use Bash and `curl` to reach public web domains on ports 80 and 443
by default. The host can restrict this or allow additional local services in its
[sandbox configuration](operations.md#server-process-sandbox). The run's file isolation remains active.

In a protected run, the browser check reaches public websites by default. Checking a local
or internal application needs an allowance from the server administrator, as described
in the same configuration section.

An agent starts a dev server or another service that must keep running with `bash` and
`run_in_background: true`, as in Claude Code. The call returns at once with an ID such as
`b3f9a1`; `task_output` reads what the service wrote since the last read and whether it still
runs, and `task_stop` ends it. When the service exits by itself or you end it in the process rail,
the agent that started it gets a short notice with the ID and the exit code. The service runs on
the machine of the run, on a workstation there, carries the run's marker, and ends with the run's
stop or deletion; it has no time limit. A service on a workstation keeps running when the server
restarts; once the workstation has signed in again, the notice arrives as well, also for an exit
while the server was down. If its run no longer exists on the server by then, for example because it
was deleted while the workstation was away, the server stops the service at that sign-in, removes its
output, and names it in the server log. The workspace rules tell agents to start services this way
instead of detaching them with `nohup`, `&`, `setsid`, a detached spawn, or a service manager such as
`launchctl`, and to stop them when they no longer need them. A process that detaches itself is found
again only through the inherited `RAGENTS_RUN_ID` marker. Which processes the process table cannot
assign per platform despite the marker, such as programs from `/bin` on macOS, is named in the same
section of the spec; with the server's process sandbox, a service of a run on the server cannot be
opened.

Agents check a running web application with `browser_check` after taking browser actions.
Combine `target`, `count`, and `text` to count visible matches containing a case-insensitive
substring; `count: 0` checks absence and warns when the unfiltered target has never matched
during checks or actions since navigation. Verify a warned selector with a positive check.
For a pure text check inside an iframe, supply `frame` with `text`; element targets use
`target.frame`. Set `measure: true` with one target and without `count` to read its bounding
box, client and scroll widths, and horizontal overflow in CSS pixels, for example on
`{ css: "html" }` or a clipped container. Page errors are reported as information. Add
`noErrors: true` when the check must also prove there have been no browser or network errors
since navigation. An ambiguous click lists candidates; select one with `target.nth` (0-based),
`first: true`, or a more specific text or role/name target.
Missing targets fail immediately with `0 matches for <target>`. Actions and resizing return
short snapshots (at most 2000 characters); use `browser_snapshot` for the full structure.
Check again after resizing because the previous evidence applies to the previous size.

<!-- guide:clients -->
## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows chat with an addressee selector, mini-app tabs, and the inspection bar on the right.
Without `run`, it shows the shared Start page.
`run-panel.html?layout=app&run=<id>&element=<app-id>` shows one mini-app without the tab bar.
The browser docking layout and addressee are stored per run in the browser. Starting or opening
a run focuses its visible chat input once it is ready, including a remembered chat partner.
Clicking or typing elsewhere while it loads cancels that focus request.

The run title opens "Run details". Its panel contains all run metadata, start option badges (an option
that a metadata cell already shows appears once), and contributed detail controls in cells that wrap as the
panel narrows. "Run details", "Run script", "Agents", and "Share" use the same square dropdown below the header,
as wide as the header with a small inset (sharing stays up to 800 pixels wide). Each dims the page below the header and keeps
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

At a workspace width of at least 1000 pixels, the browser places Chat on the left and mini-apps
on the right, each taking half the space. This also happens when the first app appears later.
Narrower workspaces use tabs in one area. The default adapts to width until you arrange windows
yourself; saved custom layouts stay as you left them. The active tab is one square filled shape
flush with the strip, without a border, holding its grip, maximize, and close buttons. The strip
clips to the card's rounded top corners. Drag a tab to arrange windows, or drag
the grip on the active tab to move all windows of its area together.
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

Move any entry's button between the header and right sidebar rail: drag a rail button onto a
header insertion line, or drag a header button onto the rail. An empty rail appears as a drop
target during a button drag. Right-click either button for "Move to header" or "Move to sidebar";
from the keyboard, focus it, press Shift+F10, then choose the action with arrow keys and Enter.
The menu moves a button to the end of the header. Moving a button leaves its panel open, closed,
or in its current dock area. A rail button for an already docked window selects that window;
it does not open a second copy.

After the window buttons, "Empty space" is always directly available.
Clicking it adds an empty pane beside the current area in a wide workspace, or as a tab when
narrow; dragging the button places the pane on a docking guide. You can add several. An empty
pane is a window like any other: move it, split beside it, merge it as a tab, maximize it, or
close it with X, which removes it. It shows "Drag an app or actor here". Dropping a header
button or a tab anywhere on a shown empty pane, or on the compass center labeled "Replace empty
pane", puts that window in its place. Empty panes survive reload.

The "Reset layout" icon after the window buttons and "Empty space"
restores the automatic layout, default button positions and order, and the inspection rail,
and removes empty panes. Maximize appears only with multiple areas, in the active tab just
before its X; Restore or Escape returns to the split layout. Tabs support arrow
keys, Home, and End, and focused dividers support arrow keys.

Inspection puts its actor selector in the window title row. A second, horizontally scrollable
row holds the actor name, Stop or Restart, chat display switches, and detail-view icons with
tooltips. The conversation has no separate bottom toolbar.

The inspection rail on the right contains files, documents, functions, executions, and
language-server diagnostics according to the run and your permissions. A small blue dot at the
top right of a rail button means the view has content or new activity. Hover or focus a button
to see its tooltip immediately to the left, above the flyout and workspace panels. Hover a button to
preview its view in a flyout; move away from both flyout and rail to hide it.
Click a rail button to open or focus its flyout. X hides it. The flyout is 630 pixels wide,
limited by the available space. Its keyboard-accessible "Move into layout" button places the
view in a regular window at the workspace's right edge, just like dragging it onto the right
outer guide; the new area takes 35 percent of the workspace width.
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
taking focus; unavailable apps disappear. Chat drafts, app input, and visited tool state survive tab switches,
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

"Agents" in the run header opens the same graph with the title "Agents" in the shared header
dropdown as soon as the run has an actor besides you; the graph pans within the panel. Clicking an
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
[Deploy from a local build](operations.md#deploy-from-a-local-build). For workstation registration,
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
toolbar row. With an open run, the first header row holds the global controls (logo, global
coordinator, Settings, Help) and the second the run's own (title, Agents, Share, Run script, and in
the browser the window buttons); the coordinator stretches up to the controls at its right, so
no row keeps empty gaps. A VS Code panel at least 1100 pixels wide shares one row. Narrower
panels wrap whole controls onto further rows in either host. VS Code keeps its app editor tabs
as a row of buttons below the header.

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

**Runs** shows this server's complete list in the same card, with search, "Hide ended", and a
selection mode that deletes several runs after a dialog confirmation. Checkboxes occupy an
additional first column; row actions disappear during selection. A run the
server has locked, for example because its journal uses an older format, shows a warning icon whose
tooltip names the cause; it does not open, but the selection mode deletes it.

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
run is created. The "Share run" dropdown opens below the header or the row's share action and
uses the same panel and content in both places. It names the run and shows a list: "Everyone"
first, then every other user of the profile, each row with the segmented choice "Off", "View", or
"Operate". Names and controls line up in two columns; a long name truncates with a tooltip in a
narrow panel, while its control stays on the same line. View's tooltip says "Sees the run";
Operate's says "Also works in it, within the user's own permissions". A user gets the higher of
"Everyone" and their own row. Every choice saves the whole sharing immediately and keeps the
dropdown open with the saved state. Access controls are briefly disabled while saving. If the
server refuses, the reason appears inline and the choices return to the server's saved state.
There is no Save or Cancel. Escape or clicking outside closes the dropdown. The panel is the
same in the browser and in VS Code; the labeled header button wraps with the other actions when
space is short.

"View" shows the run, its chat, apps, and journal as far as your own permissions go, but
operates nothing: the run header shows "View only", the chat input is disabled with "Shared with
you for viewing only", and "Stop run", "Run script", answers to questions, and app actions are
missing. "Operate" works in the run within your own permissions, and the header shows "Shared".
In someone else's run that only its owner operates, the chat input says "Only its owner operates
this run"; "Stop run" and the stop button in the chat input stay. A run shared with you is never deleted by you. If a share is taken
back while you have the run open, the panel returns to Start and shows "This run is no longer
available to you."
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
After [configuring adapters](homepage/guide-getting-started.html#configure-external-acp-agents),
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
<!-- /guide:clients -->
