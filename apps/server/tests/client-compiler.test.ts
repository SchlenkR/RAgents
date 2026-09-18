import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { createClientProject, compileClientSource } from "./client-project-fixture.ts";
import type { ClientContracts } from "../../../plugins/ragents.actor-programs/server/client-compiler.ts";
import { frameHtml } from "../../../plugins/ragents.actor-programs/server/routes.ts";

const contract: ClientContracts = {
  stateSchema: Type.Object({
    analyses: Type.Optional(Type.Integer({ minimum: 0 })),
  }, { additionalProperties: false }),
  actions: [{
    id: "analyse",
    inputSchema: Type.Object({
      text: Type.String(),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({
      summary: Type.String(),
      words: Type.Integer({ minimum: 0 }),
    }, { additionalProperties: false }),
  }],
};

const imports = `import * as React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";
`;

const reactClient = `const App = () => {
  const state = useAppState();
  const [text, setText] = React.useState("");
  const [summary, setSummary] = React.useState("Bereit");

  const analyse = async (): Promise<void> => {
    const answer = await context.capabilities.call("analyse", { text });
    setSummary(\`\${answer.summary}: \${answer.words}\`);
  };

  return (
    <>
      <p>Analysen: {state.analyses ?? 0}</p>
      <textarea onChange={(event) => setText(event.target.value)} value={text} />
      <button onClick={() => { void analyse(); }} type="button">Analysieren</button>
      <ul>
        {[summary].map((entry, index) => <li key={index}>{entry}</li>)}
      </ul>
    </>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
`;

const compile = (source: string) => compileClientSource({ ...contract, source: imports + source });

test("an empty ESM entry is a valid client bundle", async () => {
  const result = await compileClientSource({ ...contract, source: "export {};" });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.javaScript, "");
});

test("the client SDK exposes its owning actor with an immutable id and handle", async () => {
  const valid = await compile('const owner: { readonly id: string; readonly handle: string } = context.actor; console.log(owner.handle);');
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  const changed = await compile('context.actor.handle = "someone-else";');
  assert.equal(changed.valid, false);
  assert.ok(changed.diagnostics.some((diagnostic) => diagnostic.message.includes("read-only")));
});

test("MessageList ist ohne Chatrollen typisiert und hat keine Sendeaktion", async () => {
  const valid = await compile(`const messages = [{ key: "analysis", sender: "Analyse", text: "Fertig" }, { key: "review", sender: "Prüfung", text: "Gelesen", side: "end" }] as const;
const App = () => <UI.MessageList messages={messages} showTimestamps />;`);
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  const missingSender = await compile('const App = () => <UI.MessageList messages={[{ key: "a", text: "Hallo" }]} />;');
  assert.equal(missingSender.valid, false);
  const withInput = await compile('const App = () => <UI.MessageList messages={[]} onSend={() => {}} />;');
  assert.equal(withInput.valid, false);
});

const assertCompileError = async (source: string, diagnosticCode: number): Promise<void> => {
  const result = await compile(source);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === diagnosticCode),
    JSON.stringify(result.diagnostics));
  assert.equal(result.javaScript, "");
};

test("a React client emits deterministic JavaScript", async () => {
  const first = await compile(reactClient);
  const second = await compile(reactClient);

  assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
  assert.deepEqual(first.diagnostics, []);
  assert.equal(first.compilationHash, second.compilationHash);
  assert.equal(first.javaScript, second.javaScript);
  assert.ok(first.javaScript.length > 1000);
  assert.doesNotMatch(first.javaScript, /from ["'](?:react|@ragents)/);

});

test("the frame boots the normal bundled client after its first state snapshot", async () => {
  const compilation = await compile(reactClient);
  const html = frameHtml({
    html: "<!doctype html><html><head><title>Test</title></head><body><main id=\"root\"></main></body></html>",
    styles: "", clientJavaScript: compilation.javaScript, platformVersion: 2,
  }, "test-nonce");
  assert.equal(compilation.valid, true, JSON.stringify(compilation.diagnostics));
  assert.equal((html.match(/<script /g) ?? []).length, 2);
  assert.match(html, /type="module">await globalThis\.__ragentsAppContext\.ready;/);
  assert.doesNotMatch(html, /react\.production\.min\.js|window\.React|const UI =/);
});

test("normal TypeScript imports carry component types and diagnostics across source files", async () => {
  const project = await createClientProject(contract, {
    "src/client.tsx": 'import { formatCount } from "./format"; import { context } from "@ragents/client"; console.log(formatCount(context.state.read().analyses ?? 0));',
    "src/format.ts": 'export const formatCount = (count: number): string => `Count: ${count}`;',
  });
  try {
    const valid = await project.compile();
    assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${project.directory}/src/format.ts`, 'export const formatCount = (count: number): string => count;');
    const invalid = await project.compile();
    assert.equal(invalid.valid, false);
    assert.ok(invalid.diagnostics.some((item) => item.fileName === "src/format.ts" && item.code === 2322));
    assert.equal(invalid.javaScript, "");
  } finally { await project.remove(); }
});

test("a type error in a JSX property is rejected by name", async () => {
  const result = await compile(`const App = () => <button disabled="ja" type="button">Los</button>;

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
`);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 2322
    && diagnostic.fileName === "src/client.tsx"
    && /boolean/.test(diagnostic.message)), JSON.stringify(result.diagnostics));
  assert.equal(result.javaScript, "");
});

test("an unknown client action is a compile error", async () => {
  await assertCompileError(`void context.capabilities.call("summarise", {});`, 2345);
});

test("an invalid client action input is a compile error", async () => {
  await assertCompileError(`void context.capabilities.call("analyse", { text: 42 });`, 2322);
});

test("using a client action result with the wrong type is a compile error", async () => {
  await assertCompileError(`const analyse = async (): Promise<void> => {
  const result = await context.capabilities.call("analyse", { text: "ok" });
  const summary: number = result.summary;
  context.state.subscribe(() => { void summary; });
};

void analyse();`, 2322);
});
