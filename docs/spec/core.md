# Core: runs, actors, inputs, turns, and events

The core is the package `@ragents/engine`: product-neutral, it knows no domain. `domain/` and
`runtime/` are the journal model, `agents/` runs agents and schedules their turns, `drivers/`
connects the agent runtime, `script/` the TypeScript actors, `typescript/` is the platform's
compiler and runtime context, `rpc/` the message layer, and `http/` its runtime contracts and
methods. `plugin-host.ts` and `plugin-types.ts` define the registration and contribution kinds of
plugins; what a plugin may be built against is set by the host API list
`apps/server/src/host-api.json` (`plugins.md`).

<!-- guide:runtime -->
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
<!-- /guide:runtime -->

## Runtime boundary

```text
Commands -> Orchestration -> Journal v4 -> Projection -> LiveBus
                |                 |
                |                 +-> JSON-RPC (HTTP or stdio) and web projection
                |
                +-> TurnScheduler -> AgentLoopDriver -> AgentTurn -> agent loop
                                  |        ^
                                  |        +-- model context = projection of the journal
                                  +-> ScriptDriver -> TypeScript platform -> Node process
                                  \-> external runtime registry -> plugin-provided driver
```

`Orchestration` is deterministic application code and not a model. Every accepted command produces
a coherent group of events. The journal persists them, updates the projection, and only then
publishes live notifications. No driver, plugin, or protocol adapter writes past the journal.

### External runtimes

The execution kinds are `manual`, `agent`, `script`, and `external`. An external execution carries
`{ runtime: string }`; `agent.spawned` projects it as actor kind `external`. The catalog and
scheduler resolve this name against the plugins' `actorRuntimes` contributions. A missing runtime
is a hard error naming the available runtimes. External runtime selections default to the
shared run workspace; the contributing driver validates any explicitly requested isolation.
The engine knows no external protocol or vendor.

A contribution supplies `AgentDriver<"external">` with the ordinary turn and cleanup lifecycle.
Its request contains the runtime name, lasting instructions, input, attachments, workspace,
`publish` for live deltas, `emit` for observable text and reasoning, and `recordTool` for tool
starts, completions, and failures. A separate `external.output.record` decision writes
`model.output.completed` or `model.reasoning.completed` only for a running external turn. It writes
no `model.step.completed`: the external runtime owns its model context. Interrupted partial text
uses the existing `model.output.interrupted`. Chat, subscriptions, and journal replay read these
same observable events without executing the runtime again.

<!-- guide:runtime -->
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
<!-- /guide:runtime -->

### Empty responses, tool calls, and toolset

A model response without text and without a tool call (only reasoning, stop reason `stop`) does not
end the turn: the agent loop nudges exactly once with the user message "Your response contained
neither text nor a tool call. Respond now with the next tool call or your answer." If the following
response is empty as well, the turn ends as `failed` with the cause "The model returned an empty
response twice." as runtime output and reason in `turn.finished`, not as `completed`. A response
with text or a tool call resets the count; each completed step also resets the turn's inactivity
limit.

The run view projects tool calls per turn as compact `toolCalls`: identifier, name, status, and
start/end time. The existing start, result, and error events update them. If a turn ends with calls
still open, its end finishes them as `interrupted`, whether through `turn.interrupted` (stop,
cancellation, restart) or a failed `turn.finished`; nobody writes a separate error event for this,
and a successful `turn.finished` with open calls is invalid. The turn end carries the reason. This
projection is the only source for the state of a call: scheduler, journal check, chat, and actor
history read it. Call IDs always belong to their turn and may occur again in a later turn. Inputs,
results, and error texts are not copied additionally. Journal replay rebuilds the same projection
for all actors, independent of the primary chat.

Between call start and completion, `tool.call.source` can record the TypeScript source actually
read, together with an optional original file path. The assignment follows turn and call
identifier. The source event triggers neither a new execution nor a new turn; it adds to the
historical record. Even if the following type check fails, start, source, and error stay readable
together in the journal. The compact `toolCalls` projection does not copy the source additionally;
detail views read the stored event.

The `TurnToolset` binds calls to exactly one turn. After that turn ends, the binding is invalid.
Before calls, it resolves the current tool set again through the registry. Between model requests,
the agent runtime renews native schemas and the generated system overview from the same set without
ending the running turn. Hooks, in contrast, live with the agent's runtime across its turns and must
not capture old turn state.

## Actor state and functions

Every executable actor has intrinsic state. TypeScript functions, input processing, and associated
views use the same journaled data. The state belongs to the actor, not to a second app or tool
namespace. The backend context reads a snapshot and stages changes explicitly through
`context.state.replace`. Only successful completion commits them; errors and cancellation discard
the staged state changes.

A function result is not state. A direct view or tool call of a function needs no model turn.
ActorInputs, in contrast, stay in the normal actor queue: an LLM actor processes them with its
model, a TypeScript actor with its program's input handler, and an external actor with its runtime.
LLM and TypeScript actors can own the same kinds of functions and React views. The package and activation lifecycle belongs to the plugin
`ragents.actor-programs` and is described in `actor-programs.md`.

<!-- guide:runtime -->
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

RAgents shows context usage as a ring in the built-in model chats. Its pop-out lists used tokens,
the context window, and the compaction threshold. Estimates are marked; after compaction the
ring measures the summary and retained context.
<!-- /guide:runtime -->

The read-only `ragents.chat.contextUsage` operation uses the same active-context estimate as
compaction, including cache tokens and new inputs or tool results and excluding usage before the
latest compaction. The limits describe the selected model, which applies from the next turn.
Script and external runtimes return no built-in context metric. The existing run channel updates
the display; Quassel hosts the control through its generic composer slots, with the host's Button
and Popover. Reading an idle actor's context does not keep it in the runtime's turn cache.

## Model context and agent runtime

The journal alone holds the model context of an LLM actor. It is lossless for everything the model
sees; the context is a pure, deterministic projection of it (`modelContextOf` in
`packages/ragents/src/agents/model-context.ts`). The projection never re-renders; it reads stored
forms. There is no private session file of the runtime.

The system prompt holds only what stays the same for an actor in its run: base prompt, role and
output contracts, the tool orientation, the skill catalog, and the workspace chapter. It changes
only with the configuration or the tool set, never with the run's state. Everything that changes
from turn to turn goes into the input that starts the turn and is journaled with it in
`model.input.presented`: before the input text the orientation (`TurnRequest.orientation`), that is
the actor roster as of turn start and the host's context for this input, such as the interface
context of a global message; after it, as a text part of its own, the skills preloaded for the
turn. The projection replays earlier turns with exactly this text. The request prefix of system
prompt, tools, and projected messages is therefore byte-identical across turns and restarts and
only grows at its end, which the providers' prompt cache needs, and an actor continues with exactly
the same context after a server restart. Inputs of older journals lack these parts and replay as
they were stored; nothing adds them afterwards.

### What goes into the journal

Four events carry the context, all in the name of the actor and its running turn (the binding
payloads are in `domain/events.ts`):

- `model.input.presented`: a user message exactly as it went to the model, at its position between
  the model steps: the input that starts the turn, every input taken over through steering
  (`inputId`), and the loop's nudge after an empty response (`inputId` `null`). The text is
  rendered, with the orientation before it, the header line of delivered events, and embedded text
  attachments; preloaded skills follow as a second text part. Images, videos,
  and PDFs are stored as the SHA-256 of their bytes under `artifacts/` (`{ type, mimeType, hash }`,
  files with `filename`), never as Base64.
- `model.step.completed`: the complete assistant message of a model step, unabridged, with text,
  thinking (signatures, `redacted`), and tool call blocks (`thoughtSignature`), plus `api`,
  `provider`, `model`, `usage`, `stopReason`, `errorMessage`, and the provider's timestamp. It is in
  one command with the observation events: before it, one `model.reasoning.completed` per non-empty
  thinking block and one `model.output.completed` per non-empty text block, in block order and
  unabridged; the step itself does not repeat this text, and a block without its own text field
  takes the next text of its kind from its command. A step that the provider ends with an error is
  written, an aborted one never.
- `model.tool-result.presented`: what the model saw of a tool call, after replacement by
  `afterToolCall`, with `isError`, images as a hash. If it is exactly the text of the
  `tool.call.completed` (output as text or JSON) or `tool.call.failed` of the same call, `content`
  is omitted (`domain/tool-result-text.ts`); it becomes necessary through a notice about ignored
  fields, through `recordOutput`, or through a hook.
- `context.compacted`: a compaction with summary, the first kept context event
  (`firstKeptEventId`), `tokensBefore`, the model used, and the files read and changed, from file
  format 9 also the model's threshold and its origin (`threshold` with `tokens` and `source`:
  `model` for own values, `catalog` for the catalog default).

A model step is context only once its command is written. The agent loop gets the context anew from
the projection before every model request (`transformContext`), not from its own memory; if writing
fails because the turn has ended in the meantime, the loop ends. A crash therefore leaves no half
step behind: the turn ends as interrupted at the next start, and the next turn begins after the
last presented input.

### Projection

