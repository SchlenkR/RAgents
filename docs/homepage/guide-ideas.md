# Core ideas

How AI, TypeScript, and interactive interfaces work together.

## AI and TypeScript work together

RAgents is a workspace where AI agents, TypeScript programs, and small interfaces work on a
task together. You can describe a task in the chat or start a prepared sample. The AI can set
up the required participants and programs itself; a sample comes with that setup already in
place.

TypeScript is the AI's primary way of working. It writes small programs that call available
functions and combine their results. A function can read a file, create an agent, or deliver a
message. The workspace provides these functions, so the model does not have to reinvent their
implementation.

## Code controls the workflow, models provide the contributions

In the word game, four models provide words one after another. The TypeScript program decides
whose turn is next, passes along the latest result, and ends the round after twelve
contributions. The models choose the words. The workflow therefore remains deterministic even
though its content only emerges while it runs.

For an open-ended task, the AI can also perform several related steps in a short TypeScript
snippet. When the snippet returns its results, the model decides what to do next. Persistent
actor programs are available for workflows that need to react to later responses. The
[TypeScript guide](guide-functions.html) explains both forms.

## Actors are the participants in a run

A run brings together a task, its participants, working files, and events. Its participants are
called actors. An LLM actor processes messages with a model; a TypeScript actor uses its
program. A coordinator is itself an LLM actor that can assign work to other participants. A
prepared sample can also operate without a coordinator.

The word game has four LLM actors for the words and one TypeScript actor for the workflow. In
the learning-afternoon sample, two LLM actors work in parallel while the program collects their
ideas. Actors retain their own state between tasks. An LLM actor's conversation history, its
programmed data, and the shared journal each serve a different purpose.

## Messages and events connect the work

A message assigns a task to an actor. The actor processes it in a turn and produces events,
such as a completed response. Other actors can subscribe to matching events. They then receive
a new message and can continue working. In the word game, every completed response invokes the
program again so it can assign the next actor.

The journal records what happens. This makes tasks, responses, and errors traceable. Restoring
the journal does not execute the recorded work again. The
[runtime guide](guide-runtime.html) explains how the pieces fit together.

## Mini-apps make the work interactive

An actor can have a small interface: a mini-app in the workspace. It displays the actor's data
and calls its functions. In the word game, this interface contains the start button, progress,
and word list. On the collection board, both an AI assistant and a person can add entries to
the same list.

Chat and interface are therefore two ways to access the same work. A mini-app can belong to an
LLM actor or a TypeScript actor. [Build mini-apps](guide-programs.html) shows how
functions, state, and interface connect.

## Plugins provide capabilities and reusable setups

A plugin can add file functions, questions, or interface components, for example. A product
profile selects the workspace's plugins and settings. A skill tells a model how to approach a
task. A run script, by contrast, provides the programs for a prepared setup.

Run scripts can provide a reusable setup and its interface while model responses remain
variable. Skills and prepared workflows appear as selectable entries when the active profile
provides them.
