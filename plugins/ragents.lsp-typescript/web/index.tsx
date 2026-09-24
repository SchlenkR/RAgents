import { languageServerWebPlugin } from "@ragents/web/language-server/language-server-plugin";

export const webPlugin = languageServerWebPlugin("ragents.lsp-typescript", LanguageIcon);

function LanguageIcon() {
  return <span aria-hidden="true" className="font-mono text-[12px] font-bold">TS</span>;
}
