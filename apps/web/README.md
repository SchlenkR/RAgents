# @ragents/web

Das React-Frontend mit Plugin-Slots.

- Das Web ist für jedes Profil dasselbe und kennt keine Plugins zur Bauzeit. Die Web-Hälften der
  Plugins kommen als Bundles vom Server (`/plugins/<id>/web/...`); `ragents.plugins.bootstrap`
  nennt ihre Adressen, `PluginActivation.ts` lädt sie mit `import(url)`, `PluginRegistry.tsx`
  entscheidet, was im aktuellen Profil sichtbar ist.
- `host-modules.ts` legt vor dem ersten Bundle jedes Modul der Web-Liste der Host-API in ein
  Register; die Bundles lesen React, Kontexte und Bausteine von dort. Das Stylesheet kommt als
  `/ragents.css` vom Server, übersetzt aus `src/ui/tailwind.css` für die Klassen des Hosts und
  der Bundles.
- Die Chat-Bausteine liegen als Eigencode in `src/chat/`, die Design-Tokens daneben in `src/`.
- `run-panel.html` mit `src/run-panel.tsx` ist der zweite Einstieg: das Run-Panel für ein
  Browserfenster oder das Webview der VS-Code-Erweiterung (`src/run-panel/`, Host-Vertrag in
  `host-contract.ts`); Chat, Bühne und Sheet des Run-Panels liefert das Orchestrierungs-Plugin,
  die Leiste am rechten Rand und den Reiterbereich darunter der Rahmen
  (`RunPanelRail`, `RunPanelWorkspace`, Zustand in `workspace-state.ts`).
- `panel.html` mit `src/panel.tsx` ist der dritte Einstieg und läuft nur im Webview der
  Erweiterung: die Übersicht über alle Server und die Einstellungsseite (`src/panel/`, Vertrag in
  `contract.ts`). Er braucht keinen Server; `pnpm build:panel` legt ihn nach
  `../vscode/dist/webview`.

Gebaut wird statisch nach `dist/` (`pnpm build:web`, samt `host-web.json` mit den Quellen des
Builds), der Server liefert das aus. In einem Checkout startet der Server nicht mit einem Web, das
nicht mehr zu seinen Quellen passt; `scripts/start.sh` baut es dann selbst neu.
