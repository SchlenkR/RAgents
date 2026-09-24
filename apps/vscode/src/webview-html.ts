import { isRunPanelKeyboardMessage, runPanelPageUrl, type RunPanelPageQuery } from "../../web/src/run-panel/host-contract";
import type { PanelState } from "../../web/src/panel/contract";

export interface FrameOptions {
  serverUrl: string;
  query: RunPanelPageQuery;
  nonce: string;
  title: string;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);

export const serverOrigin = (serverUrl: string): string => new URL(serverUrl).origin;

/** Das Webview ist nur eine Hülle: ein iframe auf run-panel.html, ein Skript für die Nachrichten zur Erweiterung und der Zugriff auf die Zwischenablage, den das iframe nicht hat. */
export const frameHtml = ({ serverUrl, query, nonce, title }: FrameOptions): string => {
  const origin = serverOrigin(serverUrl);
  const url = runPanelPageUrl(serverUrl, query);
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">html,body{height:100%;width:100%;margin:0;padding:0;overflow:hidden;background:transparent}iframe{display:block;height:100%;width:100%;border:0}</style>
</head>
<body>
<iframe id="frame" src="${escapeHtml(url)}" allow="clipboard-read; clipboard-write" title="${escapeHtml(title)}"></iframe>
<script nonce="${nonce}">
(() => {
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById("frame");
  const origin = ${JSON.stringify(origin)};
  const isKeyboardMessage = ${isRunPanelKeyboardMessage.toString()};
  const readClipboard = (id) => {
    const field = document.createElement("textarea");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.focus();
    document.execCommand("paste");
    const text = field.value;
    field.remove();
    frame.contentWindow.postMessage({ type: "clipboardText", id, text }, origin);
  };
  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow) {
      if (event.origin !== origin) return;
      if (event.data && event.data.type === "clipboardRead") readClipboard(event.data.id);
      else if (event.data && event.data.type === "keyboardEvent") {
        if (isKeyboardMessage(event.data)) window.dispatchEvent(new KeyboardEvent(event.data.event.type, { ...event.data.event, bubbles: true, cancelable: true }));
      }
      else vscode.postMessage(event.data);
      return;
    }
    if (frame.contentWindow) frame.contentWindow.postMessage(event.data, origin);
  });
})();
</script>
</body>
</html>`;
};

export interface PanelPageOptions {
  nonce: string;
  title: string;
  state: PanelState;
  /** Die gebaute Seite aus dist/webview, als Webview-Adressen, plus die CSP-Quelle des Webviews. */
  scriptUri: string;
  styleUri: string;
  cspSource: string;
}

/** Ohne geöffneten Run zeigt das Panel die Seite des Webs (React, Tailwind) aus den Dateien der Erweiterung. */
export const panelHtml = ({ nonce, title, state, scriptUri, styleUri, cspSource }: PanelPageOptions): string => `<!DOCTYPE html>
<html lang="de" data-theme="${state.theme}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
<div id="root"></div>
<script type="application/json" id="state">${JSON.stringify(state).replace(/</g, "\\u003c")}</script>
<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
