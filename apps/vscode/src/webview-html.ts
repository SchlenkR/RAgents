import { columnPageUrl, type ColumnPageQuery } from "../../web/src/column/host-contract";

export interface FrameOptions {
  serverUrl: string;
  query: ColumnPageQuery;
  nonce: string;
  title: string;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);

export const serverOrigin = (serverUrl: string): string => new URL(serverUrl).origin;

/** Das Webview ist nur eine Hülle: ein iframe auf column.html und ein Skript, das Nachrichten zwischen iframe und Erweiterung weiterreicht. */
export const frameHtml = ({ serverUrl, query, nonce, title }: FrameOptions): string => {
  const origin = serverOrigin(serverUrl);
  const url = columnPageUrl(serverUrl, query);
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
  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow) {
      if (event.origin === origin) vscode.postMessage(event.data);
      return;
    }
    if (frame.contentWindow) frame.contentWindow.postMessage(event.data, origin);
  });
})();
</script>
</body>
</html>`;
};

export interface NoticeOptions {
  nonce: string;
  title: string;
  heading: string;
  lines: readonly string[];
}

/** Ohne erreichbaren Server zeigt das Webview statt des iframes einen Hinweis in den Farben von VS Code. */
export const noticeHtml = ({ nonce, title, heading, lines }: NoticeOptions): string => `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">html,body{height:100%;margin:0;padding:0;background:transparent;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}main{display:grid;gap:8px;max-width:420px;margin:0 auto;padding:28px 18px}h1{margin:0;font-size:1.05em}p{margin:0;color:var(--vscode-descriptionForeground);line-height:1.5;overflow-wrap:anywhere}code{font-family:var(--vscode-editor-font-family);color:var(--vscode-foreground)}</style>
</head>
<body>
<main role="status">
<h1>${escapeHtml(heading)}</h1>
${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
</main>
</body>
</html>`;
