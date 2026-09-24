# Actors and messages

Runs, actors, messages, turns, and the journal form the shared runtime.

## Runs and participants

A run is a conversation with its own participants, working files, and journal. An actor is a
participant in that run: the human owner, an LLM agent, or a TypeScript actor. LLM agents
process tasks with a model; TypeScript actors execute their programmed input handler. The actor
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
3. The driver processes only this input.
4. Model output, reasoning, runtime output, and tool calls are automatically recorded as
   events in the journal.
5. The turn ends as `completed`, `failed`, or `interrupted`.

Additional inputs wait for the next turn. They are not injected into a running turn. An input
that refers to the running turn, such as a reminder or a status note, would therefore always be
outdated when processed and must not be queued. Only an agent hook can enter a running turn: the
`beforeModelCall` hook of an `agentRuntime` contribution adds a hidden note before each model
request without ending the turn. This is how actor-program project diagnostics work for actors
equipped with actor-program tools, and how a product plugin can provide progress reminders.

A failed turn, or one interrupted by a server restart, is not queued or executed again
automatically. ActorInputs that were already queued but not yet claimed remain waiting. After
startup they can be processed if their actor is still executable. Anything a function call has
recorded in the journal remains valid; a later failure in the same turn does not invalidate it.
A service waiting for a submitted result therefore does not tie that result's validity to the
turn outcome.

For an LLM, one turn can include several model requests and TypeScript snippets. `return` ends
the current snippet and gives its findings to the model. The model can then decide what to do
and execute another snippet within the same turn. A snippet does not wait for later agent
responses or events: a subscription creates a new ActorInput and therefore a later turn. The
programming language needs no additional decision point for this.

## Model context across turns

Each LLM actor has its own conversation context, which persists across turns. A new input adds
to that conversation. In server operation, the context is stored separately and reloaded after
a restart. A new actor starts with its own context or, when spawned with `forkOf`, with a copy
of another LLM actor's context from the same run. Updating the system prompt does not replace
the existing conversation history.

Programmed actor state stores explicitly assigned data for functions and mini-apps. Before a
replacement state is diffed and journaled, it is converted to JSON form: keys whose value is
`undefined` are treated as absent both in memory and on disk, while a `set` state change without
a value remains invalid. The journal records the run's shared events and derives the chat view
from them. These three forms of state serve different purposes: the visible chat is not a full
copy of the current model context, and a new turn does not mean the model starts without its
conversation memory.

## Interrupting a turn, stopping an actor, stopping a run, and shutting down the server

All stop paths follow the same principle: block new work first, then cancel, wait for running
work, and only then release resources. The exact boundary differs:

Interrupting a turn is not a stop. The stop button in a chat input ("Arbeit stoppen") ends only the
running turn of that chat's actor as `interrupted`: its running function calls are aborted, the
visible text of its unfinished answer stays, and the actor remains active and takes the next
message as a new turn. Its children and all other actors keep working, and without a running
turn of this actor the input offers no stop. Stopping an actor for good and stopping the whole
run are separate, explicitly labeled actions.

In the run title bar, a user with write permission can request a complete stop through "Run
stoppen" (stop run) and a confirmation. The primary actor can also trigger it with `run_stop`. Both use the
same host stop boundary; the conversation and files remain intact. The function call initiates
the stop but does not wait for cleanup of its own turn. Acceptance is not proof of completion.
Cleanup errors are reported in the server log while the stop path's normal quarantine remains
in effect.

- Turn interruption (`ragents.runs.interruptTurn`): Ends the running turn of one actor and
  nothing else; the actor, its model runtime, its children, and the run stay as they are.
- `actor_stop`: Stops the actor, interrupts its running turn, and disposes its model runtime
  after the turn. Its active descendants are stopped in the same journal command, so a branch is
  never stopped halfway. The journal names the actor that called `actor_stop` as the one who
  stopped them. Run data and plugin sessions remain.
- Run stop: The scheduler temporarily accepts no new work for this run; concurrent stop calls
  are handled together. The primary actor remains, but its running work is interrupted. All
  other agents and TypeScript actors in the user's ownership tree are stopped. Agent runtimes
  and plugins receive their abort signals in parallel. The actor-program plugin also cancels
  pending app actions. An open confirmation question is discarded through `ragents.ask` in the
  journal and the domain operation is no longer invoked. The run can be reused afterward.
- Run deletion: The scheduler stops the run. Its agent runtimes are then disposed and plugin
  deletion hooks run. The chat, recovery data, and journal are archived; session-bound plugin
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

`actor_input` delivers text and optional artifacts directly to exactly one executable actor.
The driver receives the content without a routing envelope. There are no channels, message
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
the reason and changes as soon as its wake condition is met. Instructions may say "end the
turn" only where such an observer exists. Synchronous functions return their result, and the
caller continues in the same turn.

## IDs, handles, and creating actors again

An actor has a technical ID and a readable handle such as `@worker`. Wherever a function, method,
or plugin accepts an actor by ID or handle, the same rule resolves it: the leading `@` is
optional, and case and Unicode composition do not matter. Once assigned, a handle
remains reserved within the run even after the actor stops, so a handle always names exactly one
actor, and restarting by handle reaches the stopped actor. If another LLM agent is created with
the same requested name, it receives an available suffix such as `worker-1`. `agent_spawn`
returns the `{ id, handle }` of the actor it actually created; later calls use that reference.
Requesting the same name does not automatically reuse an existing actor.

Restarting continues the same stopped actor. If the owner restarts the actor that was the primary
actor when it was stopped, and no other primary actor has been chosen since, it becomes the
primary actor again, so its chat continues. For TypeScript actors, creation rejects a handle
that is already assigned. The creation itself remains recorded as an event in the journal.

## Equipping subagents

`agent_spawn` requires an explicit function selection in `tools`:

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
inherited, although delegable engine capabilities still are. `withoutCapabilities` removes
named technical permissions. Availability and grants also apply when the value is `null`.
`forkOf` (a handle or ID) makes the new agent a fork of an LLM agent in the same run:
`agent.spawned` records the source, and on the new agent's first turn the agent driver copies
the source's stored context branch into its own context file. The copy ends before the source's
first unanswered function call and contains no reasoning blocks; the new agent supplies its own
system prompt, functions, and model. Later turns from the source are not copied. Both source and
fork require the agent driver; a source without stored context is a hard error on the fork's
first turn. A plain LLM receives no function overview. Its driver must explicitly support this
isolation or the turn is rejected.

Equipped LLMs receive `typescript_api` and `typescript_eval`, plus an automatically generated
overview of their available TypeScript functions with names and short descriptions. The
overview stays current during the turn. Domain functions are called through
`context.functions` in snippets. Additional native tools require explicit registration. Roles
and work boundaries remain prompt instructions. Alongside a profile, `agent_spawn` accepts
`model` and `thinking` from the model list. A profile supplies only the driver, provider,
reasoning level, timeout, and workspace default; the product model list defines which models are
available. If neither a model nor a profile that supplies one is present when an agent starts,
the error lists the available profiles for the selected driver. A manual profile is not
suggested as an agent's model choice.

## Journal and projection

The journal is the shared history of a run. Visible state is produced by replaying its events;
models and functions are not called again in the process. Recorded responses, function calls,
state changes, and interruptions therefore remain traceable after a restart. Working files and
private model context are stored separately outside the journal.