The projection reads the actor's events in journal order. A fork (`forkOf`) begins with a copy of
the context of its source up to the end of the source's last finished turn before its
`agent.spawned`. It takes over nothing from the turn the source is running at the spawn, not even
its input; the copy is unchanged, with reasoning blocks and without inserted text. Whether reasoning
is replayed for the fork's model is decided, as for every step, by `transform-messages`. The
decision checks the same condition as the projection: if the source has no finished turn before the
spawn that presented an input to the model (`RunState.contextTurns`), and is not itself a fork,
`agent_spawn` rejects the fork with `fork-without-turn` (409); a turn that failed or was aborted
before the first model request does not count. Later turns of the source do not belong to the
fork. After that, the last compaction applies: its summary, the entries from the first kept one,
and everything after (`packages/agent/src/core/context-log.ts`). The rules for steps with an error
or abort, for tool calls without a result (a synthetic error result), and for replaying reasoning
with the same model stay in `packages/ai/src/api/transform-messages.ts`. Model choice and thinking
level are not context: every step names its model itself. The runtime adds to what the projection
delivers per request only the notes of the hooks (`AgentTurn` in `drivers/agent-turn.ts`).

The identifier of a model context (`ToolScope.modelContext`, basis of the seen file state in
`plugins.md`) is the run's `run.created` plus the actor's last compaction; it changes with every
compaction. A run fork (`forkRun`) takes over the model contexts of its agents together with the
journal.

### Held context

The runtime does not read the context from the whole journal before every request. `ModelContexts`
(`model-context.ts`, reachable through `Orchestration.modelContext`) holds it in memory per run and
actor and appends only the events since the last state (`Journal.eventsSince`); a gap in the
sequences is a hard error. The result is the same as `modelContextOf` over the whole journal; the
golden cases check both byte for byte. The inherited part of a fork is determined by the state
once, because it ends before the spawn. A compaction is an event like any other. The state is held
only during a turn: when the actor's turn ends (`turn.finished` or `turn.interrupted`), the runtime
releases it, and the next turn builds it once from the journal on first access. This way idle runs
occupy no memory, not even with the media of their contexts, which are stored as bytes in the held
state. It is also rebuilt after a server start and when the run has a different first event than at
the last access. Deletion and conversation reset discard it together with the journal
(`forgetRun`); a locked run delivers no context but `journal-unavailable`. The delivered context is
frozen. `Orchestration.heldModelContexts` names the number of held states.

### Turns of an agent

`AgentLoopDriver` (`drivers/agent.ts`) holds a `ManagedAgentRuntime` per `runId + agentId` with the
resolved skills, the plugins' hooks, and skill preloading; it holds no conversation. Per turn, an
`AgentTurn` sits directly on the agent loop (`Agent` from `@ragents/agent`): it binds the turn's
tools, reads the context, stores the loop's messages as events (`TurnRequest.recordContext`), and
detaches at the end of the turn, so that nothing holds a closure over an old turn.
For the built-in driver, completed responses and reasoning arise from a model step (`recordContext` with `step`);
`TurnRequest.emit`
records its aborted text and runtime outputs. External drivers record completed observations
through the separate decision described under External runtimes.

Every tool call of the model is in the journal, including one that fails before it starts: if the
tool is missing at the call, the refresh of the tools fails, or the input does not match,
`TurnToolset.invoke` writes start and error after the fact, and the model gets the error result.
The turn continues. The identifier of a call is unique in the model context: if a model names an
identifier already used, the call gets the suffix `-2`, `-3`, and so on before its execution and
before the journal. If the agent loop itself fails, for example when refreshing the tools between
two steps, the turn ends with that error; the loop's replacement message (`isRunFailure`) is not a
model step and does not go into the journal. After a cancellation during the wait for a retry or
during a compaction, the runtime reports no failed compaction.

An ActorInput starts at most one turn. Further inputs to an agent with a running turn come into
that turn as steering: the agent loop queries its steering source (`Agent.steeringSource`) before
the first model request and after every response together with its tool results, and the runtime
passes this on to `TurnRequest.claimSteering`. The scheduler then takes the oldest waiting inputs
of the actor in journal order, up to the first one with more than 30000 characters of content
(`STEERING_MAX_CHARS`), and writes a `turn.input-steered` with turn and input for each, all in one
command. Only then do the texts go into the model context as user messages, prepared as at turn
start: the same header line for delivered events, the host's context for this input
(`SteeredInput.orientation`), attachments as media, text, or a stored file; the actor roster and
preloaded skills come only with the input that starts the turn. The
decision checks that the turn is running, its actor has the agent driver, and no older waiting
input is skipped; the journal check requires the same when loading, except for the driver. An input
taken over this way is claimed by this turn (`lifecycle` `claimed` with `steered: true`) and starts
none of its own; whoever maps inputs to their turn therefore reads `turn.started` and
`turn.input-steered`. After the abort signal, outside the running turn, and during a run stop,
`claimSteering` takes over nothing. If the preparation fails, for example because the model does
not accept an attached image, the loop ends with this error, the turn fails because of it, and the
input stays assigned to it. An input that arrives after the last query stays waiting and starts a
new turn after the turn ends. There is no follow-up queue, no background delivery into running
tools, and no wake-state model: a tool call runs until its result or cancellation, and steering
waits for that.

A run function can end the turn with its result: `RunFunction.endsTurn(output)` decides per
output, `TurnToolset.invoke` reports it as `ToolInvocation.endsTurn`, and `AgentTurn` passes it to
the agent loop as `terminate` of the tool result. The loop ends the turn only if every finalized
call of the model step sets it, so a call next to another tool keeps the turn going; an error
result never sets it, also when an `afterToolCall` hook turns a result into an error, while a
hook's other replacements keep it. The turn then ends like after a final answer: the step stays
in the journal with stop reason `toolUse`, followed by the tool results, and `turn.finished` is
`completed`. Steering is still queried once more, so an input waiting at that point joins and
gets its model request in the same turn; a later one starts the next turn, whose input follows
the tool results in the model context. Only a native tool call ends a turn this way; a function
called from `typescript_eval` does not.

Streaming stays transient: text, thinking, and tool deltas go without delay through the live bus
(`TurnRequest.publish`) to web, VS Code, and CLI; the journal gets no deltas, exactly one command
per model step at its end. Whoever connects in the middle of a step gets the state so far from the
buffer of the server's chat session. A cancellation writes the text visible up to then once as
`model.output.interrupted` (section Stop procedure, cleanup, and deletion); the aborted step is not
context.

Streamed tool arguments and compaction summaries report progress through `TurnRequest.progress`
without adding visible text or journal deltas.

### Retries and compaction

Whether a turn fails at the model is decided by the model's last response: the turn survives a
provider error that the runtime then successfully retries or continues after a compaction. A final
error, a truncated response, or a response without an answer ends as `failed` with a clear reason;
a successful tool result that explicitly ends the turn remains a valid completion. Cancellation and
a hook's error, once they occur, remain the result of the turn. A retryable provider error
(overload, rate limit, server error; not the overflow and no rejected request with 4xx except 408,
409, and 429) is retried up to three times with exponential backoff starting at two seconds; the
error step stays in the journal, and the model does not see it. The time limit of a model
request is an idle timeout of ten minutes (`providerRequest.timeoutMs` in
`packages/agent/src/core/agent-settings.ts`): every received chunk, reasoning included, restarts
it, so a response that keeps streaming never expires; a request silent for the whole time ends as
a retryable `Timeout` error.

Compaction happens on the projection, with the values of the model that runs the turn
(`Model.compaction`, type `ModelCompaction` in `packages/ai/src/types.ts`, evaluated by
`compactionOf` in `packages/agent/src/core/compaction/compaction.ts`): before every model request,
including requests within a turn, and after its final response when the projected context exceeds
`threshold`, an absolute token count of this model. The estimate includes tool results and newly
presented inputs. Retained usage from before the latest compaction does not measure the new context;
until a new response reports usage, the runtime estimates the active summary and messages.
An overflow error of the same model, or a `length` stop with at most eight output tokens and input
plus cache-read tokens at least 98 percent of its window, compacts and retries that request once.
A second overflow or an unavailable or failed recovery ends the turn as `failed`, never as a silent
completion. Roughly `keepRecentTokens` of the most recent entries are kept, never starting from a
tool result; an oversized trailing tool result keeps its preceding call. If that cuts into the middle of a turn, a second call
summarizes that turn's beginning separately. The summary may be `summaryTokens` long, the one of the
turn beginning five eighths of that, the ratio of the two budgets in the forked runtime; both are
limited by the model's output limit. An existing summary is continued, not created anew. Whether a
response lies before the last compaction is decided by its position in the journal. A retry and
the continuation after a compaction start behind all error steps and truncated overflow responses
at the end of the context, because the journal keeps every one of them unchanged. A failed proactive
compaction is in the server log; the turn continues without it. A failed overflow compaction also
reports its cause as the turn's failure. Summaries use the existing `context.compacted` event and
replay without a journal format change or migration.

