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
- `index.html` and `src/main.tsx` are the shared entry point for browser and VS Code runs.
  The build emits `run-panel.html` as an identical alias for the iframe host contract.
  `src/run-panel/` owns host integration, the inspection rail, and run composition; the
  orchestration plugin provides chat and app navigation.
- `src/panel.tsx` is a thin VS Code message adapter around the shared `panel/PanelPage`.
  It needs no server; `pnpm build:panel` emits JavaScript and CSS into
  `../vscode/dist/webview`. The extension supplies the HTML shell.

It is built statically into `dist/` (`pnpm build:web`, including `host-web.json` with the sources
of the build), and the server serves it. In a checkout the server does not start with a web that no
longer matches its sources; `scripts/start.sh` then rebuilds it itself.
