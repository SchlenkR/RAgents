import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { readClientUiComponentContracts } from "../../../apps/server/src/plugin-support/actor-programs/client-contracts.ts";
import { createControlsToolContributor, describeClientControls } from "../../../plugins/ragents.actor-programs/server/controls-tool.ts";
import { actorProgramGuide } from "../../../plugins/ragents.actor-programs/server/prompts.ts";
import { actorProgramAuthoringContracts } from "../../../apps/server/src/plugin-support/actor-programs/authoring-contracts.ts";
import { appPackageSchema, appContractSchema, serverApiDeclarations, installServerSdk } from "../../../apps/server/src/plugin-support/actor-programs/app-project.ts";
import { clientDeclarations, clientApiDeclarations } from "../../../apps/server/src/plugin-support/actor-programs/client-compiler.ts";
import { Value } from "typebox/value";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function diagnostics(files: Record<string, string>, base = root): string[] {
  const virtual = new Map(Object.entries(files).map(([name, text]) => [path.join(base, name), text]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, strict: true, skipLibCheck: false };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (name) => virtual.get(name) ?? read(name);
  host.fileExists = (name) => virtual.has(name) || !name.startsWith(base) || name.includes("node_modules/") ? virtual.has(name) || exists(name) : false;
  host.getSourceFile = (name, version) => {
    const text = host.readFile(name);
    return text === undefined ? undefined : ts.createSourceFile(name, text, version, true);
  };
  const program = ts.createProgram([...virtual.keys()], options, host);
  return [...virtual.keys()].flatMap((name) => {
    const source = program.getSourceFile(name)!;
    return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, " "));
  });
}

test("the UI catalog omits declaration bodies and rejects unknown names", () => {
  const catalog = describeClientControls();
  assert.ok(catalog.components.includes("Form"));
  assert.ok(catalog.components.includes("FlowDiagram"));
  assert.ok(catalog.components.includes("WorkflowDiagram"));
  assert.equal("files" in catalog, false);
  assert.throws(() => describeClientControls("MissingWidget"), /Unbekanntes Control/);
});

test("actor-program reference queries load the shared guide without expanding control lookups", async () => {
  const [tool] = await createControlsToolContributor().tools({} as never);
  assert.ok(tool);
  const query = (input: unknown) => tool.run({} as never, "reference", input as never);
  const guide = await query({ topic: "guide" });
  assert.deepEqual(guide, { guide: await actorProgramGuide.render({}) });
  assert.ok(Value.Check(tool.resultSchema, guide));
  const rendered = (guide as { guide: string }).guide;
  const contracts = actorProgramAuthoringContracts();
  assert.match(rendered, /actor_program_activate/);
  assert.match(rendered, /@ragents\/server/);
  assert.deepEqual(contracts.package, appPackageSchema);
  assert.deepEqual(contracts.backend, appContractSchema);
  assert.ok(rendered.length < 6_000);
  assert.ok(!rendered.includes(JSON.stringify(appContractSchema, null, 2)));
  assert.ok(!rendered.includes(contracts.client));
  assert.doesNotMatch(rendered, /mini_app_|script_actor_|script_tool_/);
  assert.doesNotMatch(rendered, /\{\{\{|showInput=/);
  assert.doesNotMatch(rendered, /dialog_open|dialog_close|"dialog"/);
  for (const input of [{}, { topic: "controls" }]) {
    const result = await query(input);
    assert.deepEqual(result, describeClientControls());
    assert.ok(Value.Check(tool.resultSchema, result));
    assert.equal("guide" in (result as object), false);
  }
  const control = await query({ component: "Markdown" });
  assert.deepEqual(control, describeClientControls("Markdown"));
  assert.ok(Value.Check(tool.resultSchema, control));
  await assert.rejects(query({ topic: "guide", component: "Markdown" }), /component ist nur bei topic: controls/);
  assert.equal(Value.Check(tool.schema, { topic: "unknown" }), false);
});

test("authoring reference and concrete compilers share their context declarations", () => {
  const state = { type: "object", properties: {}, additionalProperties: true };
  const concreteClient = clientDeclarations({ stateSchema: state, actions: [] });
  assert.equal(concreteClient.slice(concreteClient.indexOf("interface AppCapabilities")),
    clientApiDeclarations().slice(clientApiDeclarations().indexOf("interface AppCapabilities")));
  const clientTypes = actorProgramAuthoringContracts().clientTypes;
  assert.deepEqual(diagnostics(clientTypes), []);
  assert.doesNotMatch(Object.values(clientTypes).join("\n"), /function (Table|Form|Button)\b/);
});

test("installed backend SDK uses the shared public declarations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-server-contract-"));
  try {
    await installServerSdk(directory);
    assert.equal(await readFile(path.join(directory, "node_modules/@ragents/server/index.d.ts"), "utf8"), serverApiDeclarations());
    assert.match(serverApiDeclarations(), /export declare function defineActor/);
    assert.doesNotMatch(serverApiDeclarations(), /declare const context|declare const std/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("control lookup retains only the selected declaration and its type dependencies", () => {
  for (const component of ["Markdown", "Form", "Button", "MessageList", "Chat", "SvgEdge", "FlowDiagram", "WorkflowDiagram"]) {
    const files = readClientUiComponentContracts(component);
    const text = Object.values(files).join("\n");
    assert.match(text, new RegExp(`function ${component}\\b`));
    assert.doesNotMatch(text, /function (DataTable|FilePicker|Toggle)\b/);
    assert.deepEqual(diagnostics(files), [], component);
    if (component === "Markdown") {
      assert.equal(Object.keys(files).length, 1);
      assert.ok(text.length < 500);
      assert.doesNotMatch(text, /Chat|Form/);
    }
    if (component === "WorkflowDiagram") {
      assert.match(text, /interface WorkflowDefinition/);
      assert.match(text, /interface WorkflowState/);
      assert.match(text, /definition: WorkflowDefinition/);
      assert.match(text, /state: WorkflowState/);
    }
    if (component === "Button") assert.match(text, /VariantProps<typeof buttonVariants>/);
    if (component === "MessageList") {
      assert.match(text, /interface MessageListItem/);
      assert.match(text, /interface ChatAttachment/);
      assert.doesNotMatch(text, /interface ChatSnapshot/);
    }
  }
});


test("selected UI declarations follow aliased reexports and recursive types without unrelated exports", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-selected-ui-"));
  const folder = path.join(directory, "apps/web/src/actor-programs/client-ui");
  try {
    await mkdir(folder, { recursive: true });
    await Promise.all(Object.entries({
      "contracts.d.ts": 'export { Render as Widget } from "./barrel"; export { Other } from "./widget";',
      "barrel.d.ts": 'export * from "./widget";',
      "widget.d.ts": 'import type { Payload as State } from "./types"; export declare function Render(props: State): string; export declare function Other(props: { unrelated: number }): string;',
      "types.d.ts": 'export interface Payload { children?: Payload[]; value: Value; } export type Value = "ready" | "done"; export interface Unrelated { secret: string; }',
    }).map(([name, text]) => writeFile(path.join(folder, name), text)));
    const files = readClientUiComponentContracts("Widget", directory);
    const text = Object.values(files).join("\n");
    assert.match(text, /Render as Widget/);
    assert.match(text, /Payload as State/);
    assert.match(text, /children\?: Payload\[\]/);
    assert.doesNotMatch(text, /Other|Unrelated|secret/);
    assert.deepEqual(diagnostics(files, directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
