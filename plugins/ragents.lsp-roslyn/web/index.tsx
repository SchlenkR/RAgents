import { languageServerWebPlugin } from "@ragents/web/language-server/language-server-plugin";

export const webPlugin = languageServerWebPlugin("ragents.lsp-roslyn", LanguageIcon);

function LanguageIcon() {
  return <span aria-hidden="true" className="font-mono text-sm font-bold">C#</span>;
}
