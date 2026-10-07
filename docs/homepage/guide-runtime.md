# Actors and messages

Runs, actors, messages, turns, and the journal form the shared runtime.

## Runs and participants

A run is a piece of work with its own participants, working files, and journal. An actor is a
participant in that run: the human owner, an LLM agent, a TypeScript actor, or an external actor.
LLM agents process tasks with a model; TypeScript actors execute their programmed input handler;
external actors use a named runtime provided by a plugin. The actor
selected as primary is the user's direct chat partner. This choice does not depend on who
created the other actors.

An ActorInput is a task for exactly one executable actor. A turn processes exactly that input.
An event records something that happened, such as a model response or a function call. These
terms separate the task, its execution, and its recorded result.

Native background tasks can use `presentation: "background"`. They are queued normally,
delivered to the actor in full, and retained in the journal. The main chat and actor
conversation hide the internal task while keeping the response visible. The same applies when
the history is restored. Without this marker, presentation remains unchanged. For users
without inspection permission, the run view contains none of the task text.

## Scheduler and turns

The scheduler processes at most one turn per actor:

1. It claims exactly one waiting ActorInput.
2. It assembles the toolset, working directory, and system prompt.
3. The driver processes this input; an agent's driver also takes steering (see below).
4. Model output, reasoning, runtime output, and tool calls are automatically recorded as
   events in the journal.
5. The turn ends as `completed`, `failed`, or `interrupted`.

`turnTimeoutMs` limits inactivity, in milliseconds. The timer restarts after a completed model
step, streamed model output (including reasoning, tool arguments, and compaction summaries),
a tool call start or completion,
a presented tool result, or steering input joining the turn. A turn that keeps making progress
can run longer than the limit; a stalled turn is stopped after the limit. `null` or zero disables it.
The journal records the timeout cause, for example "The turn made no progress for 60 minutes
and was stopped." Manual cancellation keeps "The turn was cancelled." Turn end event types and
the journal format stay unchanged, so existing journals replay as before.

Inputs that arrive while an agent's turn runs join that turn as steering. Before each model
request, the turn takes all waiting inputs of its actor in journal order and hands them to the
model after the results of the tool calls that were running; a running tool call is neither
aborted nor cut short. If the model has just given its final answer, or a function result has
ended the turn (such as a question to the user), a joined input starts another model request in
the same turn. The journal records each joined input with
`turn.input-steered`, and the chat marks the message as fed into the running turn. An input that
arrives after the last model request of the turn, or after the turn was interrupted, starts the
actor's next turn instead. TypeScript and external actors take no steering; their inputs
always wait for the next turn. An input longer than 30,000 characters does not join; it and every
later input wait for the next turn, so the order stays intact.

A hidden note about the running turn, such as a status note or a progress reminder, does not
belong in an input: an input appears in the chat and starts a new turn once the current one has
ended. Such a note comes from an agent hook: the `beforeModelCall` hook of an `agentRuntime`
contribution adds it before each model request without ending the turn. This is how
actor-program project diagnostics work for actors equipped with actor-program tools, and how a
product plugin can provide progress reminders.

A failed turn, or one interrupted by a server restart, is not queued or executed again
automatically. ActorInputs that were already queued but not yet claimed remain waiting. After
startup they can be processed if their actor is still executable. Anything a function call has
recorded in the journal remains valid; a later failure in the same turn does not invalidate it.
A service waiting for a submitted result therefore does not tie that result's validity to the
turn outcome.

For an LLM, one turn can include several model requests and TypeScript snippets. `return` ends
the current snippet and gives its findings to the model. The model can then decide what to do
and execute another snippet within the same turn. A snippet does not wait for later agent
responses or events: a subscription creates a new ActorInput, which reaches the model at the
earliest after the snippet, as steering or in a later turn. The programming language needs no
additional decision point for this.

## Model context across turns

Each LLM actor has its own conversation context, which persists across turns. A new input adds
to that conversation. The context is part of the run's journal: every input as the model received
it, every completed model step, every tool result as the model saw it, and every compaction are
recorded there, and the context is read back from those records before each model request. After
a restart the actor therefore continues with exactly the same context. A new actor starts with its
own context or, when spawned with `forkOf`, with an unchanged copy of the context another LLM actor
of the same run had at the end of its last finished turn before the spawn. Updating the system
prompt does not replace the existing conversation history. The system prompt stays the same from
turn to turn; what changes per turn, such as the actors of the run at the start of the turn or the
skills selected for the task, arrives with the turn's input and stays in the conversation as it was.