A model gets its own values through an alias of the profile (`MODEL_ALIASES`,
[profiles.md](profiles.md)), on a client through the relay, which passes on the values of its
server's aliases, or through the model definition of a provider registered at runtime
(`ProviderConfigInput`). The model runtime checks them at registration (`compactionProblem`): three
positive integers, `keepRecentTokens + summaryTokens` below `threshold`,
`threshold + summaryTokens` below the context window, and `summaryTokens` at most the output
limit; otherwise the registration fails and with it the start. A model without its own values, for
example a catalog model without an alias, has the catalog default (`catalogCompaction`):
`threshold` equal to `contextWindow - 16384`, `keepRecentTokens` 20000, and `summaryTokens` 13107,
80 percent of 16384, so 8192 for the turn beginning. The catalog names as context window the
largest across all providers of a model; the default threshold is therefore often above the window
of most providers, and whoever does not want that gives the model its own values through an alias.
Which values applied is in `context.compacted` (`threshold` with `source` `model` or `catalog`).
The model of the turn is authoritative: a model change applies from the next turn, and already its
check before the first step measures the existing context against the new model's threshold.

### Hooks and skills

The runtime calls the plugins' hooks (`beforeModelCall`, `afterToolCall`, `plugins.md`) directly
(`AgentHook`, `drivers/agent-hooks.ts`). It attaches the notes of `beforeModelCall` only to the one
request; they are not context. What a hook keeps with `call.keep` is stored in the journal as
`plugin.state-replaced` with actor scope under the identifier of the contribution and comes back as
`call.kept`, also after a restart. Arbitrary TypeScript code from the working repository is not
executed.

The agent runtime lives in two packages of its own under `packages/`: `@ragents/ai` connects
OpenRouter through Vercel AI SDK Core (`ai`) and `@openrouter/ai-sdk-provider`. An adapter
translates messages, reasoning metadata, and SDK streams into the existing runtime contract. The
SDK handles HTTP, provider format, and SSE processing; per request there is exactly one model step
without tool execution by the SDK. Tool validation, tool execution, and further model steps belong
to the agent runtime. Request and response hooks work on the actual HTTP contract, cancellation and
timeout apply to the SDK call; transport retries are disabled by default. Model catalog, context
limits, cache markers, and local cost calculation are preserved. For models with Anthropic cache
(`cacheControlFormat` or `anthropic/...`), the adapter sets three cache markers as long as
`AGENT_CACHE_RETENTION` is not `none`: on the system prompt, on the last tool, and on the last
message of the request (`markCacheBoundary` in `packages/ai/src/api/ai-sdk-messages.ts`), namely on
its last part: on the last tool result or on the last part of a user message, never on the tool
message, because the provider transfers a message marker to every combined tool result. In a tool
loop, the last marker thus moves backward with every result, and every request reads the prefix of
the previous one from the cache. The hidden notes of the hooks apply to only one request
(`UserMessage.transient`); the last marker sits before them on the last persistent message, so that
a changing note does not break the prefix. More than four markers in the finished request body are
a hard error before sending, because Anthropic would otherwise reject the request with 400. The
runtime does not retry rejected requests (4xx except 408, 409, and 429). The protocol identifier
`openai-completions` still applies to model descriptions and stored model steps. `@ragents/agent`
contains the agent loop, compaction, model runtime, and tools. Both packages remain forked
third-party code; a rebase onto the upstream project has been given up. Only the host reads skills,
and the runtime reads neither settings nor credential files, nor does it search for or install
packages. Its own behavior is part of this chapter: the system prompt is that of the turn, with new
tools in the middle of the turn the renewed one, plus the skill catalog if the agent has `read`;
preloaded skills are part of the turn's input, not of the system prompt, and an empty system prompt
stays empty. Updated role rules and
short initial hints thus take effect per turn; explicitly retrieved detail chapters remain
conversation content and are not additionally taken into the system prompt. Thinking level `off`
sends OpenRouter the explicit deactivation from the model catalog, such as
`reasoning: { effort: "none" }`, or without such a mapping `reasoning: { enabled: false }`. Before
every turn, RAgents checks the chosen thinking level against the actual model of the turn. An
unavailable selection ends the turn with an error message including the valid levels before a
model request is sent; it is not replaced by another thinking level. The model catalog and tool
contracts also receive the extended levels of the model runtime. When an agent is created, the
final selection is checked against the model catalog, including a thinking level inherited from
the role after a model change. Without an explicit thinking level or role default, `medium`
applies, limited to the levels of the model; the host sets no global agent thinking level beyond
that. The tool validation message does not repeat the received arguments, names only the field
errors (for enum errors including the received value and the allowed values, each path only once),
and asks for a correction. Tool arguments that are already valid stay unchanged. The additional
JSON schema conversion also checks every partial value before converting it: union values that
already match the respective partial schema, such as `null`, numbers, and booleans, keep their
type, while invalid neighboring fields can still be converted. The check works on a copy of the
arguments and does not change the original tool call. Since 2026-09-18, unknown fields at the top
level of a closed input object are not a reason for rejection: the agent loop lets them through,
the engine removes them before execution (`TurnToolset.invoke` in
`packages/ragents/src/agents/toolset.ts`), writes the cleaned input with `ignoredFields` into
`tool.call.started`, and puts a notice line in front of the tool result for the model, such as
"Note: implementation_review_context takes no input; the fields previous, __unused are unknown and
were ignored." Nested objects stay strict; missing required fields, wrong types, and unknown fields
in nested objects are still hard errors whose message names the unknown field names. The snippet
path through `context.functions` stays unchanged: there the TypeScript compiler checks, a
superfluous field is a diagnostic, and `invokeFunction` removes nothing. The three `package.json`
files load the TS sources at runtime; the type check sees the generated `dist/*.d.ts` that
`pnpm build:agent` produces.

File editing takes one exact replacement per call in the shape of the common agent harnesses
(`file_path`, `old_string`, `new_string`, `replace_all`); for an ambiguous match the error names the
lines of all matches, and only `replace_all` changes several (`plugins.md`, Workspace, sandbox tools,
and processes). The check of the last read file state happens within the same mutation lock as the
writing, also for symbolic file aliases. A cancellation releases this lock only when a file operation already running
has finished.

Skill preloading (`ragents-skill-preload`, `drivers/skill-preload.ts`) attaches the selected skill
bodies as a second text part to the input that starts the turn, after its text and before its
media ("# Preloaded skills for this turn"). The part is journaled with the input, so later turns
keep it unchanged in their context until a compaction summarizes it, and the system prompt stays
the same. Explicit skill names are resolved deterministically. Otherwise, a short call to the same
selected agent model classifies only the task, audience, skill names, and descriptions. The task is
the rendered input text with its text attachments, without the orientation. The classifier sees
no skill bodies and may return `ABSTAIN`. Errors do not block the main turn but leave the normal
skill catalog unchanged. Inputs taken over through steering are not classified.

A skill name exists exactly once in the whole profile, also across audiences, because it determines
the folder under which the model reaches the skill. If two plugins deliver a skill of the same
name, the start aborts with both folders (`SkillContributionRegistry.assertUniqueNames`); if a
runtime still gets two, its creation and thus the turn fails with both SKILL.md paths, instead of
catalog and preloading silently taking the first. Catalog and preloading name a skill under
`Skill.location`, `@skills/<name>/SKILL.md`: the location where the model's tools reach it
read-only in every binding (`plugins.md`, section Workspace, sandbox tools, and processes), never
under the path on the server from which the host reads the body (`Skill.filePath`). Relative paths
in a skill apply within its folder.

The product role comes from exactly one policy of the active `ProductRuntime`: the actor chosen in
`primaryActorId` is `primary`, all other executable actors are `worker`. The same decision controls
the role contract and skill selection. Preloading creates no agent loop of its own. For
`tools: []`, the agent runtime loads neither host tools nor skills, hooks, or preloads.

### Security lockdown of the agent runtime

All restrictions are in the engine configuration at server start (neither model nor client can
change them): the system prompt is assembled in order from the contributions of the active plugins.
Skills come exclusively from their registered paths. The tools come from the RAgents core and the
plugin registry instead of a freely choosable list. The agent runtime reads neither settings nor
credential files; fixed roles bind the models. Capabilities limit orchestration and its
delegation. Workspace tools stay visible; roles are described in the prompt, and the technical
boundary is the sandbox per run. Bash is allowed within it.

<!-- guide:runtime -->
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
<!-- /guide:runtime -->

### Interrupting a turn

`ragents.runs.interruptTurn` (`runId`, `actorId`, optional `reason`) ends only the running turn of
this actor. The message layer checks permissions as for stopping (kind `stop`, so it is also
allowed on a run that only its owner operates) and passes the interruption on to the
`TurnScheduler` (`interruptTurn`). It aborts the turn's abort signal, which running function calls
also receive, and waits for a limited time (`interruptWaitMs`, 15 seconds) for the driver: the
agent runtime writes the visible partial response as `model.output.interrupted`, then
`turn.interrupted` follows in the name of the owner with the reason of the request. If a driver
does not meet the deadline, the turn still ends in the journal; the actor's next input starts only
once the old driver has returned. A turn that no driver of this scheduler runs is ended by the
interruption only in the journal. Without a running turn, nothing happens, not even an error. No
`actor.stopped`, no intervention in children, subscriptions, or the model context: the actor takes
the next input as a new turn in the same conversation. The core knows only turn and actor here.
What the turn took over through steering up to the interruption stays assigned to it and is not
delivered again; what arrives afterwards or is still waiting starts the next turn.

