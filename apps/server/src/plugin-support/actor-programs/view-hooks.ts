import type { Linter } from "eslint";
import type { VirtualTypeScriptDiagnostic } from "@ragents/engine";

const codes: Readonly<Record<string, string>> = { "react-hooks/rules-of-hooks": "RAG1004", "react-hooks/exhaustive-deps": "RAG1005" };
let loaded: Promise<{ linter: Linter; config: Linter.Config[] }> | undefined;
const hooksLinter = () => loaded ??= (async () => {
  const [{ Linter }, reactHooks, typescriptEslint] = await Promise.all([import("eslint"), import("eslint-plugin-react-hooks"), import("typescript-eslint")]);
  return {
    linter: new Linter({ configType: "flat" }),
    config: [{
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: { parser: typescriptEslint.default.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "react-hooks": reactHooks.default },
      rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" },
    }] as Linter.Config[],
  };
})();

/** The React rules of hooks and complete effect dependencies for a view's own sources, as errors in the client build. */
export const viewHookDiagnostics = async (files: readonly { readonly fileName: string; readonly text: string }[]): Promise<VirtualTypeScriptDiagnostic[]> => {
  const { linter, config } = await hooksLinter();
  return files.flatMap(({ fileName, text }) => linter.verify(text, config, { filename: fileName }).flatMap((message): VirtualTypeScriptDiagnostic[] => {
    const code = message.ruleId ? codes[message.ruleId] : undefined;
    if (!code) return [];
    return [{ code: Number(code.slice(3)), category: "error", message: `${code}: ${message.message}`, fileName,
      start: { line: message.line, column: message.column }, ...message.endLine === undefined ? {} : { end: { line: message.endLine, column: message.endColumn ?? message.column } } }];
  }));
};