Programmed actor state stores explicitly assigned data for functions and mini-apps. Before a
replacement state is diffed and journaled, it is converted to JSON form: keys whose value is
`undefined` are treated as absent both in memory and on disk, while a `set` state change without
a value remains invalid. The journal records the run's shared events and derives the chat view
from them. These three forms of state serve different purposes: the visible chat is not a full
copy of the current model context, and a new turn does not mean the model starts without its
conversation memory.

When the context grows too large, the agent compacts it: older parts are replaced by a summary
written by the model, and recent parts are kept. A compaction is recorded in the journal as well,
and the chat shows a short system note. When it starts, how much recent context stays verbatim,
and how long the summary may be are values of the model; a profile sets them for each model alias.

## Interrupting a turn, stopping an actor, stopping a run, and shutting down the server

All stop paths follow the same principle: block new work first, then cancel, wait for running
work, and only then release resources. The exact boundary differs:

The stop button in a chat input ("Stop work") pauses the whole run: from that moment no turn of
any actor starts, the running turns of all actors, the coordinator's sub-agents included, end as
`interrupted`, and the run stays paused until a human continues it. Nothing is lost: what arrives
in the meantime waits in the journal. The visible text of an unfinished answer stays, and every
actor stays active. Interrupting the turn of a single actor only, stopping an actor for good, and
stopping the whole run are separate, explicitly labeled actions.

In the run title bar, a user with write permission can request a complete stop through "Stop
run" and a confirmation. The primary actor can also trigger it with `run_stop`. Both use the
same host stop boundary; the chat and files remain intact. The function call initiates
the stop but does not wait for cleanup of its own turn. Acceptance is not proof of completion.
Cleanup errors are reported in the server log while the stop path's normal quarantine remains
in effect.

