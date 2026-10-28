# Usage

What a user sees and does in the web interface, in the run panel, in the VS Code extension, and
from the command line. Installation, startup, access, package, distributed work, and data storage
are in `docs/operations.md`, build, checks, and publishing in `docs/development.md`. How agents use
TypeScript functions, snippets, actor programs, and run scripts is in
`docs/spec/typescript-platform.md` and `docs/spec/actor-programs.md`; the structure of the system
in `docs/spec/`, the why in `docs/decisions.md`.

<!-- guide:getting-started -->
## Create your first run

Runs is the standard home in both the browser and VS Code. It combines one server's permitted
templates under "New run" with its complete run list, search, selection, deletion, and "Shared by me".
The Runs entry stays first in the header; plugin views follow it. The logo opens the home, which
is Runs unless a plugin supplies a visible home view. Templates begin with
"New chat" or the server's default template, then skill templates with a prepared task and script
templates with programmed setups. "New chat" opens an empty run whose task you write in its chat;
a template starts with one click. Some templates collect values in a setup dialog first ("Set up"); a skill template then
continues in the preparation chat. There you can discuss the task, give a clear go-ahead such as
"Start", or choose "Create run". Merely confirming a detail does not start
anything. In the browser a new run always works on the server; only VS Code and `ragents run`
bind a run to a workstation. VS Code binds every new run to an open folder of its window unless
the template sets its own workspace.

Plugins can reserve templates for their own views. These unlisted templates do not appear in
"New run", template search or galleries, Settings' template catalog, or run-script pickers.
A plugin view or a caller that knows the template ID can still start it with the usual permissions.

Before starting, "After restart" defaults to "Continue": actors that were working when the
server stopped receive a continuation on its next start. Choose "Stay interrupted" to turn
this off for the run. A profile can disable continuation for all its runs.

Every run starts with "Isolated" in the composer, including an administrator's run. The shield
control lets the owner choose "Full access" before or during the run. On the server this needs
administrator access and a server that permits it; on a workstation the run's owner can choose it
with any server permissions, and that machine confirms locally. An unavailable choice shows its
reason. A shared user cannot change the level; a run with full access can only be operated by its
owner. Run details explain what the selected level means on its machine and list approved paths
under "Grants".

