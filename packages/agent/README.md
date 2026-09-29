# @ragents/agent

Die Agentenlaufzeit: Schleife, Kompaktierung, Werkzeuge.

- `loop/` ist die Agenten-Schleife: aus einer Nachricht wird ein Zug aus Modellaufruf,
  Werkzeugaufrufen und Ergebnis. `loop/types.ts` trägt `AgentMessage`, `AgentTool`,
  `AgentEvent` und `ThinkingLevel`. Vor jedem Modellaufruf holt die Schleife ihren Kontext über
  `transformContext`; die Engine liefert dort die Projektion des Journals.
- `core/context-log.ts` ist der Modellkontext als geordnete Folge von Nachrichten und
  Kompaktierungen, `core/compaction/` verdichtet ihn mit den Werten des Modells
  (`Model.compaction`) oder dem Katalog-Standard (`compactionOf`). Beides kennt kein Journal; die
  Engine schreibt das Ergebnis selbst.
- `core/model-runtime.ts` kennt die Modelle der Anbieter, `core/skills.ts` den Skill-Katalog im
  Systemprompt.
- Werkzeuge unter `core/tools/`: read, write, edit, bash (`core/tool-definition.ts`). Der
  Arbeitsplatz-Executor ruft sie mit eigenen Operationen auf; sie liefern Text und strukturierte
  Details.

Dateien, Pakete, Einstellungen und Zugangsdaten liest dieses Paket nicht. Gegabelter Fremdcode;
Herkunft und eigene Eingriffe stehen in `docs/decisions.md`.
