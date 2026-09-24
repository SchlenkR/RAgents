# @ragents/engine

Die produktneutrale Engine. Alles Fachliche kommt aus Plugins.

- `domain/` und `runtime/` sind das Journal-Modell: Run, Actor, ActorInput, Turn, Event,
  Subscription. Jeder Lauf ist ein Journal, der Zustand entsteht durch Wiedergabe.
- `agents/` führt Agenten aus und plant ihre Züge, `drivers/` bindet die Agentenlaufzeit
  an, `script/` die TypeScript-Actors.
- `typescript/` ist die Mini-App-Plattform: Compiler, Laufzeitkontext, Schema.
- `plugin-host.ts` und `plugin-types.ts` sind der Vertrag, gegen den Plugins gebaut werden.

Begriffe stehen in `docs/spec/overview.md`, das Warum in `docs/decisions.md`. Tests: `pnpm test` (node --test).