The agent loop checks the abort signal immediately before every model request, that is, after
context hooks, context rebuild, and key resolution. A cancellation during a tool call or while a
hook is still running therefore no longer reaches the model: the loop ends with an aborted
assistant message without content and without usage, instead of querying the model once more with
the tool error.

If the primary actor is stopped, the run loses its primary actor (`primaryActorId` becomes `null`)
and remembers the stopped one as `stoppedPrimaryActorId` until a primary actor is chosen. If the
owner or an actor with `run.configure` restarts it, `restartActor` writes `actor.restarted` and
`run.primary-actor-selected` in the same command; the chat is bound to it again. Any other restart
leaves it a plain actor.

### Pausing a run

`ragents.runs.pause` (`runId`, optional `reason`, default "Paused by the operator") requires the
rights of a stop (kind `stop`, as for the turn interruption). `TurnScheduler.pauseRun` first writes
`run.paused` (`reason`, `userId` of the signed-in user, missing without sign-in) in the name of the
owner and only then interrupts the running turns of all actors in parallel, each with its own
command (`<command>:interrupt:<actor>`) and the pause reason, exactly like a turn interruption:
the abort signal reaches running function calls and the model request, which the agent runtime
cancels down to the provider's HTTP request. Because the pause comes first, no turn can start
between two interruptions, also not when an interrupted sub-agent triggers a subscription of the
coordinator, and a crash during the interruptions leaves the run paused. A run that is already
paused is paused again without an error and without an event.

While `RunState.pause` is set, the scheduler starts no turn and feeds no input into a turn that
is still ending; `turn.started` is rejected in the decision (`run-paused`, 409) and in the journal
check. Every input is still written as `actor.input.enqueued`: subscription deliveries, automatic
notices to creators (the interrupted sub-agent reports "was interrupted" to its creator), wake-ups
of `ragents.watch`, ends of background commands of `bash`, run-script results, and messages. Nothing
is discarded.

The pause holds the actors: `run.paused` marks every active executable actor with `held`, and an
actor created during the pause is held too. `run.resumed` lifts the pause and releases the
primary actor. Every other actor stays held until it is addressed directly after the pause: by a
human input (`origin: "human"`) or by an input that another executable actor enqueues
(`actor_input`). Automatic inputs under the owner and subscription deliveries leave it held and
wait; `actor.restarted` releases it too. A held actor starts no turn (`actor-held`). Sub-agents
and TypeScript actors therefore do not continue by themselves after a resume; the coordinator
learns from the waiting notices what was interrupted and addresses them again.

A human input into a paused run first resumes it: the decision of `enqueueInput` writes
`run.resumed` with `trigger: "input"` and the signed-in user before the `actor.input.enqueued`, in
the same command. This applies to `ragents.chat.send`, `ragents.chat.sendToActor`, and
`ragents.runs.enqueueInput`. `ragents.runs.resume` (rights of `write`) writes `run.resumed` with
`trigger: "resume"` without an input; a run that is not paused stays as it is. Only the owner
writes `run.paused` and `run.resumed` (`run-pause-denied`, 403).

After the resume, the primary actor's next turn claims its oldest waiting input, and all further
waiting inputs join the same turn as steering before the first model request, in journal order.
The human input was enqueued last and is therefore the last message, the current instruction.
An input over the steering limit of 30,000 characters waits for the next turn, as always.

TypeScript actors and run scripts pause like agents: a running turn of their program ends as
interrupted, its claimed input is consumed, and after the resume the actor stays held like a
sub-agent unless it is the primary actor. Actor-program processes are not stopped. Functions and
app actions that a person calls from a view are no turns and keep working during the pause;
inputs they enqueue wait. Background processes of the Processes tab, background commands of `bash`
among them, keep running; they end with their own stop or with the run stop.

### Stop procedure, cleanup, and deletion

A stop is always a decision about the whole branch: `stopActor` produces `turn.interrupted` (if a
turn is running), `actor.stopped`, and the removal of their subscriptions for the actor and all its
active descendants in a single command, in the name of whoever stops (`actor_stop` in the caller's
turn, `ragents.runs.stopActor` in the name of the owner). If the check fails for one of them, the
whole branch stays untouched. Within the scheduler lock, the `RunStopper` stops all active
descendants of the owner except the primary actor with one command (`stopActors`). After the
external scheduler, agent, and plugin cleanup completes, a second command of this kind follows. It
also covers children that a turn already running at the stop still created late. The identifier of
such a command is composed of the identifier of the stop, the step, and a hash of the stopped
actors: a repeated stop with the same identifier thus also reaches actors that have appeared in the
meantime and writes nothing twice. Chat and the shared panel use the same stop operation.

If a chat or run is stopped, the already visible text of the primary actor's open model message
stays. The agent runtime collects the live deltas and writes them once as
`model.output.interrupted` before `turn.interrupted` into the journal, even if the cancellation no
longer delivers a final `message_end`. A completion from the provider that arrives later does not
duplicate the text; completed model messages are not written again. Main chat and actor history
show the text at the same place after replay and restart. This partial output is not a completed
result: it belongs neither to `Turn.outputs` nor to the subscribable events and triggers no
delivery. A turn that is already closed, for example after `actor_stop`, no longer accepts a later
text record.

Every stop contribution of a plugin receives a cooperative `AbortSignal` and 15 seconds by default.
After that time, the signal is aborted and the contribution is collected as an error; a promise or
external process that ignores the signal is not forcibly terminated. The other stop contributions
and cleanup branches continue independently. Run stop, plugin cleanup, and server shutdown collect
errors the same way: nested AggregateErrors are flattened, and identical causes are reported only
once. A single cause is thrown directly, several are combined in an AggregateError.

The cleanup contributions under `afterStopSession` receive an abort signal with a time limit. The
separate cleanup phase allows, for example, cleaning up processes created late. A deletion also
waits for cleanup contributions that are still pending. The stop response waits for the final
cleanup and also reports its errors or plugin timeouts. For the entire cleanup, an additional
response deadline of 15 seconds applies after the early stop. If, for example, a driver exceeds
this deadline, the request ends with an error; the cleanup and lock remain until actual
completion. A repeated stop waits for all current driver cleanups even after a failed cleanup
before it repeats the final plugin contributions.

A run deletion is marked durably before the first irreversible step. With this marker, the delete
request is answered (`ragents.runs.delete` returns `null`) and the run has disappeared from the
list; stopping, removing, and archiving continue as a deletion job in the background, and errors
end up in the server log. A run whose journal could not be loaded has no live session: deletion
skips scheduler and plugin stop hooks, invokes every plugin delete hook, and archives the original
journal and old chat files unchanged. Delete hooks that require the unavailable journal have
nothing to clean up; other hook errors still fail the deletion.

If deletion fails, the run reappears as locked with the deletion cause, without metadata or workspace
access. Its intent and remaining files stay for a retry. The next server start retries pending
deletions before starting the scheduler; a failed job locks only its run and does not prevent
other runs or the server from starting. Shutdown also retries pending deletions and reports their
failures in the log without failing shutdown. The delete action can retry a failed job immediately.
The finished archive itself stays the durable tombstone of its run ID. A deleted ID is not created
again even after a restart, and an archive is never overwritten.

Dispose errors must not make the associated resource drop out of management; the cleanup stays
repeatable. The run deletion itself belongs to the product host, because it additionally manages
plugin data, working directory, chat, and archive; the core provides the ordered stop and journal
boundaries for it.

<!-- guide:runtime -->
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
<!-- /guide:runtime -->

### Automatic notices and rejected calls

