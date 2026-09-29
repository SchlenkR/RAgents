# @ragents/web

The React frontend with plugin slots.

- The web is the same for every profile and knows no plugins at build time. The web halves of the
  plugins come as bundles from the server (`/plugins/<id>/web/...`); `ragents.plugins.bootstrap`
  names their addresses, `PluginActivation.ts` loads them with `import(url)`, `PluginRegistry.tsx`
  decides what is visible in the current profile.
- Before the first bundle, `host-modules.ts` puts every module of the web list of the host API into
  a registry; the bundles read React, contexts and building blocks from there. The stylesheet comes
  as `/ragents.css` from the server, compiled from `src/ui/tailwind.css` for the classes of the
  host and the bundles.
- The chat building blocks come from the quassel library; `src/chat/` only holds the connection to
  the run and `QuasselHost` with the basic building blocks from `src/ui/` as slots. The design
  tokens are in `src/ui/theme.css`, `src/ui/quassel.css` passes them on to quassel.
- `run-panel.html` with `src/run-panel.tsx` is the second entry point: the run panel for a browser
  window or the webview of the VS Code extension (`src/run-panel/`, host contract in
  `host-contract.ts`); the orchestration plugin provides the chat, stage and sheet of the run
  panel, the frame provides the rail on the right edge and the tab area below it
  (`RunPanelRail`, `RunPanelWorkspace`, state in `workspace-state.ts`).
- `panel.html` with `src/panel.tsx` is the third entry point and runs only in the webview of the
  extension: the overview of all servers and the settings page (`src/panel/`, contract in
  `contract.ts`). It needs no server; `pnpm build:panel` puts it into
  `../vscode/dist/webview`.

It is built statically into `dist/` (`pnpm build:web`, including `host-web.json` with the sources
of the build), and the server serves it. In a checkout the server does not start with a web that no
longer matches its sources; `scripts/start.sh` then rebuilds it itself.