"Isolated" applies one read and write rule to file tools and commands on the run's machine.
It permits reading outside blocked homes, temporary folders, and application data, plus the run's
allowed folders and approved paths. Writing stays within the run's writable folders and write grants.
Server commands use the server process sandbox and network policy. On macOS and Linux workstations,
commands use the workstation OS sandbox, their own home and temporary folder, and an environment
without secrets; network access includes loopback and the local network. On Windows the file tools
apply the same rule and the environment filter remains, but commands have no OS sandbox. The composer
and run details say "Commands are not isolated on this machine". Inspect process and device
resources through a command; isolated file tools refuse the host's process resources.
"Full access" permits every path available to that machine's account and unrestricted commands;
a workstation also passes its inherited environment. The server keeps its safe environment
allowlist in both levels. Returning to "Isolated" stops the run's background commands, managed
services, and language servers; language servers start again when needed. The agent receives the
new level before its next model call. Embedded and multi-user servers require server process
protection for everyone ([operations.md](operations.md#server-process-sandbox)).

For a path outside the current read or write allowance, the agent can use `request_access` with the path, "read" or
"write", and its reason. The "Access request" card shows the resolved path and "Read only" or
"Read and write". "Allow" permits that path; for an existing file, "Allow folder" permits its
containing folder; "Deny" refuses it. Only the run's owner can answer. On the server the owner
also needs permission to choose full access. A folder grant includes its contents; allowing one
file does not allow its neighbours. Write access also permits reading and can target a file that
does not exist yet; read access requires an existing path. Roots, homes, secret locations, the
RAgents data folder, and other runs' files require full access instead of a narrow grant.
For a new directory and its contents, request its existing containing folder. On Linux a
sandboxed command's missing write target is prepared as an empty file before the command starts.

The decision reaches the agent as a new message, and grants survive a server restart. A new
message from you closes that actor's open requests; stopping the run withdraws open requests.
Already reachable paths need no approval. Grants affect file tools and sandboxed commands on the
binding's machine. Windows commands retain the limits described above. A refusal
does not authorize the agent to find another way around it.

A click shows its effect at once: either the run's progress appears, or the chosen entry shows
a spinner and "Starting ..." at the top right while the other entries stay locked until the
run opens or the start fails; a run script in the run header's "Run script" list does the same. While a template starts,
the panel shows its progress in the chat area and reserves the bottom status bar, keeping the
notice in place when the run connects.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear on
the surface when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Continue after a server restart

An agent that was working when the server stopped continues in a new turn. Its chat shows
"Server restarted. Continuing the interrupted task." It checks unfinished work before continuing,
including missing tool results, partially written files, and processes that ended. Completed
work stays recorded. Queued messages retain their order and reach the continuation through
normal steering.

Your "Stop work", "Stop run", or individual turn interruption does not trigger this recovery.
Failures and turn timeouts do not either. A continuation interrupted again within 60 seconds
of starting stays interrupted, with the reason shown in chat. External runtime actors also stay
interrupted; TypeScript actors re-evaluate their original input from saved state.

For a run on a workstation, continuation waits for the same workstation to reconnect and for
its folder to be accessible. After the existing 15-minute timeout, a failed turn shows the
cause. Reconnect the workstation before sending a new message if the wait has expired.

See [Restart the server](operations.md#restart-the-server) for the profile setting.

## Use chat and mini-apps

Activated visible mini-apps become available automatically, including those from an embedded setup.
Programs cannot arrange the host interface. Runs saved with removed layout functions or placements
are locked with an explanation; their original files are kept. Start a new run with updated programs.

Wide browser runs start with Chat beside the other windows; narrow ones use one tab group. Drag tabs
onto the docking guides to arrange areas or merge them. Chat and visited apps keep their input
through switches and moves. New apps appear without taking focus. A window that is unavailable
for a while keeps its place and returns to it; the app of a later start of the same run script
takes over the area of the earlier one. Close windows with X. Each window keeps a button in the
header or sidebar rail; a pressed button is visible, and clicking another one shows that window. Drag a header button by its grip to
reorder the buttons, or onto the docking guides to place that window. "Empty space" in the
header adds an empty pane that holds a place until you drop a window onto it. "Show app..." beside
it shows a mini-app that lives elsewhere, one of your global apps or an app of another of your runs,
as a read-only window of this run: it always shows the app's current state, runs nothing, and
"Remove" in the window takes it away again. You can also ask the agent to show a global app by its
name. Every button stays directly available; a tight header first shows only icons for labelled
buttons and wraps onto further rows only when even that is not enough, pushing the workspace down.
Drag a button between the sidebar rail and header to choose where it lives, or right-click it
and choose "Move to header" or "Move to sidebar". Shift+F10 opens the same menu from the keyboard.
Moving a button keeps its panel's open state; "Reset layout" restores the plugin defaults.
Plugins can keep optional windows closed at first and after reset; their header buttons still
open them. Every visible window updates live, including while another window has focus.
"Agents" shows or focuses the live actor graph in its own window. Pick an actor to address its
chat, or drag it onto the docking guides to open a separate chat for that actor.

When step details are enabled, click a thinking or tool step to open its popup. Long traces
scroll inside it; the heading and close button stay visible within the available screen space.

A mini-app can also start on its own: ask the agent for a timer, a daily or weekday time, or a
reaction to file changes in a server folder, and it declares these triggers and the folders or
hosts the app may use in its package. Triggers keep working while the run is closed. A mini-app can
also wait, for a time, your answer in its view, or a changed file, and continue where it stopped,
also after a server restart.

In VS Code, clicking an app opens or focuses its editor tab. VS Code controls where that tab
appears. Questions and news stay in chat. The selector below the input chooses the addressee;
the run coordinator is selected by default. "Agents" in the inspection rail shows the same graph
in the run's tool popout.

<!-- /guide:getting-started -->

## Switch runs

Click Runs beside the logo to see the permitted templates and complete run list. The logo
("Home") opens the home view. A plugin may make its own view the home; Runs always remains reachable
as the first header entry. If several visible plugin views claim the home, the one with the lowest
order wins, then its ID in case-sensitive lexical string order, independent of browser locale.
Without a visible claim, the home is Runs.
Click a run to continue. Returning to Runs restores its state and scroll position.
Runs also has "Shared by me": the runs you shared, their recipients, and each recipient's
View or Operate access. Search there by run title or recipient. Revoke a single share with
"Revoke", or remove all sharing for a run with "Revoke all" (see [Share runs](#share-runs)).
On Runs, the trash button ("Delete run ...") next to a run deletes it after a
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
them, Sign out names your account for assistive technology, and VS Code adds Open in browser. A guided template opens
only its guide as a dialog over Runs; closing it leaves Runs as it was.

## Run chat and inspection

Messages, the input composer, and pending actions share a centered column of at most 900 pixels
in main, actor, preparation, and global coordinator chats. Narrow panels use the available width
with side padding. Chat and Topic use the same reading text scale. The dock panel stays wide,
and every overflowing chat history has a thin, subtle scrollbar at its edge. Scrolling up with
the wheel, keyboard, or scrollbar pauses following new messages; reaching the bottom or clicking
the jump-to-end button resumes it.

The shared panel initially addresses the coordinator. Use the addressee selector at the bottom
of the input to choose another conversation from the graph of all actors. Visited chats keep separate drafts.
Sending requires write permission and a running actor. A stopped actor shows its reason and
Restart; TypeScript actors are operated through mini-apps or functions.

"Agents" in the browser run header opens, reveals, or focuses its single graph window. Move,
dock, resize, or close it like an app; the run remembers its layout. Picking an actor addresses
the main chat, and dragging an actor onto a docking guide opens its own chat. States update live.
In VS Code, "Agents" is a tool in the inspection rail and opens the existing tool popout.
The small graph opened from the chat input's addressee selector or working-agent count stays there.

With technical read permission, the Inspection rail tab shows details and installed program sources.
The right-hand inspection rail also provides Documents, Files, Functions, Executions, and other
plugin contributions when available. Clicking a rail button opens its panel; the same button,
Escape, X, or the backdrop closes it. Visited persistent panels keep their state.

If a panel fails, it shows the cause with Retry and Reload; other panels remain usable.
A failed required plugin provider identifies the plugin and blocks the part that depends on it.
Mini-app listing errors offer Retry and also retry briefly or when the connection returns.

A document an agent shows appears as a card in the chat and opens in Documents: text it wrote,
or a file, also an image, from the run's document store `@documents` or from the workspace, also
one on a workstation. Documents renders Markdown and HTML, previews images, shows text as
source, and offers downloads for other files. Open file documents follow file changes, including
Markdown, text, HTML, images, and downloads; a workspace file needs the permission to inspect the workspace. The
"Reload document" button in the panel and expanded document reads it again and spins while
loading. Current content stays visible until its replacement is ready, keeping the scroll
position where possible. Unchanged HTML and images stay in place. Text shown directly by an
agent stays as it was shown. Images and links inside a Markdown or HTML
document resolve relative to the document's folder, so a report under `@documents/review/` shows
the screenshots stored next to it, in the browser and in VS Code. In the chat, an image or link
that an agent names relative to the working directory or with `@documents/...` opens the same
way; addresses with a scheme stay as written. Agents put reports and evidence under `@documents` and
deliverables into the project, and move files between the two with `copy`. Documents lists the
store by folder; Files shows it as a tree next to the working directory.

The Files preview follows changes to the selected file and keeps its content visible while
reloading, even when reads finish out of order. Markdown files open in "Rendered" view; switch
to "Source" in the preview header to read their source. The choice stays with this Files panel
when you select another file or root. Other formats, including HTML, show their source. Relative
links and image addresses in this Markdown preview stay as written.
"Refresh files" reloads both the tree and the selected preview. A failed preview shows its cause
and retains loaded content; Refresh retries it, and hiding the panel retains a loaded preview.

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
sit on their own surfaces. Chat and its input use 13-pixel text at line height 1.5; documents keep their
own reading scale.
The background of a user message spans its row while its text keeps its alignment and width limit.
Visible timestamps sit beside the first text line. Opening a chat loads its history in one update;
reconnecting keeps the visible history until loading finishes.
Scrolling up keeps your reading position while new messages arrive; the jump-to-end button resumes
following. Copy preserves original text and line breaks. Attachments,
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
a model turn steers that turn; Stop work interrupts only the turn of the chat's actor. Stop run
ends running turns and external work across the run, keeps its actors available, and waits for
your next message. Read access shows questions and conversations without answer or send controls.

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
their notes name `@attachments/<name>`. The files stay in the run's storage on the server,
outside the project's folder, including when the project is on a workstation. The root is
read-only for file tools; the agent can also inspect it with `bash` and `cwd: "@attachments"`,
which runs on the server. Earlier `attachments/<name>` references keep addressing the original
files in the project's folder. On errors,
the message and files stay in the composer. You can download sent attachments again from the history.

<!-- guide:clients -->
## Context usage

The ring in the run coordinator, agent, and global coordinator chat fills as the active model
context grows. Click it to see used tokens, the context window, and the token count above which
automatic compaction starts. It also shows the remaining tokens to that threshold. Estimates are
marked; after compaction the ring measures the summary and retained context. Near the threshold,
the ring uses the warning color. Limits belong to the selected model and apply from the next turn.
The control also works with read access; script and external runtimes have no built-in context ring.

<!-- /guide:clients -->

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

<!-- guide:clients -->
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
<!-- /guide:clients -->

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
"Show prompt text" opens the catalog's complete prompt texts below the selection;
"Hide prompt text" closes them. Reading these texts does not change the chosen prompts.

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

## Skill templates in Runs

Runs shows the same compact cards in the browser and in VS Code: a title, two lines of
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
first opens only the guide as a dialog over Runs; its answer moves the same dialog on to the
preparation chat ("Prepare task"). There the
task can be discussed with a separate coordinator instance, and model, thinking level,
system prompts, and workspace are available for selection. After your explicit go-ahead in any wording, it starts
the run; no fixed sentence is needed. "Create run" starts directly. Both paths take over
conversation, skill, and attachments; the button also takes the last unsent addition. The X and
Escape close the dialog completely in either step, as does the guide's Cancel; this discards the
local preparation history and leaves Runs as it was. At startup, the
skill is taken over with the task; the edited task takes precedence over example text in the skill.
As the machine, the workspace in the browser offers only the server, in the VS Code run panel also
the connected workstations. An existing server folder is available only to administrators;
other users choose a new server folder per run or an offered folder of their own workstation.
Machine and folder choices use joined segments for up to five values and a selection menu
for longer lists.

## Start run scripts

The homepage samples are available in Runs as run scripts: collection board,
balcony wizard, study afternoon, and word game. In the built-in help, "Start sample" selects
the matching template directly. A template's guide still comes first. A run script without a guide
that declares parameters shows a form with one field per parameter instead, required ones marked;
one without parameters starts right away. After the guide's answer or the form's submit the dialog
shows "Starting run" until the run opens; if the server refuses the start, for example because a
parameter is invalid, the guide or form stays open with its entries and names the reason.
Word game and study afternoon first set up their participants and mini-app without a model call;
the work begins with the start button in the app. Their homepage previews use
the same interfaces with labeled example data and do not call any models.

How a run script is structured, how it declares its parameters, and how `fixed-start-options` fixes a
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

A row of tabs that does not fit its width never cuts a tab off or wraps it into a second row.
The active tab and the tabs before it stay; the rest move into "More tabs" (...) at the end of the
row. Its menu lists exactly the hidden tabs; choosing one shows it and puts its tab at the end of the
row. Use the arrow keys between the visible tabs, Tab to reach "More tabs", and Enter, the arrow keys,
and Escape in its menu. The two Runs tabs, the Settings areas, and
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
system's color scheme setting, also on later changes. "Shape and spacing" adds three looks: the
corners of controls and panels (Round or Tight), how code inside a sentence is drawn (Tint or
Outlined), and "Table spacing", the padding of rows in tables and data grids, including mini-apps
(Compact, Comfortable, or Spacious; default Comfortable).
The same choices are one click away in the header: the palette button before "Settings" opens a small
panel with all of them, so you can try a look while a run stays in view.
All choices immediately affect the interface, chat, and shared actor view controls, without reloading chats
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
from the next work step. The first valid global selection is stored independently and
stays separate from the product defaults even after a restart. An unavailable inherited default
stays in memory and is taken from the role again at the next start. "New runs and agents" offers model and thinking level for every role of the
product; in core these are coordinator, relay, and standard. Save the
complete draft. New actors and defaults of runs not yet started use it
immediately; existing actors and an explicitly made start selection are kept.

A stored model or thinking level removed from the profile stays visible with a notice per affected
role. Choose an offered model and reasoning level for every affected role, then save the complete
draft. Until then, starting with such a default or spawning an agent with it fails and points here.
An explicit offered model and level in a new run or spawn still work. Runs and start options stay
available; a new run's picker also shows the unavailable coordinator default with a notice.
Invalid drafts are rejected before saving. The available model list is still maintained in the
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
can be edited separately. The offered models and thinking levels come from the active profile's
model definitions. The included profiles offer `low`, `high`, and `max` for GLM 5.3 and GLM 5.3 Flash.
Saved model settings take precedence over the profile file. Changes
in the interface apply to newly created actors without a restart; config and run prompt changes
require a restart and, for the new coordinator prompt, a new implementation run.

Under "Titles" you independently choose the model for short automatic
list titles. With a large model list, the search helps. "Save" applies the selection,
"Discard changes" discards only the draft. "No automatic titles" followed by
saving disables new generations; existing titles are kept. If the stored title model is no longer
configured, it remains visible with a notice. Choose another model or "No automatic titles", then
save. Until then, title generation reports a warning for the run and leaves its title as it is;
the server and other work remain available.
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
of the overview buttons and looks like an input field; in a tight header only its icon remains,
still framed. A click, or Enter or Space while it has
focus, opens the conversation in the shared square header dropdown and dims the page below the
header; the header, with the button, stays bright. In the browser and VS Code, the panel
opens directly below this field, aligned with its left edge, with a small viewport inset. It is
up to 800 pixels wide and uses at least 80 percent of the viewport height when space permits;
short windows limit it to the available height. The chat fills the panel, with the same composer
as a run chat at the bottom. Its input gets the keyboard focus right away: Enter sends, Shift+Enter inserts a line,
and attachments can be selected, dragged in, or pasted. Its toolbar holds details, model choice,
reasoning, reset, send, and stop.
This dropdown is the only place of the conversation; the home has no second coordinator chat.
It belongs to the server shown by the browser or selected in VS Code and oversees that server's
runs. Selecting another environment shows its own coordinator when installed, with a separate
conversation.

`Reset conversation` sits next to model and reasoning in the global chat's dropdown and opens
a dialog over the entire global chat. Its background becomes blurred and cannot be
operated in the meantime; focus starts on Cancel. The confirmed action clears the coordinator's
visible history, input draft, attachments, and model context, and first stops its running response.
Its global run and journal remain. App rooms, state, logs, and schedules, normal runs, and
the model and reasoning choice are kept. After completion, the
next message starts a fresh conversation. On an error, a message stays visible;
a started reset can be repeated and is completed after a server restart.
There is no automatic reset.

You choose model and reasoning level in the input toolbar below the history. You find the same selection
in the settings under Models and at `ragents.overseer`. It is stored per profile
and applies from the next work step; a running response is not
switched. Other runs keep their models. An incompatible model, for example one without
support for images already sent, is rejected and the previous selection stays.
If the profile no longer offers the stored model, the selection shows a notice, and the global
coordinator answers every message with an error until you choose another model.

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
has a turn and interrupts only that turn; it stops another
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

<!-- guide:global-apps -->
## Global mini-apps in Apps

Ask the global coordinator to build a mini-app for your Apps view. The agent writes a
small TypeScript backend with persistent state, an optional React view, the triggers that start
it, and the permissions it needs, and verifies it with a manual run. A global app is an ordinary
mini-app that lives in your global space: its triggers and permissions work exactly as in a run,
and it keeps running on the server without an open chat or a connected workstation. Normal run
agents can publish a package of their run the same way with `ragents.global-apps`, included in
`core`, `showcase`, and `developer`. Only explicitly declared functions such as coordinator
notifications can start further model work.

Small views use compact layout spacing. Ask for an item title and status on one row and related
facts on one muted metadata line; the app card already supplies its title. Plain headings and
paragraphs also receive readable sizes and spacing from the frame.

Apps live in separate rooms beside the coordinator's `main` room in your hidden global run.
"Reset conversation" starts a fresh coordinator conversation and keeps the apps and their
state, logs, and triggers.

Open Apps in the header to see your global mini-apps. The page is available when your profile
includes `ragents.global-apps` and you may read it; its address is `page=ragents.global-apps`.
It does not change the home. An empty page shows "No global apps yet.".
Each app has its own card, and "Show app..." in any of your runs shows it there as a read-only
window. A view displays the app's state and calls its functions; a headless app shows last run
and next run. Every card shows its last output or result, including apps with views. Multiple
views stay selectable within the same app. "Run now" starts a manual trigger even while triggers
are paused. "Pause" stops new automatic inputs; "Resume" enables the triggers again. Accepted work
can finish, and an app never overlaps itself. Leaving Apps keeps its programs and triggers running.

"Open details" shows the app's triggers, permissions, process protection, persistent state, and
recent log and offers "Remove". Permissions name server folders for reading or writing and HTTP
hosts; an app without them gets no external access. Apps belong to the creating user; another
user's apps do not appear on this page. Read-only access omits the app-management controls.
A damaged app or one whose program is no longer active stays visible as its own card with
"Retry" and "Remove"; other apps remain usable.

An app may be manual only or combine intervals, daily times, selected weekdays, and server file
changes, as described for every mini-app under [Triggers](homepage/guide-programs.html#triggers). Restart
runs one overdue occurrence and continues with future times. Failures delay the next automatic run,
and "Resume" clears that delay. Successful inputs commit domain state, while completed external
file writes or HTTP calls cannot be rolled back by a later failure.

An app that waits, such as a daily draft that waits for your approval, is a
[state-aware program](homepage/guide-programs.html#state-aware-programs). Its card shows the next
wake as next run, and its view offers the answer while the program waits for it, for example
"Approve" and "Reject"; an answer while nothing waits is refused. Every completed step runs only
once, also across restarts. If a changed app no longer fits what it recorded, its card shows it
blocked with the position and cause; the agent restores the code or creates the app under a new
name.

## Let an agent write and verify an app

The global coordinator has package, file/edit, TypeScript, `global_app_*`, and the trigger tools
`actor_program_trigger`, `actor_program_pause`, and `actor_program_status` in its own run, and reads
the authoring guide with `actor_program_controls`. `run_list` gives it, and every app that declares
it, your runs as the run list shows them, with title, status, and last activity, so "a mini-app
that always shows my latest run" is an app with an interval trigger that refreshes the summary by
last activity, also while the chat is idle. It calls
`actor_program_create`, writes the package sources through the normal file tools, and calls
`global_app_create`, which copies the package into the app's room, checks types, builds the
backend and any views, runs package tests, and activates it with its triggers. Errors name the
locations to fix; the same name replaces the package and keeps the app's state.

For a daily date recorder, the agent creates `daily-date` with the `headless` template, adds
`"triggers": { "daily": { "at": "08:00" } }` to the `ragents` section of its `package.json`, and
writes this complete `src/server.ts` in the returned `directory`, including any room prefix:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ date: Type.Optional(Type.String()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: async (input, context) => {
    const trigger = input.trigger;
    if (!trigger) return;
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: trigger.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(trigger.scheduledAt));
    context.log(`Date ${date} (${trigger.reason})`);
    context.state.replace({ date });
  },
});
```

The agent writes `tests/program.test.ts` with an explicit trigger input:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

test("records the occurrence's date in its time zone", async () => {
  const context = createTestContext<{ readonly date?: string }>({ state: { date: "2026-10-09" } });
  await program.onInput!({
    id: "date",
    content: "Trigger: daily.",
    artifactIds: [],
    sourceEventIds: [],
    subscriptionId: null,
    event: null,
    trigger: { reason: "daily", key: "daily:1", scheduledAt: "2026-10-09T22:30:00.000Z", timeZone: "Europe/Berlin" },
  }, context);
  assert.deepEqual(context.state.read(), { date: "2026-10-10" });
});
```

It creates the app and verifies it with a manual trigger:

```ts
const { program } = await context.functions.global_app_create({ name: "daily-date", program: "daily-date" });
await context.functions.actor_program_trigger({ name: program });
```

`actor_program_trigger` returns when the input is queued. A later
`actor_program_status({ name: "daily-date.daily-date" })` shows its outcome, stored date, and date
log line. If it failed, the agent fixes the sources, creates the app again with the same name, and
repeats the verification. The daily trigger is active from creation on; `actor_program_pause`
pauses and resumes it, and `global_app_list` and `global_app_remove` find and remove apps by name.

An app that needs files or HTTP names the folders and exact hosts under `ragents.permissions` and
declares `program_file_read`, `program_file_write`, or `program_http_request` in its capabilities.
Creation rejects access the user or agent cannot grant, and an app cannot declare file, shell,
TypeScript evaluation, or package tools. A host without a port permits only default HTTP/HTTPS
ports; an explicit port permits only that effective request port, including 80 and 443. These
permissions are checked on the server; when process protection is explicitly disabled, direct
Node file and network access remains unrestricted.

To notify the global coordinator, the agent declares `overseer_notify` in the backend's input
capabilities. This function delivers a short message to the current coordinator through ordinary
actor input and may cause a model response. It requires the user's `ragents.overseer.write` and
the agent's usable, delegable `actor.input`; an app without that grant cannot be created with it.

<!-- /guide:global-apps -->

## Open and stop services and background processes

Run details lists the run's background processes and services with open ports, on
the machine where the run works: with a workstation its processes, otherwise those of the
server. With write permission, the small stop icon ends exactly the selected process instance.
Every process name appears in full. Names, commands, and port controls wrap in narrow panels.
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
  so `http://<server>:5173/`. A run on a workstation shows the port and explains below it which
  workstation runs the service and that the VS Code extension can forward it.
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
`first: true`, or a more specific text or role/name target. `browser_click` with
`clickCount: 2` double-clicks and with 3 triple-clicks, the most it accepts.
Missing targets fail immediately with `0 matches for <target>`. Actions and resizing return
short snapshots (at most 2000 characters); use `browser_snapshot` for the full structure.
Check again after resizing because the previous evidence applies to the previous size.

<!-- guide:clients -->
## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows chat with an addressee selector, mini-app tabs, and the inspection bar on the right.
Without `run` or `page`, it opens the home. `run-panel.html?page=runs` opens the fixed Runs view;
`run-panel.html?page=<id>` opens a page that a plugin adds.
`run-panel.html?layout=app&run=<id>&element=<app-id>` shows one mini-app without the tab bar.
The browser docking layout and addressee are stored per run in the browser. Starting or opening
a run focuses its visible chat input once it is ready, including a remembered chat partner.
Clicking or typing elsewhere while it loads cancels that focus request.

The run title opens "Run details". Its panel reads as one column of labelled rows: label on the
left, full value on the right, with a short explanation below it. A contributed branch can appear
first, ahead of workspace and other facts. It includes all run metadata and start option badges
(an option already shown as metadata appears once), the full run title, and any connection
error or sharing access. Branches, paths, process names, and errors wrap as the panel narrows.
The workspace says where files and commands run; access explains the file, command, and
environment limits on that machine; "Grants" lists every approved path with "Read only" or
"Read and write"; system prompts name their instructions and who receives them.
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
The scripts appear as the same compact cards as in Runs with title, two lines of
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
the list stays open and shows why. The same button works in the VS Code run panel; in a tight
header it shows only its icon, like the other labelled header buttons.

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
needed.

The header keeps everything in one row as long as it can. When space gets short, the run title
shortens first, down to a few words. Then labels give way one at a time, only as many as needed,
each leaving its icon: first the titles of Runs and the plugin views, then the other labelled
buttons from left to right, such as the global coordinator, "Empty space", "Show app...",
"Share", "Run script", and the environment name, and last the status texts beside the run title,
such as "@coordinator asks". Point at a button that shows only its icon, or move the keyboard
focus to it, to see its label. Window buttons keep their titles. Labels give way only when that
brings the windows into the row; when they do not fit even then, they continue in further rows
and the other buttons keep the labels they have room for. Only when the buttons alone do not fit
as icons does the header wrap them as well. The header grows and pushes the workspace down; its controls are never clipped,
covered, hidden in a window menu, or placed in a horizontal scroll area. The title and long window
labels truncate; Run details shows the full run title, and each window shows its own title.
Controls retain complete accessible names.
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
same time, while one selected **environment** supplies the visible home, Runs, templates,
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
[Deploy from a local build](operations.md#deploy-from-a-local-build). For workstation registration,
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
The status bar shows the number of connected servers and opens the home when clicked. See
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

The extension shows the selected server's home, Runs, plugin views, and run panel, plus its own
"Server" configuration page. All appear in the RAgents panel of VS Code's secondary sidebar.
Navigation and commands live in the view title bar: Home, Runs, "Switch environment"
(server-environment icon), Server (gear), "New run", and "Refresh". They remain available while
showing a run. Home and the logo open the resolved home; Runs always opens the fixed run view.
Server keeps a back action to the home. There is no Explorer tree in the activity bar. The view
badge counts pending inputs in the selected environment, and Refresh refreshes that environment.

"Switch environment" opens VS Code's native Quick Pick for configured servers and local profiles.
The title `RAgents: <name>` and the header pill showing the name identify the selection;
the pill's accessible name reads `Environment <name>`.
The choice is remembered per workspace; reopening selects it again when still configured,
otherwise the first configured environment. Switching changes the interface without stopping
runs or disconnecting other servers or workstations. The selected server supplies its plugin
header already on the home, including its global coordinator when installed. If that environment
needs sign-in, is starting, or cannot be reached, the local shell shows its status and the
appropriate sign-in, connect, or retry action on a Server page showing only this environment.
The gear opens connection and profile management for all configured environments.

Runs in both hosts and Server in VS Code share a centered content area up to 1280 pixels wide.
Plugin pages use the available width, with equal top and side insets. All panel pages leave 12
spacing units (`pb-12`, the page step, 45.12 px at a 16 px root) below their last content; this space
scales with zoom. The outer header remains full width. Logo, Runs, plugin views, global coordinator,
Settings, and Help share the header. An open run places its layout actions in its own header,
without a separate toolbar row. Mini-app buttons use the remaining width between fixed controls,
then continue over the full width in further rows. VS Code opens mini-apps in editor tabs; the
browser opens them in its workspace. A narrow panel shows labelled buttons as icons before it
wraps anything, in the same order as in the browser.

Runs is always the first view beside the logo. A plugin can add further views with an icon and
title; the open entry is highlighted, and a tight header shows only the icons. A plugin view
replaces Runs or the open run as plain content on the normal background, and the main area scrolls
as a whole. The logo opens the home; opening a run leaves the view. In the browser the address
names Runs as `?page=runs` and a plugin view as `?page=<id>`, so reloading, bookmarking, back, and
forward keep it. A page that does not exist or that you may not see shows the home with a notice.
A run hidden behind a view keeps its input, layout, scroll position, and frames. Plugin pages
mount only while open; a page that fails shows its cause and Retry while navigation stays usable.

**Runs** combines **New run** and the full run list in a fixed view, without an edit mode. From
960 pixels of panel width they stand side by side; narrower panels stack them. New run is absent
when the selected server permits no new runs. Its first entry is the default template, marked
"Default", or "New chat". Remaining templates follow without duplicating the default. Each flat
card has a title, two description lines, and an always-visible action icon: plus for "New chat",
play for a direct start, sliders for "Set up". The entire card performs that action. Cards adapt
to their own width and become compact full-width rows in a narrow panel. Skill and script templates
share the same appearance. No dialog contains template tiles.

Clicking a template starts the run on its server and opens the run panel. Until the run opens,
the entry shows "Starting ..." with a spinner and the other entries stay locked. Cancelling a
folder choice or a guide, or a failed start, releases them and leaves Runs available.
In VS Code a new run works in an open folder of the window, asking you to choose when several
are open. A template that fixes its workspace keeps that choice. Without an open folder, VS Code
asks you to open one and starts no run. During workstation registration, the run waits and a
notification shows the current step. A refused registration leaves an error message and a notice
such as "Workstation not registered:" followed by the reason. A folder refused when the run opens
shows "The run cannot start as prepared:" in chat and sends no message.

Until content appears, the panel shows startup progress. A startup or setup error stays in the
same place while chat remains usable; an empty chat without a template has no loading state. If a
run cannot be started, the panel explains why and offers "Back to home". New and existing runs focus the
visible chat input when it becomes writable, including a remembered chat partner.

**All runs** lists every visible run, with search, "Hide ended", and selection for deleting several
runs after confirmation. Search and actions stay visible at the top of the list while it scrolls
and wrap within narrow panels. Rows share status, title, time, owner, workspace details, read marker,
and sharing actions in both hosts. Below 360 pixels of list width, owner and detail lines hide;
below 280 pixels, time hides as well. Each deletable run also has "Delete run ..." with its own
confirmation. Locked runs show their cause and stay selectable for deletion. A run shared with you
has no delete button. Selection adds checkboxes and hides row actions. "Shared by me" lists your
outgoing shares and recipients with View or Operate access and offers direct revocation. These
controls are the same in the browser and VS Code.

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

For "Full access" on this workstation, VS Code asks once per run in a modal dialog that names
the run and explains access to files, commands, and the inherited environment. The setting
`ragents.workstation.fullAccess` is `"ask"` by default; `"allow"` permits it without a dialog,
and `"deny"` refuses it. Confirmation is stored in the workstation's data folder and survives
restarts; deleting the run removes it. After a refusal, switch the run back to "Isolated" or
confirm full access in VS Code before retrying the operation.

To make RAgents smaller or larger independently of VS Code's window zoom, set `ragents.zoom`
in VS Code Settings. The value is a percentage from 50 to 200, with 100 as the default;
for example, `"ragents.zoom": 90` makes the whole interface 10% smaller. It applies to the home,
Runs, plugin pages, Server, the run panel, and mini-app editor tabs, including nested mini-apps. Changes take
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
the same profile. Click "Share ..." at the end of its row in Runs, or "Share" in the run
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
same in the browser and in VS Code; in a tight header the button shows only its icon, like the
other labelled header buttons.

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
back while you have the run open, the panel returns to the home and shows "This run is no longer
available to you."
<!-- /guide:clients -->

## Settings and behavior of the VS Code extension

- `ragents.theme` (`auto`, `light`, `dark`), `ragents.palette` (`schichtwerk`, `graphite`, `midnight`,
   `black`), `ragents.corners` (`round`, `tight`), `ragents.codeStyle` (`tint`, `outlined`), and
   `ragents.density` (`compact`, `comfortable`, `spacious`, default `comfortable`) take effect immediately
   in every open panel and mini-app tab. Switching in the panel (the palette button in the header or
   Settings, Appearance) writes the matching user setting, so the choice is kept across restarts and
   workspaces; `auto` follows the VS Code color theme, which is also what "System" means there.
- `ragents.zoom` (50 to 200 percent, default 100) scales the entire interface including
   mini-apps immediately, without reloading pages. VS Code's window zoom stays unchanged.
- `ragents.hostEnvironment` lists the names of the environment variables that a locally started
   host receives in addition to the inherited environment. The setting holds only names; the
   command "RAgents: Set secret" puts the values into VS Code's SecretStorage, "RAgents: Delete
   secret" removes them again. When a host starts, the stored values take precedence over
   the inherited environment; if one is missing, the `RAgents` channel names only its name, never a value.
   That way a profile that resolves values through `env("NAME")` also starts in a VS Code that
   comes from the Dock without the shell's variables.

If a server is unreachable, its row on the Server page and the local fallback shell show the
cause and "Retry", and the
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

`--access full` explicitly requests full access; without it, the run is isolated. The same
ownership, server permissions, and workstation confirmation rules as in the composer apply.

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
<!-- /guide:clients -->
