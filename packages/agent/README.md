# @ragents/agent

The agent runtime: loop, compaction, tools.

- `loop/` is the agent loop: a message becomes a turn of model call, tool calls and result.
  `loop/types.ts` carries `AgentMessage`, `AgentTool`, `AgentEvent` and `ThinkingLevel`. Before
  every model call the loop fetches its context through `transformContext`; the engine supplies
  the projection of the journal there.
- `core/context-log.ts` is the model context as an ordered sequence of messages and
  compactions, `core/compaction/` compacts it with the values of the model (`Model.compaction`)
  or the catalog default (`compactionOf`). Neither knows a journal; the engine writes the result
  itself.
- `core/model-runtime.ts` knows the models of the providers, `core/skills.ts` the skill catalog in
  the system prompt.
- Tools under `core/tools/`: read, write, edit, bash (`core/tool-definition.ts`). The workspace
  executor calls them with its own operations; they return text and structured details.

This package does not read files, packages, settings or credentials. Forked third-party code;
origin and our own changes are in `docs/decisions.md`.
