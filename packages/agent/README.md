# @aicontainer/agent

Werkzeuge und Sitzungsverwaltung der Agentenlaufzeit.

- Werkzeuge unter `core/tools/`: read, write, edit, bash. Sie liefern Text
  und strukturierte Details, kein Terminal-Rendering.
- `core/agent-session.ts` hält eine Sitzung zusammen, `core/session-manager.ts` ihre
  Persistenz, `core/model-runtime.ts` die Modellauswahl.
- `core/extensions/` ist die Erweiterungsschnittstelle. Darüber hängt die Engine ihre
  eigenen Werkzeuge ein; die Plugins sprechen nie direkt mit diesem Paket.
- `grep` und `find` verlangen `ripgrep` und `fd` im PATH; fehlt eines, ist das ein harter Fehler.

Gegabelter Fremdcode; Herkunft und eigene Eingriffe stehen in `docs/decisions.md`.
