import { isRunPanelKeyboardMessage, runPanelPageUrl, type RunPanelPageQuery } from "../../web/src/run-panel/host-contract";
import { parseZoomSetting, ZOOM_MAX, ZOOM_MIN } from "./settings";
import type { PanelState } from "../../web/src/panel/contract";

export interface FrameOptions {
  serverUrl: string;
  query: RunPanelPageQuery;
  nonce: string;
  title: string;
  zoom?: number;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);

const zoomHtml = (nonce: string, zoom: number): string => `<style nonce="${nonce}">
html{--ragents-zoom:${parseZoomSetting(zoom) / 100};height:100%;width:100%;overflow:hidden}
body{zoom:var(--ragents-zoom);height:100%;width:100%;margin:0;padding:0;overflow:hidden}
</style><script nonce="${nonce}">
window.addEventListener("message", (event) => {
  if (event.origin !== window.origin) return;
  const message = event.data;
  if (message?.type !== "ragents.zoom" || typeof message.zoom !== "number" || !Number.isFinite(message.zoom) || message.zoom < ${ZOOM_MIN} || message.zoom > ${ZOOM_MAX}) return;
  document.documentElement.style.setProperty("--ragents-zoom", String(message.zoom / 100));
});
</script>`;

/** Shown instead of the view when a setting prevents it from rendering; the view is rebuilt once the setting is fixed. */
export const errorHtml = ({ nonce, title, message }: { nonce: string; title: string; message: string }): string => `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">body{margin:0;padding:12px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-errorForeground)}</style>
</head>
<body><p>RAgents: ${escapeHtml(message)}</p></body>
</html>`;

export const serverOrigin = (serverUrl: string): string => new URL(serverUrl).origin;

/** The webview is only a shell: an iframe on run-panel.html, a script for the messages to the extension, and the clipboard access the iframe does not have. */
export const frameHtml = ({ serverUrl, query, nonce, title, zoom = 100 }: FrameOptions): string => {
  const origin = serverOrigin(serverUrl);
  const url = runPanelPageUrl(serverUrl, query);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">html,body{background:transparent}iframe{display:block;height:100%;width:100%;border:0}</style>
${zoomHtml(nonce, zoom)}
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
    if (event.data?.type !== "ragents.zoom" && frame.contentWindow) frame.contentWindow.postMessage(event.data, origin);
  });
})();
</script>
</body>
</html>`;
};

export interface PanelPageOptions {
  nonce: string;
  title: string;
  zoom?: number;
  state: PanelState;
  /** The built page from dist/webview, as webview addresses, plus the CSP source of the webview. */
  scriptUri: string;
  styleUri: string;
  cspSource: string;
}

/** Without an open run, the panel shows the web page (React, Tailwind) from the extension's files. */
export const panelHtml = ({ nonce, title, state, scriptUri, styleUri, cspSource, zoom = 100 }: PanelPageOptions): string => `<!DOCTYPE html>
<html lang="en" data-theme="${state.theme}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${styleUri}">
${zoomHtml(nonce, zoom)}
</head>
<body>
<div id="root"></div>
<script type="application/json" id="state">${JSON.stringify(state).replace(/</g, "\\u003c")}</script>
<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
