import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import fsharp from "highlight.js/lib/languages/fsharp";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("fsharp", fsharp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("graphql", graphql);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("less", less);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const EXTENSIONS: Record<string, string> = {
  ".bash": "bash",
  ".c": "c",
  ".cc": "cpp",
  ".cjs": "javascript",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".csproj": "xml",
  ".css": "css",
  ".csv": "plaintext",
  ".cts": "typescript",
  ".diff": "diff",
  ".dockerfile": "dockerfile",
  ".editorconfig": "ini",
  ".env": "bash",
  ".fs": "fsharp",
  ".fsproj": "xml",
  ".fsx": "fsharp",
  ".gitignore": "plaintext",
  ".go": "go",
  ".graphql": "graphql",
  ".h": "c",
  ".hpp": "cpp",
  ".htm": "xml",
  ".html": "xml",
  ".ini": "ini",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".jsx": "javascript",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".less": "less",
  ".lock": "plaintext",
  ".log": "plaintext",
  ".md": "markdown",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".patch": "diff",
  ".php": "php",
  ".plist": "xml",
  ".props": "xml",
  ".properties": "properties",
  ".ps1": "powershell",
  ".py": "python",
  ".razor": "xml",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "bash",
  ".sln": "ini",
  ".sql": "sql",
  ".svelte": "xml",
  ".svg": "xml",
  ".swift": "swift",
  ".targets": "xml",
  ".toml": "ini",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".txt": "plaintext",
  ".vue": "xml",
  ".xaml": "xml",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "bash",
};

const FILE_NAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
};

const AUTO_DETECT = ["typescript", "csharp", "fsharp", "json", "xml", "yaml", "bash", "markdown", "python", "css", "sql"];

const ALIASES: Record<string, string> = {
  "c#": "csharp",
  "c++": "cpp",
  cs: "csharp",
  fs: "fsharp",
  fsharp: "fsharp",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  text: "plaintext",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  yml: "yaml",
  zsh: "bash",
};

export interface HighlightedSource {
  html: string;
  language: string;
}

export interface HighlightToken {
  children?: HighlightToken[];
  className?: string;
  type: "element" | "text";
  value?: string;
}

export const resolveLanguage = (path: string, language?: string) => {
  if (language) {
    const normalized = language.toLowerCase();
    return ALIASES[normalized] ?? normalized;
  }
  const name = path.toLowerCase();
  const fileName = name.split("/").at(-1) ?? name;
  const extension = Object.keys(EXTENSIONS).find((candidate) => name.endsWith(candidate));
  return FILE_NAMES[fileName] ?? (extension ? EXTENSIONS[extension] : undefined);
};

export const highlightSource = (content: string, path: string, language?: string): HighlightedSource => {
  const resolved = resolveLanguage(path, language);
  const result = resolved && hljs.getLanguage(resolved)
    ? hljs.highlight(content, { language: resolved, ignoreIllegals: true })
    : hljs.highlightAuto(content, AUTO_DETECT);
  return { language: result.language ?? "plaintext", html: result.value };
};

export const highlightTokens = (content: string, path: string, language?: string): HighlightToken[] =>
  tokensFrom(highlightSource(content, path, language).html);

export const highlightLines = (content: string, path: string, language?: string): HighlightedLines => {
  const source = highlightSource(content, path, language);
  const tokens = tokensFrom(source.html);
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  const walk = (nodes: HighlightToken[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        (node.value ?? "").split("\n").forEach((part, index) => {
          if (index > 0) {
            lines.push(current + "</span>".repeat(open.length));
            current = open.map((className) => `<span class="${className}">`).join("");
          }
          current += escapeHtml(part);
        });
        continue;
      }
      const className = node.className ?? "";
      open.push(className);
      current += `<span class="${className}">`;
      walk(node.children ?? []);
      current += "</span>";
      open.pop();
    }
  };
  walk(tokens);
  lines.push(current);
  return { language: source.language, lines };
};

export interface HighlightedLines {
  language: string;
  lines: string[];
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };

const unescapeHtml = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);

const tokensFrom = (html: string): HighlightToken[] => {
  const root: HighlightToken = { type: "element", children: [] };
  const stack = [root];
  const parts = html.split(/(<span class="[^"]*">|<\/span>)/);
  for (const part of parts) {
    if (!part) continue;
    const parent = stack[stack.length - 1];
    const opening = /^<span class="([^"]*)">$/.exec(part);
    if (opening) {
      const element: HighlightToken = { type: "element", className: opening[1], children: [] };
      parent.children?.push(element);
      stack.push(element);
    } else if (part === "</span>") {
      if (stack.length > 1) stack.pop();
    } else {
      parent.children?.push({ type: "text", value: unescapeHtml(part) });
    }
  }
  return root.children ?? [];
};
