# @aicontainer/web

Das React-Frontend mit Plugin-Slots.

- Die Web-Anteile der Plugins liegen auf Repo-Wurzelebene unter `plugins/<id>/web/` und werden
  je Ordner per `import.meta.glob` als eigener Chunk geladen, passend zu den Plugins des Servers.
- `plugin-discovery.ts`, `PluginRegistry.tsx` und `PluginActivation.ts` sind der Host: sie
  entscheiden, was im aktuellen Profil sichtbar ist.
- Die Chat-Bausteine liegen als Eigencode in `src/chat/`, die Design-Tokens daneben in `src/`.
- `column.html` mit `src/column.tsx` ist der zweite Einstieg: die schmale Arbeitsspalte für ein
  Browserfenster oder das Webview der VS-Code-Erweiterung (`src/column/`, Host-Vertrag in
  `host-contract.ts`); das Spaltenlayout selbst liefert das Orchestrierungs-Plugin.

Gebaut wird statisch nach `dist/`, der Server liefert das aus. Nach Änderungen
`pnpm run build`, sonst sieht man den alten Stand.
