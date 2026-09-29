# @ragents/engine

The product-neutral engine. Everything domain-specific comes from plugins.

- `domain/` and `runtime/` are the journal model: run, actor, ActorInput, turn, event,
  subscription. Every run is a journal, the state results from replay.
- `agents/` executes agents and schedules their turns, `drivers/` connects the agent runtime,
  `script/` the TypeScript actors.
- `typescript/` is the mini-app platform: compiler, run context, schema.
- `plugin-host.ts` and `plugin-types.ts` are the contract plugins are built against.

Terms are in `docs/spec/overview.md`, the why in `docs/decisions.md`. Tests: `pnpm test` (node --test).