Without any subscription, the creator of an actor learns when its turn fails or is interrupted: the
engine puts an automatic notice into its queue as an ActorInput ("[Automatic notice] The turn of
your actor @... FAILED" or "was interrupted"). What is meant is always the actor that owns the turn
(`turnId` of the event), not the writer of the event: if the owner stops a sub-worker, its creator
learns about it. No notice goes to a creator that triggered the interruption itself, a human or
stopped creator, or one whose matching subscription already delivers the same event.

If the agent loop rejects a tool call before it runs (schema violation, unknown name, blocked), the
failed attempt is still in the journal: the turn dispatcher records every managed call with name and
input at `tool_execution_start`, removes it as soon as the tool is actually executed, and, on an
error completion without execution, writes the pair `tool.call.started` and `tool.call.failed` with
the full error text. The record applies only within a turn; in the chat, the failed attempt appears
like any other failed call. `tool.call.failed` always carries a non-empty `error`: the error's
message, otherwise the text of its cause (`cause`), otherwise "Error without a cause". A failed
call is never in the journal without a cause, even if the tool or the model delivered no text.

A tool result never repeats what the model wrote itself. The one redaction point is
`toolResultEventOf` in `packages/ragents/src/agents/actor-input.ts`: from every event payload on
the way to the model, it takes over only the fields of its result schema, that is, identifiers, no
hashes, and no input echoes (`reason`, `title`, `prompt`, `content`, `state`). A function that
delivers events names exactly the types it produces with `eventResultSchemaOf(...)` (`actor_input`:
`actor.input.enqueued`), so that its TypeScript result type also knows only these. A call that only
confirms (`event_unsubscribe`, `run_configure`, `todo_write`) returns
`null`; `event_subscribe` returns only `subscriptionId` and the resolved `sources`. Journal,
`event_query`, and the RunView for the web stay complete.

### Origin of an input

`enqueuedBy` names who queued an input, not who wrote it. Besides the messages of a human, the
automatic notices to creators, inputs from plugins (the answer to a question from `ragents.ask`,
the solution answer from `ragents.lsp-roslyn`, the wake-up of a watcher from `ragents.watch`, the
end of a background command of `bash` from `ragents.workspace`), and the start input of a run script
also run under the owner. The message of a human therefore
additionally carries `origin: "human"`, in the payload of `actor.input.enqueued` and in the
ActorInput of the projection. The field is set by the host's chat path, `ragents.chat.send` and
`ragents.chat.sendToActor`, through which `ragents.overseer.sendMessage` and the first message of
`ragents.overseer.createRun` also queue, and by `ragents.runs.enqueueInput`, which a user calls
with their access. Whoever writes through these methods with a user's access, such as the global
coordinator or a mini-app, counts as that human. Decision and journal check allow the field only
for a human acting actor (the decision otherwise rejects with `input-origin-invalid`, status 403)
and never on a subscription input. The core evaluates it for the pause: a human input resumes a
paused run and releases a held actor (section Pausing a run). Plugins read it too, for example
`ragents.ask` uses it to close the open questions of the message's addressee (`plugins.md`).

### Delivery of subscriptions

A subscription input stores exactly the reference to its immutable source event, not a second copy
of its content. The projection resolves the reference from the history already read and still
produces the complete JSON content for the RunView. Missing sources and additional source event
references are rejected. On a fork, the references are rewritten to the inherited events of the new
run; the input content is derived from them anew. DELIVERY to the actor is typed:
`packages/ragents/src/agents/delivery.ts` parses the projected event once and passes it as
`input.event` (type, sender ID and handle, sequence, EventId, timestamp, payload). `input.content`
carries the plain text of the text events (`model.output.completed`, `model.reasoning.completed`,
`runtime.output.recorded`) and otherwise the canonical JSON of the payload. An LLM actor gets the
same facts as a readable header line with event type, sender handle, and sequence, plus a compact
line of its active subscriptions. An input from `actor_input` stays unchanged: its `message` is
`input.content`, `event` is `null`.

### Actor roster in the input, workspace in the system prompt

If an LLM actor actually has access to `actor_list`, the scheduler puts the actor roster as of
turn start ("[Actors in the run, as of turn start]") at the head of the input that starts each
turn, never into the system prompt: addresses from the actor's room, display names, kind, and
lifecycle, plus the markers for the actor itself and the primary actor; in a run with rooms one
line states the rule of addresses and the actor's room. This includes participants from run setups and from other
creators; other actors' system prompts are not shown. The roster is journaled with the input, so
every earlier turn keeps the roster it started with, and a fork inherits these rosters unchanged
and starts its own turns with its own. Inputs taken over through steering bring no roster. During a
turn, `actor_list` updates the roster. Without this tool, in particular with `tools: []`, the
overview is omitted.

If an actor has workspace tools, the scheduler appends a last chapter to its system prompt for
every turn: the description of the resolved workspace, which the workspace itself provides
(`SessionWorkspace.description`, in the core just a text without reference to tools). It names what
the folder is, where it is, and on whose machine, and asks the model to look around in it before
making statements about the project; plus the server's roots with their alias, how the tools reach
them in this binding, and which variables exist only in bash on the server. This applies to every
actor, not only the coordinator, and also after a `refreshTools` in the running turn, whether the
host provides the tools as functions or the agent runtime brings them along. This chapter is the
only place that names a working directory to a model: the agent runtime appends nothing about
folders to the scheduler's system prompt, not even a `Current working directory` line. An actor
without workspace tools gets neither the chapter nor a path. Its only file access would be
`typescript_eval`, and that works through `context.functions` and relative paths; the folder in
which it runs on the server is a detail of the host and, for a run on a workstation, not even the
project's folder.

`TurnRequest.workspace` is the working directory of the tools; it can be on another machine, and
the agent runtime stays bound only to this name. It needs no folder of its own, because its model
context is in the journal.

### Artifacts, attachments, and ownership

An `artifact.published` event alone grants no access to the content. The run owner, the creator,
and an actor to which the artifact was explicitly assigned with an ActorInput may read the content.

Chat attachments are stored as binary artifacts and assigned to the ActorInput through
`artifactIds`. The run journal contains metadata and references, no Base64 file contents. The agent
driver reads the assigned bytes and passes images, videos, and native PDFs to the model runtime as
media content. UTF-8 text files extend the input text; the host stores other files through
`Workspaces.storeAttachment` under `attachments/` in the workspace, on the machine where the file
tools work (for a workstation there, not on the server); the driver writes nothing into the working
directory itself. The driver checks the required model and tool capabilities also for delivery
outside the chat API. The model context holds the media as the SHA-256 of their bytes under
`artifacts/` (`model.input.presented`) and reads them anew for every model request; the run
projection instead delivers download metadata for the chat history.

Ownership follows exclusively `createdBy` and is used only for stop permissions and recursive
stops. `createdBy` is the actor of the command that wrote `agent.spawned` or `script.created`; the
journal semantics check, when writing and loading, that it exists and holds `agent.spawn`.
`primaryActorId` is a separate explicit selection. The core derives neither routing nor visibility
from ownership; the interface uses it only for display, for example in the actor graph of the
run panel (`plugins.md`).

An executable actor optionally carries a short description `description` for overviews: at most
160 characters (`actorDescriptionMaxLength`), whitespace collapsed to one space, an empty one is an
error. `agent.spawned` and `script.created` record it in the payload, otherwise the projection sets
`null`; journals without the field therefore load unchanged. `agent_spawn` requires it as the field
`description`, a label of a few words; an actor program passes the description of its package when creating its TypeScript
actor, truncated to the limit. `actor_list` returns it next to `createdBy`, plus the size of each
actor's tool selection (`toolCount`, `null` for an open one), and the names only with
`toolNames: true`. The core never reads it; it is not a role contract and changes no permissions.
The host recognizes its run coordinator by the existing journaled creation command, also after
forks. Product and setup prompt as well as coordinator skills stay with this actor. A domain agent
chosen as primary keeps its domain prompt and its agent contributions; the primary selection still
determines chat projection and output contract.

## Pending actions

The core knows exactly one kind of pending input: the action. It holds `title`, an owner `owner`
(the identifier of the plugin that created it), the descriptive fields `description`,
`parameters`, and `input`, and a `payload` that is opaque to the core. The core checks only that
the payload is a JSON object or `null`; it never reads it. Its lifecycle is `action.proposed` and
exactly one `action.resolved` with `approved` or `dismissed` and an equally opaque `result`. If
`input` requires a value, an `approved` must carry a non-empty result.

The core thus knows no tool shape. Whether an action is a question with options, a multiple
choice, a form, or a confirmation is determined solely by its owner's payload; only the owner's web
contribution displays it (`docs/spec/plugins.md`, Web as plugin host). Every action belongs to
the plugin that creates it; the core offers no tool that proposes one. The capability name
`action.propose` remains in the vocabulary only because journals grant it to the run owner.

Open inputs are counted generically: per actor, per mini-app, and per run, the number of actions
with status `pending` counts. Labels say "waiting for input".

Journals written before this separation contain actions with `kind` and `question`. They are not
migrated: the check rejects such an event with the cause, and the affected run is isolated like any
run with an invalid event, while the server and the other runs keep running. A migration would have
forced the core to keep knowing the shape of the plugin `ragents.ask` permanently - exactly the
coupling that is removed here.

<!-- guide:runtime -->
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
<!-- /guide:runtime -->

<!-- guide:runtime -->
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
<!-- /guide:runtime -->

### Rooms in the journal and the resolution of addresses

`room.opened` (`name`, `origin`) opens a room; `origin` is the room of the actor that started the
run script, `null` for the main room. `agent.spawned` and `script.created` carry `room` for an
actor outside the main room; without the field the actor stands in the main room, so older
journals load unchanged with every actor there. The projection holds `RunState.rooms` and
`Actor.room` (`null` is the main room); the run view carries `rooms`. A room name has the grammar of
a package name (a lowercase letter, then at most 63 lowercase letters, digits, or hyphens), so that
`room.name` stays a valid package folder. It is never reused and must not equal the part before the
dot of a handle of an older journal; `freeRoomName` counts up with `-2`, `-3`, and so on.
`createScriptActor` opens a room in the same command as the room's first actor (`room: { kind:
"open", name, origin }`), so a failed start leaves no empty room behind; `{ kind: "existing", name }`
places the actor in an open room, and without `room` it joins its creator's room. `agent_spawn`
places the agent in its creator's room; no function opens a room by itself.

New handles of executable actors contain no dot (`actorHandleOf` in
`runtime/guards.ts`); the owner's handle comes from the user identifier and keeps the older grammar.
A bare handle is unique within its room and between the main room and every room, because the main
room's names are written without prefix from anywhere: an agent gets a free suffix, a TypeScript
actor is refused with `handle-exists`, naming the holder's address. Two rooms may share a handle.
The journal check enforces the same when loading (`domain/event-semantics.ts`): a room actor needs
its opened room and a handle without a dot.

Every function, method, and plugin resolves a reference with one rule (`actorByReference` in
`domain/actor-reference.ts`), seen from the caller's room: the actor ID first; a reference with a
dot means the main room actor with exactly this handle if there is one (handles of older journals),
otherwise `room.handle`, with at most one dot; a bare name means the caller's room, then the main
room. A rejection names the addresses that exist from the caller's room. `addressFrom(actor, room)`
writes an address as an actor in `room` reads it: the own room's and the main room's actors without
prefix, any other with its room. The results of `actor_list`, `agent_spawn`, and the event
subscriptions, the actor roster at the head of a turn's input, the header of a delivered event, and the
automatic notices to creators show addresses this way; the roster also states the rule and the
actor's room once the run has a room. Surfaces for people and stored texts use `addressOf`, the
address as the main room writes it, which is valid from every room.

A boundary outside the engine that only checks the form of an address, such as the chat bridge of a
mini-app or an RPC contract with an actor field, uses the engine's grammar (`actorAddressPattern`,
`isActorAddress`): after the normalization of `handleKey`, a letter or digit followed by letters,
digits, dashes, underscores, and dots, without a length limit. It thereby takes `room.handle`,
bare handles, and the dotted handles of older journals and owners alike, and leaves resolution to
the one resolver.

<!-- guide:runtime -->
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
<!-- /guide:runtime -->

### Model choice, roster check, and run configuration

The tool description, field descriptions, and orchestration prompt require the explicit choice of a
role or model for every LLM spawn and explain that the caller's model is not inherited. The fields
stay individually optional, because a role can supply the model and manual, script, or external
drivers need no host model selection. A missing selection stays a hard error; there is no
automatic choice of a default role.

Before creating a new actor, the orchestration prompt requires the roster check with `actor_list`.
Suitable existing participants receive new tasks through `actor_input`; only missing roles or
deliberately separate contexts need a new actor. This is a working instruction, not name
deduplication: `agent_spawn` still creates a new actor and assigns a free suffix if the handle is
taken. The runtime does not derive the same role from the same name.

The run itself is configured by `run_configure` under the capability `run.configure`: `title`
writes the event `run.title-changed`, `primaryActor` chooses an active agent, TypeScript actor, or external
actor as primary actor (`run.primary-actor-selected`); both together are allowed, neither is a named error;
the call confirms with `null`. The owner of the run configures by right, every other actor needs
the grant; the journal semantics check the same when loading. Owner and coordinator hold all ten
capability names from `domain/vocabulary.ts`; the coordinator holds `script.start` without passing it on. If the primary actor changes, the chat rebinds to it.
A run script (`typescript-platform.md`) uses exactly this when it starts without a coordinator.

Automatically condensed list titles, in contrast, are host metadata outside the journal. They do
not change `RunState.title`. A title chosen explicitly through `run_configure` or a setup takes
precedence in the interface. Model choice and generation are described in `profiles.md`, the
updating of the run list in `plugins.md`.

## Global coordinator

Its model selection is stored permanently in the profile-specific plugin storage. The settings API
checks model and reasoning against the configured catalog and the model runtime. A model change
must not make media already delivered unreadable; an incompatible model is rejected before saving.
The conversation is preserved; it is in the journal. After a turn is claimed, the scheduler
synchronously takes over the current model selection; the plugin policy records it with a
reference to the turn as `plugin.state-replaced`. A turn that has already started keeps its
selection. `Actor.execution` still describes the start configuration; the actual selection of the
global coordinator is in its plugin event per turn. Ordinary actors use their configured execution.

The plugin `ragents.overseer` gives every signed-in user their own permanent run with the global
coordinator; without sign-in (open, `ACCESS_TOKEN`, `anonymousUser`) there is exactly one. The
server forms its run ID from the user (`overseer-` and the first 24 hex characters of the SHA-256
of the user identifier, without sign-in `overseer-single`); web and other clients query it with
`ragents.overseer.coordinator`. The owner is the user. Only that user reaches the identifier: no
other user, not even with `runs.read.all`, and a coordinator identifier that is still free does not
belong to whoever names it first but answers everyone else with `run-not-found`. The permissions
stay those of the plugin (`ragents.overseer.read` and `.write`); the first message does not need
free runs (`runs.create`). The run uses the same chat routes, agent runtime, journal, and stop
boundaries as other runs. Only the first message creates the run; after a restart, chat and model
context are preserved. The normal run list hides all coordinators; a deletion or move is rejected
with `global-chat-protected` (status 409), an import under a coordinator identifier with
`run-transfer-exists`. Like all runs, the storage belongs to the data directory of the started
profile.

The identifier `overseer` of the former shared coordinator stays reserved but belongs to no access:
the server does not open it, nobody reaches it, and its journal stays unchanged. The same applies to
the coordinator of a user who was removed from the profile. A turn of such a coordinator fails with
`coordinator-without-access`, because its workspace would have no access with which it could act.

Every global message sent from the interface carries a compact location at the time of sending:
start view, run overview, or opened run, active area and tab, and a selected element. The browser
sends only small identifiers. The server resolves the run title, the existing short run reference,
and, if applicable, the actor name. The location serves orientation; it is neither a task nor
authorization for an action.

The visible user text stays unchanged. The resolved orientation is stored separately in the
journaled plugin state of the owner actor; the input's `sourceEventIds` bind exactly its state. The
dynamic system prompt reads this binding for the input being processed. A queue, later inputs, or a
subsequent run switch do not change the location already transmitted. If the UI information is
missing, explicitly no current location is given; an earlier snapshot is not reused.

The orientation contains neither a screenshot nor DOM, form contents, or complete run contents.
Opening a view creates no additional model work. For the snapshot, there is neither another model
turn nor context polling or an additional model execution.

Primary chat and actor histories use the same mapping of journal events to chat events for text,
reasoning, tools, runtime messages, and turn completion as well as questions and answers. Routing,
sender display, plugin state, and input selection stay separate tasks. Actor histories additionally
distinguish tool calls by turn, close reasoning blocks directly, and add error results of open tools
on cancellation. Both views name the reason for a stop once: if the same command interrupts a turn
of the actor, it is at the interruption, and the `actor.stopped` of this command does not repeat
it; a stop without a running turn names it at the `actor.stopped`. Tool arguments match the
journaled JSON in both views, also for `null`. Every incoming message carries the identifier of its
input. A `turn.input-steered` marks it at its original position as fed into the running turn; the
interface shows "Fed into the running turn" below it, in the primary chat as in the actor history
and after replay alike. Incoming messages do not close a running text or reasoning block. Further
text chunks extend the same block at its original position, even if a new input already follows.
This applies equally to delivered actor and background inputs. A change of output kind and turn
completion close the open block regardless of its position; text from different conversations or
turns is separated by the cursor.

The chat projection delivers every visible assistant text with a mandatory stable cursor. The
conversation identity is the event ID of `run.created`; the position within the conversation uses
the journal sequence of `turn.started` and an offset in the accumulated turn text. The offset
counts UTF-16 units without whitespace, so that live chunks and reloaded journal blocks yield the
same position even if a block carries whitespace at its edges. Tool and reasoning events do not
increase it. `Message.textCursor` contains the last projected text position. The executable
contract for `ChatTextCursor` and the stream events stays in the code. The cursor coverage prevents
duplicate text output after streaming without suppressing later text blocks of the same turn that
exist only in the journal.

The chat reads the event stream through the JSON-RPC client after UTF-8 decoding in the stream. The
parser handles arbitrary byte boundaries and multi-line data fields. Only completely finished events
reach the message projection; incomplete remainders end with their connection. On cancellation, the
reader is released. After an interrupted connection, a new stream with its own replay starts after
three seconds.

Every initial or newly bound replay ends explicitly with `replay-end` and the conversation identity.
Without a created journal, the identity is `null`. The browser considers the connection connected
only after this boundary; the optional activation of `useChat` allows a stream that is opened only
on use. Reset events must name the same identity, an explicit conversation reset additionally
`reason: "conversation-reset"`. A changed, previously non-empty identity also detects a reset during
a connection interruption; the first change from `null` to the created conversation is not a reset.
An ordinary replay does not clear the input draft. This information enables a stable text
projection in the browser without executing events again or using timestamps and text comparisons
as identity.

The plugin `ragents.overseer` offers an explicitly confirmed conversation reset. Meanwhile, the host
blocks new global inputs, ends the global run, and waits for its actual runtime cleanup, including
a stop cleanup already begun. Then it removes only its journal together with the model context and
working storage. The existing chat session object reports the reset to its streams; the next
message starts a fresh run under the same identifier. The reset affects only the caller's
coordinator; model selection, run references, the coordinators of other users, and all other runs
are preserved. A reset marker stored durably before the deletion (per coordinator
`reset-intents/<runId>.json` in the plugin storage) lets a reset that was begun complete at the next
start after a process abort. Until completion or a successful retry, new global inputs stay
blocked. There is no automatic context-dependent reset. A trailing scheduler scan skips a journal
removed in the meantime. If the run is created anew under the same identifier, its new work is
scheduled regularly again.

The product host binds the global chat contract delivered by the plugin: its own prompt, tool
selection, and a small working directory in the plugin storage. The global coordinator initially
uses the profile's default model, but no product prompts, product skills, hooks, or preparation of
a product working directory. Its native interface contains `typescript_api`, `typescript_eval`, and
the allowed file tools `read`, `write`, and `edit`; without sign-in, the host shell `bash` is
added. With users, it has none, because as a server process it could read the files of all users;
it then sends its JSON-RPC calls from snippets with `fetch`. Individual work actions run directly;
compound calls use the same `context.functions` API as normal runs. The two TypeScript tools are
part of the server's basic equipment and need no actor program plugin. Without sign-in, only its
workspace additionally receives read file access to the profile's journal folder; `write` and
`edit` must not write there. With users, this read root is omitted, because the folder contains the
journals of all users; the coordinator then reads journals through `ragents.overseer.readEvents`, which knows only the runs of
its user. The host shell is not an additional file system sandbox; its working instruction requires
changing runtime data exclusively through the message layer. Normal runs receive neither these
additional read roots nor the API access.

The global coordinator shares its base prompt with the separate preparation role for new skill
tasks. It runs directly on the agent loop with its own conversation in memory and exclusively the
start function for the discussed task. It takes over neither the global history nor its management
access. A go from the user, in whatever words, allows the handoff to the normal run start; contract
and lifecycle are in `plugins.md`.

The plugin provides the same management methods for external clients and the global coordinator.
They can list existing runs, read their states and journals page by page, give tasks to their
primary actor, stop them, and create new runs. Unique titles, run IDs, and short references such as
`Run 1` are resolved on the server. A separate index in the plugin storage keeps the references
even after sorting, deletion, and restart. Ambiguous titles are rejected with the valid references.
The server generates new run IDs. Archived and deleted runs are not part of this access.

New runs start with a message, an installed run script, or a local run script package through its
absolute server file path. Local packages use the same format and the same loader as installed
templates; as the owner of their template, the host names the plugin that starts the package
through `RunManagement.create` (`owner`), it knows none itself. Start option validation, workspace
preparation, check, test, and installation remain the normal start path. The global coordinator can
start prepared packages. In the existing run, the run coordinator uses TypeScript snippets for
one-off work and setup, or actor programs for persistent state, later messages, and views. Domain
tasks determine the result; the model chooses the technical implementation based on the available
API. Setup order and retry limits are in `typescript-platform.md`. The creation call waits for its
completion; successful acceptance does not yet mean that the first turn has run. A catalog
describes the installed templates and valid start options of the profile actually started.

Request validation, dispatch, OpenRPC, and the Markdown reference use the same executable contracts
of the message layer. The reference is generated from the code when the global workspace is
prepared and provided again after a conversation reset. The system prompt contains a compact, also
generated overview of these methods including their user permissions. In addition, there are names
and short descriptions of regular run building blocks from the engine descriptors and the public
tool descriptors of the plugins and hooks actually registered. This makes, for example, the
installed plugin and actor program capabilities known before the first access to the reference. The
prompt is assembled only when read, from the complete registration state; generation triggers no
tool factories and reads neither configuration values nor internal service operations. This
catalog does not extend the fixed tool selection of the global chat and grants no permissions: run
calls stay bound to actor, grants, declared script subset, and run context. The coordinator loads
exact schemas and code examples from the reference when needed. The public help describes
showcase; the prompt marks the difference to the active profile's set. Shell and snippets receive
the host origin, without sign-in the journal folder, and with access protection enabled the bearer
token as environment variables; the token value appears neither in the prompt nor in the
reference. `RAGENTS_API_BASE_URL` names the local host with the port it actually listens on, also
after a start with `--port 0`; a server only over stdio has no HTTP API and does not set the
variable. Without sign-in, `RAGENTS_JOURNAL_DIR` points to the real journals of the profile, which
the shell can search, for example with `rg`; large payload fields are in the neighboring
`payloads/` folder, `payloadRefs` names hash and byte count, and `ragents.overseer.readEvents`
resolves these references completely. `RAGENTS_API_TOKEN` stands for the access of the user the
coordinator belongs to: with users, a token per user that applies only over loopback and only for
`/rpc`, `/rpc/stream`, and `/help/` and delivers that user's current state on every call (a removed
user is not signed in); with `anonymousUser`, likewise a token for the anonymous access; with
`ACCESS_TOKEN`, that token; when open, none. The coordinator's tools thus see and operate exactly
what its user may, and runs they create belong to that user. There is no separate service identity
with further permissions. The generated reference is stored as `rpc-reference.md` and
`openrpc.json` in its own working directory; the same API is available to external clients with the
normal host access.

The tool selection belongs to the journaled actor identity. An existing global run with a tool
selection that differs from the current plugin is rejected on sending with `global-tools-changed`.
An explicit conversation reset takes over the current selection and prompt instruction with the
next conversation. Opening and resetting stay possible; an automatic journal migration does not
take place.

<!-- guide:runtime -->
## Journal and projection

The journal is the shared history of a run. Visible state is produced by replaying its events;
models, functions, and external runtimes are not called again in the process.
Recorded responses, function calls,
state changes, and interruptions therefore remain traceable after a restart. The model context of
every LLM agent is part of the journal as well; working files are stored separately.
<!-- /guide:runtime -->

### File format, write boundaries, and replay

Every run has a readable `journal.jsonl` in file format 13 and, for large contents, a neighboring
folder `payloads/`. A line contains one command with all the events that resulted from it. Format
version, run ID, command, and timestamp are stored once in the shared envelope; actor and command
ID as well as the internal event schema version are added when reading. The command holds
identifier, type, acting actor, and canonical request hash. The internal CommandRecord and the
method `ragents.runs.events` still use the complete event schema 3. The binding types and the file
encoding are in `runtime/journal.ts`, `runtime/journal-storage.ts`, and `domain/events.ts`.

A single top-level payload field of 4096 UTF-8 bytes or more in its JSON representation is stored
once under `payloads/<sha256>.json`. The event line instead holds field name, SHA-256, and byte
count in `payloadRefs`. Identical stored bytes within a run share the same file. Small fields stay
directly readable. The encoding does not confuse references with payload data; additional or doubly
assigned fields are invalid. Content files are written through a temporary file, synced, and
published atomically before the referencing journal line. Reading and reuse check hash and length;
missing or changed files are hard errors. Content files are never overwritten. An aborted write can
leave an unreferenced content file behind; there is no automatic cleanup of individual files.

The journal API, event queries, and streams deliver resolved contents. Loading still reads the
entire history including referenced contents into memory. Forks write their own content files in
the target run and stay independent of the source storage. Archiving and deletion cover the whole
run folder including `payloads/`.

Actor and plugin states are journaled completely at the first save. Further replacements use a
change event with typed set and delete operations if it is smaller than the complete state. Object
fields and array entries are changed selectively; unchanged content is not repeated. The projection
rebuilds the complete state. APIs, mini-apps, and state streams still deliver the complete state,
including historically correctly reconstructed states.

The event sequence counts per run without gaps from 1. Related events of a command follow each
other and carry the same command ID and the same timestamp. The sequence determines the order;
correlation and causation information connects operations and triggers, where a trigger can also
be a turn. The journal checks a decision against the previous state before writing and syncs the
file before it takes over the new state and notifies listeners.

A completely written line is the commit boundary of a command decision. Command ID and canonical
request hash make repetitions of the same mutation idempotent. A differing request with the same ID
fails hard. Listener errors do not change the outcome of a command that has already been accepted.
If opening, writing, syncing, or closing an existing journal file fails, the instance blocks further
mutations of this run until it is reopened. This way a retry cannot duplicate a line that may
already have been written. The restart reads complete lines and discards an incomplete last write.
Other runs stay writable. Errors when preparing a content file before the journal append, in
contrast, allow an immediate retry.

The journal writes file format 13 and reads formats 7 to 13, all with internal event schema 3. Format
7 brings the model context (`model.input.presented`, `model.step.completed`,
`model.tool-result.presented`, `context.compacted`); older journals carry none and are rejected with
this cause, without migration, for the affected run. Format 8 brings `origin` on
`actor.input.enqueued` (section Origin of an input), format 9 `threshold` on `context.compacted`
(section Retries and compaction), format 10 the event `run.sharing-changed` (`profiles.md`, Sharing
in detail), format 11 the events `run.paused` and `run.resumed` (section Pausing a run), format 12
the event `room.opened` and `room` on `agent.spawned` and `script.created` (section Rooms), format
13 the external execution kind and standalone output observations (section External runtimes). A
line of an older format never carries the respective addition and therefore stays readable; a
format after 13 is rejected. The encoding has been unchanged since
4; the number increases as soon as an older version would reject newly written lines, so that it
fails at the first such line with the format version instead of at a semantic contradiction. Every
run is first completely checked and projected before its events, identifiers, and states are taken
over into the shared runtime. An old format, corrupted JSON, an invalid event, a semantic
contradiction, an unreadable journal, or a missing content file isolates only this run. The other
runs and the server keep starting. The error contains run ID, file path, and cause and is logged.
`loadFailures` and `failureOf` deliver the diagnosis; reading and writing run accesses report
`journal-unavailable` (status 409). Isolated runs appear in `ragents.runs.list` as locked, with the
cause under `locked`, without title generation, plugin metadata, and workspace
(`workspaceAccessible: false`); web and VS Code do not open them but offer deletion. A journal that
could not be loaded names no owner; the permission check treats the run like one without an owner,
so it is visible and deletable with `runs.read.all` or without sign-in. Deletion requires no live
session for an unloaded journal, archives its files unchanged, and releases the lock. A failed
deletion instead shows its cause in `locked` and keeps its intent for retry without blocking server
start or shutdown. The host also checks persisted plugin contracts before replay; removed host layouts, view
placements, layout-function references, and questions of `ragents.ask` in the removed single-question shape (an action with a
`question` text instead of a `questions` list, open or answered) isolate only the affected run without rewriting files. The same checks refuse such
records when they are appended or adopted.
Isolated runs receive no working directories or scheduler
execution and cannot accidentally be created anew under the same ID. `Journal.unavailableRuns`
names all locked runs, including those after a write error. This also applies to the global
coordinator. Its explicit conversation reset can release the locked ID after removing the old files.

The host also isolates workspace resolution failures per run, at startup or on first use. These locks retain
the loaded journal and its ownership, report the workspace cause through the same run-list
presentation, and leave the original files in place. A generic scheduler availability guard
prevents turns and tool validation for these runs, including when a lock takes effect during
asynchronous turn preparation. Other runs continue normally. Repair and restart retry workspace
resolution; a workstation's ordinary disconnected state is not a workspace failure.
Caller cancellation during preparation also creates no workspace lock: the shared preparation
stops only when no callers remain, clears its pending cache after cleanup, and can be retried
without a host restart. An input already accepted by the run keeps its own execution lifetime.

The original files of a rejected run stay byte-identical. A torn last line is repaired only after
all complete v4 records have been checked successfully. An empty or unrecognizable journal is not
reinterpreted as a new run. Errors in the shared storage or an active foreign writer stay real
infrastructure errors. On restart, open turns are completed as interrupted but never executed
again. A journal write error that occurs in the process also isolates only this run and is
reported. Events already journaled are not delivered again through subscriptions. Unclaimed inputs
stay normal open work in their original order.

An exclusive writer lock (`.writer.lock/owner-<token>.json` with process ID, host name, start, and
heartbeat) protects the whole journal folder; the owner renews the heartbeat every five seconds.
When opening, an existing lock is taken over exactly if its process on the same host is no longer
alive or its heartbeat is older than 30 seconds; the takeover appears as a warning in the server
log. A living writer with a fresh heartbeat is rejected hard; there are never two writers. If its
own owner file disappears, the journal accepts no more writes and reports that. The server releases
the lock on SIGINT, SIGTERM, and SIGHUP through the orderly shutdown and on every `process.exit`,
so also after a crash or shutdown timeout, through an `exit` hook.

Run and actor IDs use the same portable grammar in the journal: 1 to 64 lowercase ASCII
characters, alphanumeric start and end, and additionally `_` and `-` in between. Reserved Windows
device names are excluded. This way, neither can path segments be escaped nor can two logical
identities point to the same storage on case-insensitive file systems.

Projections are reconstructed from the journal at start and then updated incrementally. Before
writing, the journal checks only the new events against an isolated copy of the current state and
the semantic context. Only after persistence does it take over this projection; a check error or
early write error does not change the previous state. The previous history is not replayed again
on append. Global identifier registries and the previous record and event lists are not copied
completely in the process. The projection copies its maps and within them only the entries read
and changeable; unchanged payload data and historical texts are shared. The semantic index is still
copied. The cost of an append is therefore not constant and grows with the stored state and set of
events. Replay reads stored events; it repeats neither model calls nor tool effects. Working files,
document contents, artifact bytes including the media of the model contexts, and certain module
sources are additionally stored outside the journal folder. The journal alone is therefore not a
complete backup and cannot roll back external changes. The projection contains only the current run
state. Chronologically ordered model, tool, and runtime outputs stay as events in the journal and
are read through `event_query` or the event API. The RunView carries `outputs` (text, sequence,
timestamp) per turn from `model.output.completed`, unabridged; the detail view of an actor thus
shows delivered inputs and its own responses as one stream in journal order; reasoning is not part
of it.

## Moving a run to another server

A run can move from one server to another and continue running there. `ragents.runs.export`
(permissions `runs.read` and `runs.inspect`) delivers a manifest and a `tar.gz` as Base64,
`ragents.runs.import` requires administrator access (`*`) on the target and accepts both.
The message layer checks this access before decoding the archive or binding a replacement folder.
`pnpm run-transfer <source-url> <target-url> <runId>` connects both sides. The archive contains
`transfer/manifest.json`, the folder `runs/<id>` with journal and payloads, including the model
contexts, the folder `sessions/<id>` with actor programs and all plugin storages of the run, among
them the file storage and the new folder per run on the server, and under `artifacts/` the contents
the run refers to: published artifacts and media of the model contexts. The import checks every
content against its hash name and stores missing ones. Half-finished journal and payload writes stay
out. The export takes symbolic links along only if they are relative and stay within the run's
storage (`runs/<id>`, `sessions/<id>`). Links under `node_modules` that lead outside, such as the
absolute ones of a package manager, are left out; the next installation in the workspace creates
them anew. Every other link pointing outside aborts the export with `run-transfer-link` (409) and
the list of these links, instead of pointing into nothing at the target. The manifest names format,
identifier, host commit, executor version, profile, title, revision, event count, a bound project
folder, and the timestamp.

The export requires an idle run: no actor in a turn, no waiting input. It copies; the source stays
unchanged and is not deleted. The archive is limited to 16 MiB, because it goes through the message
layer as Base64. Only one move runs per server at a time; a second one reports `run-transfer-busy`.

The import unpacks into a staging folder under `transfer/` in the data folder and checks before it
creates anything: manifest format, same host commit, same executor version, agreement of manifest
and journal, free identifier (no journal, no folder, no archive, no deletion intent), and the
binding. Then it moves the run storage into place, takes over the records with `Journal.adopt` - in
the process, the payloads are created anew in the target from the contents read - and brings the run
back through the same path the server start takes: resolve the workspace, open the run. The run
keeps identifier, sequences, and events; it is stopped and continues with the next message. If the
takeover fails, the moved run storage is removed again.

The import rewrites no event. Absolute paths in `tool.call.*` and in the model context stay those of
the source; they are history, because replay calls neither models nor tools again. Only the
workspace is resolved anew, namely from the target's run storage. A run bound to a project folder
of the source machine is rejected as long as the caller names no replacement folder on the target;
with a replacement folder, the import appends a new `plugin.state-replaced` with the new binding to
the journal. The binding to a workstation stays and takes effect again as soon as the workstation
registers with the target, namely as the user who owns the run (without an owner: without sign-in).
Running processes, language server sessions, and browsers do not move along; they are created anew
at the next tool call.

## Open limits

1. External tool effects and the RAgents journal do not form an atomic transaction. RAgents does
   NOT resolve this limit through automatic retries: a turn open at restart becomes `interrupted`,
   and its claimed ActorInput stays assigned to this turn. If the task is to run again, a new
   explicit ActorInput is needed. The same applies to external effects of TypeScript programs and
   the journal progress.
2. The source event and the subscription input created from it are two journal commands. A crash
   exactly between the two can lose the delivery. On restart, there is deliberately no historical
   catch-up, because it could trigger the same external effect twice.
3. There are no visibility or topology rules that restrict available actors and tools. If they
   came, they would not extend the core model with channels.
4. A moved run then exists on both servers under the same identifier. Whoever keeps operating both
   gets two journals that diverge; nobody can merge them. The model still sees the absolute paths
   of the source in its context; if it picks them up again at the target, the tool call fails at
   the workspace boundary. Both hosts must know their commit, from the package `@schlenkr/ragents`
   or from the Git checkout; a host without either can neither export nor import. A file storage
   outside the run storage (`DOCUMENTS_DIR`) does not move along and stays on the source.
5. Steering reaches a model only between two model requests. A long-running tool call delays it
   until its result; whoever wants to redirect immediately interrupts the turn. A fed-in input
   changes neither the model choice nor the system prompt of the turn; both apply, as determined at
   turn start, until its end.
6. A held actor that only reacts to subscriptions stays held after a resume until someone
   addresses it directly or restarts it; its automatic inputs wait. The answer to a question that
   a person gives in a paused run is an input under the owner without human origin: it waits like
   any other input and neither resumes the run nor releases the asker.
7. Windows flushes journal and marker file contents, but skips directory `fsync`, which its file
   API does not support. Directory entries after renames or deletions therefore have no explicit
   power-loss durability guarantee; Linux and macOS retain their directory synchronization.
8. A bare name of the main room is never shadowed in a room. In a run from before rooms whose main
   room already holds an actor with a run script's handle, an embedded start of that script is
   refused with `handle-exists`, because its setup actor would take the same bare name in its room.
