# Work with TypeScript

Combine functions, program deterministic workflows, and involve models where needed.

## TypeScript as the AI's way of working

The model uses RAgents capabilities by writing TypeScript. The workspace provides callable
functions for tasks such as reading a file or creating an agent. The model combines them into a
program, keeping results in variables, checking conditions, and running independent steps in
parallel.

The same approach supports larger setups. In the word game, code creates the participants and
controls their handoffs while four models supply the words. A mini-app displays progress from
the same program. The AI therefore does not need to derive the workflow again from conversation
instructions after every response.

For one-off work, a snippet is enough: a short TypeScript program for one execution. Its result
returns to the model, which can then decide what to do next. When a program needs to retain state
or react to later messages, it becomes an [actor program](guide-programs.html). Both
forms use the same functions.

## One-off snippets

The standard native interface provides `typescript_api` for available functions and
`typescript_eval` for TypeScript code. Workspace plugins can also expose `read`, `write`, `edit`,
and `bash` directly when the actor is allowed to use them. Individual file and shell actions do
not need a TypeScript wrapper. They use the same implementation, working-directory resolution,
permission checks, and journal recording as function calls. Both mechanisms are part of the
server foundation, even without the optional actor-program plugin. Agent creation and other
workflow functions are called from TypeScript through `context.functions`. File functions remain
available there for compound calls. Plugins register each implementation once; snippets and
persistent actor programs use the same API.

Every equipped LLM actor automatically receives the names and short descriptions of all
functions available to it. This applies to coordinators and subagents. Changes update the
overview even during a turn. Direct native tools are marked, and their native descriptions also
include detailed usage guidance. The overview grants neither additional functions nor
permissions; plain LLMs with `tools: []` do not receive it.

### Short descriptions and details

A function registered with `defineRunFunction` has a technical `name` for calls and a readable
`label` for people. `description` briefly explains its purpose and appears in the automatic
overview. An optional `longDescription` adds detailed rules, prerequisites, and examples. Input
and result types come from schemas; descriptions do not replace those contracts. Local recursive
schema references create named TypeScript aliases, keeping nested contracts such as the tile tree
fully typed in snippets, actor programs, and the public run API. Resolution includes local
`$defs` references; external references are not loaded.

Without selected names, `typescript_api` returns the compact catalog. `query` searches names and
short descriptions. With `names`, the result includes TypeScript declarations, available long
descriptions, and guidance attached to those exact functions. Declarations include each
property's `description` as a comment. A schema shared by several functions appears once as a
named alias. JSON Schemas with validation rules such as lengths and patterns are added to a name
selection only with `schemas: true`. This input asks for the actor-list contract; it is a tool
input, not a snippet:

```json
{"names":["actor_list"]}
```

### Execute code

`typescript_eval` accepts exactly one of `code` or `path`. The source is the body of an async
function with `context`; `return` produces the result. For `path`, the executor of the machine that
holds the file reads it (`files.read`): a path relative to the run root from the machine the run is
bound to, a path under an alias such as `@actors` from the server, also for a connected workspace.
Execution always takes place on the server. Before execution, the shared compiler checks
the code against the current API contract. Native execution uses the same executor, function
resolver, and cancellation path as actor programs. A snippet requires no actor package,
activation, or separate actor. Its variables live for that execution.

Compilation uses a warm pool of up to eight long-lived worker threads; additional requests wait
for a free worker. Each worker loads TypeScript once and caches parsed library and declaration
files by name and content, up to 256 entries with oldest-first eviction. Snippet sources are
always parsed fresh, while the previous program enables structural reuse. Results, diagnostics,
hashes, and emitted code match a cold compilation. The default 60-second limit, configurable by
callers up to 180 seconds, includes queue time. A worker that times out, exits, or receives run
cancellation is terminated and replaced when next needed; its request fails with `TIMEOUT`,
`WORKER_FAILURE`, or `ABORTED`. A compiler error in submitted code does not terminate the worker.
Resource limits apply per worker.

A function with an empty or entirely optional input schema can be called without an argument;
`context.functions.status()` and `context.functions.status({})` are equivalent. An `undefined`
object property is treated like a missing key on both input and result. The compiler does not
enable `exactOptionalPropertyTypes`; the host accepts the value and omits the key from its JSON
result. `undefined` as an array element or the result itself remains an error.

This `typescript_eval` input reads the existing actors and returns the actual response to the
model:

```json
{"code":"const actors = await context.functions.actor_list({}); return actors;"}
```

In a file, the same function body can combine several independent queries. For this example,
load the `actor_list` and `model_list` contracts first:

```ts
const [actors, models] = await Promise.all([
  context.functions.actor_list({}),
  context.functions.model_list({}),
]);
return { actors, models };
```

## State, continuation, and errors

Snippets can read data, combine results, and set up participants, programs, subscriptions, or
views. Actor programs handle later events, persistent state, and mini-apps. The choice follows
the task; a setup does not need a dedicated setup actor. Domain-specific skill templates describe
the desired result rather than prescribing a technical solution. Technical contracts and guides
belong in the discoverable environment.

A snippet acts as its caller. `onInput` acts as the receiving TypeScript actor. An actor function
uses its owner's state but calls run functions under the caller's identity. Accordingly,
`event_subscribe` creates the subscription for the acting caller. For a persistent actor to
subscribe on its own behalf, it makes the call from `onInput`. Calling another actor's function
does not transfer actor identity.

Completed function calls remain effective if a later step fails. A snippet is not a transaction
across its calls. Retries inspect the existing setup and continue missing steps. A snippet does
not wait for future responses; subscriptions deliver them as later ActorInputs.
