# External coding agents over ACP

Status: Idea

This idea is not being pursued at the moment. It records how complete coding agents such as
Codex and Claude could later run as actors in RAgents without rebuilding their runtime and
tools inside RAgents.

## Role of ACP

RAgents would act as a client of the Agent Client Protocol. An external ACP agent would be one
more possible actor runtime next to the built-in model agent, manual actors, and TypeScript
actors. ACP would take over the session, inputs, streaming output, plans, tool events,
permission questions, and cancellation. Runs, delivery, journal, working directory, surface,
and the mediation between actors would stay with RAgents.

MCP would have a separate role alongside it. ACP connects RAgents to the complete agent; MCP
could offer that agent an approved subset of the RAgents tools. An ACP adapter would therefore
neither have to invent new tool contracts nor receive unrestricted access to the RAgents host.

## Shared driver

A later implementation should introduce one generic driver `acp` and no separate Claude, Codex,
or Gemini drivers. The profile would select a fixed installed adapter with a start command and
permitted configuration. Behavior follows the capabilities negotiated when the connection is
established; vendor-specific special cases remain optional metadata.

For a first version, each ACP actor could own its own local process and exactly one ACP session.
That keeps working directory, termination, and errors separate from each other. Sharing a process
later would only make sense once several real adapters demonstrate their concurrency and session
isolation.

The possible lifecycle would be:

- When the actor is created, RAgents starts the adapter and opens a session with the run's
  private working directory.
- An ActorInput is delivered as a prompt. Text, reasoning, plan, tool calls, terminal output,
  and usage data are translated into matching RAgents events during the turn.
- Cancelling the turn also cancels the ACP prompt. Ending the actor closes the session and the
  process.
- The external session ID stays in the session store and is given neither to a model nor to the
  user to copy.
- After a RAgents restart, the session is only loaded or resumed if the adapter explicitly offers
  that capability. Otherwise the actor is blocked with a clear cause; an unnoticed empty
  replacement session is not a permitted fallback.

## Workspace and user decisions

An ACP process must respect the same private workspace and the same limits as its run. The
adapter's own file or terminal tools must not bypass the RAgents sandbox. Conceivable options are
ACP file and terminal functions provided by RAgents or an adapter process confined accordingly;
which form works would have to be checked with real adapters.

The agent's permission questions could appear as waiting, journaled questions via
`ragents.ask`. The offered answers and internal identifiers would stay bound on the server side.
Credentials would be stored neither in the profile nor in the journal; a missing sign-in,
adapter, or sandbox would be hard errors.

## Possible interface

An ACP actor could appear in the actor dialog as an agent runtime rather than a mere model
choice. The interface could show only the models, modes, and configuration fields the adapter
offers. The chat and its tile would show structured plans, running tool steps, file changes,
terminal processes, and permission questions without showing the raw protocol communication.

Prepared runs could then use different coding agents together: for example one agent for the
implementation, a second one for the review, and TypeScript actors for deterministic handoffs.
The coordinator would stay responsible for tasks and mediation; the ACP agents would keep their
own coding capabilities.

## Later evaluation

If the idea is picked up again, a small spike against the stable ACP v1 contract would make
sense. A pinned Codex adapter could first demonstrate prompt, streaming, tool events,
cancellation, and clean termination. After that, a Claude adapter would have to provide the same
basic functions without new driver code. Only this second real counterpart justifies shared
configuration and a richer interface.

Before an implementation, the following in particular remain to be decided:

- Which ACP events need their own journal and live events instead of being reduced to text.
- Whether file and terminal access always goes through RAgents or can safely stay in the adapter
  process.
- How installation, versioning, sign-in, and updates of local adapters are managed.
- Which session data is stored persistently and how repeated updates on load are not journaled
  twice.
- Which RAgents tools an ACP agent may receive through a session-scoped MCP access.

Until it is explicitly picked up again, this results in no implementation, no plugin, and no
open task.
