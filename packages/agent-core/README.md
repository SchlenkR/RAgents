# @aicontainer/agent-core

Die Agenten-Schleife: aus einer Nachricht wird ein Zug aus Modellaufruf, Werkzeugaufrufen
und Ergebnis.

- `agent.ts` ist die Klasse `Agent`, `agent-loop.ts` die Schleife darunter.
- `types.ts` trägt die Typen, die sich alle Pakete teilen: `AgentMessage`, `AgentTool`,
  `AgentEvent`, `AgentState`, `ThinkingLevel`.
- `uuid.ts` liefert `uuidv7` für Sitzungskennungen.

Gegabelter Fremdcode; Herkunft und eigene Eingriffe stehen in `docs/decisions.md`.
