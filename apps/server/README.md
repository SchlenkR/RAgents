# @aicontainer/server

Das Node-Backend. Findet die Plugins zur Laufzeit und komponiert daraus das Profil.

- Die Plugins selbst liegen auf Repo-Wurzelebene unter `plugins/<id>/server/`; ein Profil kann
  zusätzlich Plugins per Pfad nennen. `profile/` sucht sie und setzt sie zusammen.
- `plugin-support/` sind die Bausteine, die ein Plugin vom Host bekommt: Sandbox-Werkzeuge,
  Language Server, Prompts, Modellauswahl.
- `ragents/` verdrahtet die Engine mit dem Server: Sitzungen, Journal-Projektion,
  Host-Dienste.
- Die Konfigurationsschlüssel deklarieren die Plugins selbst; `config-definition.ts` liefert
  nur den Dateityp, die Werte stehen in `ragents.config.<profil>.ts` im Wurzelverzeichnis.

Lokal starten: `scripts/start.sh <profil>`. Tests: `PRODUCT_PROFILE=core pnpm test`.
