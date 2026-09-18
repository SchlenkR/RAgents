import { languageServerWebPlugin } from "@aicontainer/plugins/ragents.lsp-roslyn/web/language-server-plugin";

export const webPlugin = languageServerWebPlugin("ragents.lsp-typescript", LanguageIcon);

function LanguageIcon() {
  return <span aria-hidden="true" className="font-mono text-[12px] font-bold">TS</span>;
}
