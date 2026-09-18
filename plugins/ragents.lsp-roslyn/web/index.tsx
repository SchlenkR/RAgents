import { languageServerWebPlugin } from "./language-server-plugin";

export const webPlugin = languageServerWebPlugin("ragents.lsp-roslyn", LanguageIcon);

function LanguageIcon() {
  return <span aria-hidden="true" className="font-mono text-[12px] font-bold">C#</span>;
}
