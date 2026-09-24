# @ragents/agent

Die Agentenlaufzeit: Schleife, Sitzung, Werkzeuge.

- `loop/` ist die Agenten-Schleife: aus einer Nachricht wird ein Zug aus Modellaufruf,
  Werkzeugaufrufen und Ergebnis. `loop/types.ts` trägt `AgentMessage`, `AgentTool`,
  `AgentEvent` und `ThinkingLevel`.
- `core/agent-session.ts` hält eine Sitzung zusammen: Modell, Denktiefe, Systemprompt,
  Werkzeuge, automatische Kompaktierung und Wiederholung, Steering.
  `core/session-manager.ts` schreibt ihren Verlauf als JSONL, `core/model-runtime.ts` kennt
  die Modelle der Anbieter.
- `core/extensions/` sind die drei Hooks, über die die Engine eingreift: `before_agent_start`,
  `context` vor jedem Modellaufruf und `tool_result`. Eine Erweiterung ist immer eine
  Inline-Fabrik; Dateien, Pakete, Einstellungen und Zugangsdaten liest dieses Paket nicht.
- Werkzeuge unter `core/tools/`: read, write, edit, bash. Der Arbeitsplatz-Executor ruft sie
  mit eigenen Operationen auf; sie liefern Text und strukturierte Details.

Gegabelter Fremdcode; Herkunft und eigene Eingriffe stehen in `docs/decisions.md`.