- Run pause (`ragents.runs.pause`, the chat's stop button, `ragents stop <run>`): No turn starts
  any more and the running turns of all actors end; inputs keep arriving and wait. A human input
  or `ragents.runs.resume` continues the run (section Pausing a run).
- Turn interruption (`ragents.runs.interruptTurn`): Ends the running turn of one actor and
  nothing else; the actor, its model runtime, its children, and the run stay as they are.
- `actor_stop`: Stops the actor, interrupts its running turn, and disposes its model runtime
  after the turn. Its active descendants are stopped in the same journal command, so a branch is
  never stopped halfway. The journal names the actor that called `actor_stop` as the one who
  stopped them. `ragents.ask` withdraws the open `ask_user` questions of the stopped actors. Run
  data and the run's plugin data remain.
- `actor_restart`: Makes a stopped actor of the caller's branch idle again under the same
  capability `execution.stopOwned`; history, state, and model context stay as they were, and it
  accepts inputs again. Subscriptions removed by the stop stay removed. The button "Restart"
  (`ragents.runs.restartActor`, in the owner's name) and the actor-program plugin, when it activates
  or ensures a package whose actor is stopped, use the same restart.
- Run stop: The scheduler temporarily accepts no new work for this run; concurrent stop calls
  are handled together. The primary actor remains, but its running work is interrupted. All
  other executable actors in the user's ownership tree are stopped. Their runtimes
  and plugins receive their abort signals in parallel. The actor-program plugin also cancels
  pending app actions. An open confirmation question is discarded through `ragents.ask` in the
  journal and the domain operation is no longer invoked; the open `ask_user` questions of all
  agents, including the primary actor, are withdrawn. The run can be reused afterward.
- Run deletion: The scheduler stops the run. Its agent runtimes are then disposed and plugin
  deletion hooks run. The chat, recovery data, and journal are archived; run-bound plugin
  data, including its logs, is removed afterward.
- Server shutdown: The scheduler interrupts running work and waits for it to finish. It then
  shuts down all agent runtimes and plugin services. Persisted run data remains intact.

After active actor work ends and the first plugin cleanup completes, the host releases remaining
resources. The run stays locked until this cleanup finishes, even if the stop request has already
returned. If cleanup fails, the stop reports the error and the server log records it. The run
then accepts work again instead of remaining permanently stuck, and another stop retries cleanup.

Inputs accepted for the still-active primary actor during this lock are processed automatically
after a successful release. The scheduler checks the remaining open inputs again; inputs that
were already claimed or discarded are not repeated.

## Actors, inputs, events, and subscriptions

`actor_input` delivers text and optional artifacts directly to exactly one executable actor:
`to` names the recipient by handle or ID, `message` is the text, as in the messaging tools of
common agent harnesses. The driver receives the content without a routing envelope. There are no channels, message
domain, read receipts, mention syntax, or special result or delivery message. Communication is
plain text. The sender can be a human owner, another actor, or a subscription delivery. Normal
model responses need no sending function: every completed output is already a
`model.output.completed` event.

A successful `actor_input` confirms only that the input was queued. LLM actors interpret
open-ended tasks; TypeScript actors process only their programmed input protocol. The actor
list, turn context, and function description explain this distinction. A primary actor is the
default target of a run, not automatically a chat partner. Programmed inputs and subscriptions
remain available independently of the narrower chat routes.

Model text, reasoning, runtime output, function starts, function results, turn completions,
actions, artifacts, and stops are separate journal events. `event_subscribe` filters only by
structured source actor IDs, source actor kinds, event types, and optionally the subscriber
itself. Turn ends and stops belong to the actor they concern, whoever wrote them:
`turn.finished` and `turn.interrupted` count for the actor that owns the turn, `actor.stopped`
and `actor.restarted` for the actor stopped or restarted. A subscription to a worker therefore
sees its interruption and stop even when the owner or another actor stops it, and without
`includeSelf` a subscriber is not woken by the interruption of its own turn. Matching NEW
events are delivered as new inputs. The subscriber can evaluate and condense them, then use `actor_input` to pass natural text to LLM actors or suitable program
input to TypeScript actors. A mediator is therefore just a regular actor with the appropriate
functions; the mediated LLMs do not need to know the mediator or RAgents. `event_query` reads
history but does not trigger delivery.

WAKE-UP GUARANTEE: There are no waiting functions; a completed turn waits for nothing. Anyone
who prompts an actor to end its turn and wait to be woken must guarantee that wake-up. The
controlling actor must therefore be a TypeScript actor or a host service that subscribes to its
worker's turn end (`event_subscribe` for `turn.finished` and `turn.interrupted`, or host journal
observation) and decides at every end whether the worker is finished, waiting for someone else,
or needs another prompt. An LLM coordinator that "waits passively" is not a wake-up. A watcher
from `ragents.watch` (`plugins.md`) is such a host service: it wakes the controlling actor with
the reason and changes as soon as its wake condition is met. `ragents.ask` is another: after
`ask_user` the asker ends its turn, and the answers or the user's next message arrive as a new
input. Instructions may say "end the turn" only where such an observer exists. Synchronous
functions return their result, and the caller continues in the same turn.

## IDs, handles, and creating actors again

An actor has a technical ID and a readable handle such as `@worker`. Wherever a function, method,
or plugin accepts an actor by ID or handle, the same rule resolves it: the leading `@` is
optional, and case and Unicode composition do not matter. A handle consists of letters, digits,
dashes, and underscores; the dot separates a room from the handle (section Rooms). Once assigned,
a handle remains reserved even after the actor stops, so an address always names exactly one
actor, and restarting by handle reaches the stopped actor. If another LLM agent is created with
the same requested name, it receives an available suffix such as `worker-1`. `agent_spawn`
returns the `{ id, handle }` of the actor it actually created; later calls use that reference.
Requesting the same name does not automatically reuse an existing actor.

Restarting continues the same stopped actor. If the owner restarts the actor that was the primary
actor when it was stopped, and no other primary actor has been chosen since, it becomes the
primary actor again, so its chat continues. For TypeScript actors, creation rejects a handle
that is already assigned. The creation itself remains recorded as an event in the journal.

## Rooms

A room is a delimited part of a run: its own participants with their state, apps, and
conversations, in the same run, journal, workspace, and folder. Every run has a main room; further
rooms stand beside it, never inside one another. Every start of a run script opens a room of its
own, named after the script (`review-changeset`, then `review-changeset-2`, and so on), and
everything the script creates lands there. A repeated start therefore gets its own participants
instead of reusing those of an earlier start. A new agent always joins the room of whoever created
it.

An actor's address is `room.name`; the main room has no prefix, so a run without rooms looks as
it always did. Names are relative to the room of whoever writes them, like paths relative to a
working directory: inside room `review-2`, `rule-review` means `review-2.rule-review`; from
another room it is written `review-2.rule-review`; and the actors of the main room are written
without prefix from anywhere. Functions show every address from the caller's room, so a model
takes names from their results instead of building them.

## Equipping subagents

`agent_spawn` creates exactly one LLM agent or external actor in the run, with the fields of the
subagent tools of common agent harnesses: `description` is a required label of a few words,
`prompt` is the first task, and `name` is the requested handle. `instructions` holds the lasting role and rules for the
agent's system prompt; a role from `model_list` supplies none. With `prompt`, the command that
writes `agent.spawned` also enqueues the task as the agent's first input, so the agent starts at
once; this needs `actor.input` besides `agent.spawn`. Without `prompt` the agent stays idle until
an `actor_input` reaches it. Nothing waits for the agent: the call returns `{ id, handle }`, and
its answers reach the caller only as later inputs of a subscription to its events, while failed
and interrupted turns arrive as automatic notices. Because a task given at the spawn starts at
once, a subscription made afterwards can miss the first answer; whoever needs it creates the
agent without `prompt`, subscribes, and then sends the task with `actor_input`. A prepared setup
joins a run through `run_script_start` and a TypeScript actor comes from an actor program;
`agent_spawn` creates neither, and no function of a run creates another run.

For an external actor, select `runtime` from the names and titles in `model_list` and the
configured runtime choices of `agent_spawn`. Use `tools: null`; its coding tools belong to its
runtime, and no RAgents functions are passed to it. `provider`, `model`, `thinking`, and `forkOf`
are invalid with an external runtime. Its `instructions` become lasting prompt instructions;
its `prompt` is the first queued task, as for an LLM actor.

`agent_spawn` requires an explicit function selection in `tools` for built-in LLM agents:

| Selection                            | Equipment                                                          |
| ------------------------------------ | ------------------------------------------------------------------ |
| `[]`                                 | Plain LLM without runtime, workspace, or host functions.           |
| `["read", "write", "edit", "bash"]` | Exactly these functions, for example for a coding agent.           |
| `null`                               | The full dynamic set, including access added later.                |

A missing selection or unknown names are rejected before spawning. Actors created any other
way, by the host, a run script, or an actor program, are checked by the scheduler: when an actor
it runs (any driver except `manual`) is created or restarted, it resolves the requested names the way a turn would, counting functions
that are currently unavailable as known. A name that no host function provides stops the actor
before its first turn, and the stop reason names the unknown tools. The selection is not
inherited, although delegable engine capabilities still are, except that an inherited copy of a
first-hand capability (`firstHandCapabilities` in `domain/vocabulary.ts`, today `script.start`) is
not delegable further. `withoutCapabilities` removes named technical permissions. Availability and grants also apply when the value is `null`.
`forkOf` (a handle or ID) makes the new agent a fork of an LLM agent in the same run:
`agent.spawned` records the source, and the new agent's context begins with an unchanged copy of
the source's context up to the end of the source's last finished turn, reasoning blocks included.
Nothing from the turn the source is running at the spawn is copied, and no text is inserted; the
new agent supplies its own system prompt, functions, and model. Later turns from the source do not
reach the fork. Both source and fork require the agent driver; a source without a finished turn that
reached the model, and not itself a fork, is rejected with `fork-without-turn`. A plain LLM receives no function overview. Its driver must explicitly support this
isolation or the turn is rejected.

Equipped LLMs receive their available functions as native tools, plus `typescript_api` and
`typescript_eval`; snippets call the same functions through `context.functions`. A generated
overview in the system prompt lists only the snippet-only functions (`nativeTool: false`) with
names and short descriptions. Tools and overview stay current during the turn. Roles
and work boundaries remain prompt instructions. Alongside a role (field `profile`), `agent_spawn` accepts
`model` and `thinking` from the model list. A role supplies only the driver, provider,
reasoning level, turn inactivity limit, and workspace default; the product model list defines
which models are available. If neither a model nor a role that supplies one is present when an
agent starts, the error lists the available roles for the selected driver. A manual role is not
suggested as an agent's model choice.

`agent_spawn.turnTimeoutMs` overrides the role's inactivity limit; without either value there is
no limit. `model_list` reports each role's limit as `turnTimeoutMs`, with `null` for no limit.

## Journal and projection

The journal is the shared history of a run. Visible state is produced by replaying its events;
models, functions, and external runtimes are not called again in the process.
Recorded responses, function calls,
state changes, and interruptions therefore remain traceable after a restart. The model context of
every LLM agent is part of the journal as well; working files are stored separately.
