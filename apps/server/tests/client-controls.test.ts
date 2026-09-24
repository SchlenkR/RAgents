import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { compileClientSource } from "./client-project-fixture.ts";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { buildTailwind } from "../../../apps/server/src/plugin-support/actor-programs/tailwind.ts";
import { browserRuntimeStyles } from "../../../apps/server/src/plugin-support/actor-programs/client-runtime.ts";
import { controlsTemplate } from "../../../plugins/ragents.actor-programs/server/controls-template.ts";
import { templateFiles } from "../../../plugins/ragents.actor-programs/server/templates.ts";

const imports = 'import * as React from "react"; import { createRoot } from "react-dom/client"; import { context } from "@ragents/client"; import * as UI from "@ragents/client/ui";\n';
const compile = (source: string) => compileClientSource({ source: imports + source, stateSchema: { type: "object", additionalProperties: false }, actions: [] });

test("mini-app controls typecheck bound, controlled and read-only chats with shared messages and select props", async () => {
  const result = await compile(`
    const messages: Parameters<typeof UI.ChatMessages>[0]["messages"] = [
      { key: "hello", role: "assistant", sender: "reviewer", text: "Hallo", at: "2026-09-06T12:00:00Z" },
    ];
    const App = () => <>
      <UI.Chat actor="primary" title="Gespräch" showInput rows={2} maxRows={5} showTimestamps detailMode="chips" />
      <UI.Chat actor="@reviewer" owner={null} showInput={false} />
      <UI.Chat actor="@reviewer" owner="reviewer" />
      <UI.Chat messages={messages} owner="reviewer" running onSend={async (text, attachments) => { await context.chat.send("primary", text, attachments); }} />
      <UI.Chat messages={[]} />
      <UI.ChatMessages messages={messages} owner="reviewer" showTimestamps detailMode="off" />
      <UI.ChatMessages messages={messages} owner={null} />
      <UI.MessageList messages={[{key:"one",sender:"reviewer",text:"Hallo"}]} owner="reviewer" />
      <UI.MessageList messages={[]} owner={null} />
      <UI.ChatInput placeholder="Deine Nachricht" attachmentCapabilities={{model:"Vision",input:["text","image"]}} onSend={async (text, attachments) => { await context.chat.send("primary", text, attachments); }} />
      <UI.Markdown text="**Hallo**" />
      <UI.Select items={[{value:"primary",label:"Koordinator"}]} value="primary" onValueChange={(value) => { void value; }}>
        <UI.SelectTrigger aria-label="Actor"><UI.SelectValue /></UI.SelectTrigger>
        <UI.SelectContent><UI.SelectItem value="primary">Koordinator</UI.SelectItem></UI.SelectContent>
      </UI.Select>
      <UI.Select multiple value={[]} onValueChange={(value) => { void value; }}>
        <UI.SelectTrigger aria-label="Actors"><UI.SelectValue placeholder="Auswählen" /></UI.SelectTrigger>
        <UI.SelectContent />
      </UI.Select>
      <UI.Button size="sm" variant="outline">Klein</UI.Button>
      <UI.Tabs defaultValue="a"><UI.TabsList><UI.TabsTrigger value="a">A</UI.TabsTrigger></UI.TabsList><UI.TabsContent value="a">Inhalt</UI.TabsContent></UI.Tabs>
    </>;
    const unsubscribe = context.chat.subscribe("primary", () => {
      const snapshot = context.chat.read("primary");
      if (snapshot) { const owner: string | undefined = snapshot.owner; const messages = snapshot.messages; void messages; void owner; }
    });
    unsubscribe();
    void App;
  `);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
});

test("mini-app layouts compile through the installed SDK with typed content and form fields", async () => {
  const result = await compile(`
    const App = () => <UI.AppLayout title="Interview" description="Eine Frage" fill actions={<UI.Button>Schließen</UI.Button>}>
      <UI.Grid columns={2} gap="large">
        <UI.Stack gap="small"><h2>Frage</h2><p>Was brauchst du?</p></UI.Stack>
        <UI.Form fields={[{id:"answer",label:"Deine Antwort",type:"textarea",required:true}]}
          values={{answer:""}} onChange={() => {}} onSubmit={async () => {}} />
      </UI.Grid>
      <UI.Stack direction="row"><UI.Button>Zurück</UI.Button><UI.Button>Weiter</UI.Button></UI.Stack>
    </UI.AppLayout>;
    void App;
  `);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
});

test("SvgEdge compiles through the installed SDK with native SVG and rejects unsupported options", async () => {
  const valid = await compile(`const diagram = <svg viewBox="0 0 360 160" role="img" aria-label="Ablauf">
    <UI.SvgEdge d="M20 20 L100 20" />
    <UI.SvgEdge d="M20 40 L100 40" arrow="none" lineStyle="dashed" tone="neutral" />
    <UI.SvgEdge d="M20 60 L100 60" arrow="both" tone="accent" />
    <UI.SvgEdge d="M20 80 L100 80" arrow="end" lineStyle="solid" tone="warning" active />
    <UI.SvgEdge d="M20 100 L100 100" tone="success" />
    <UI.SvgEdge d="M20 120 L100 120" tone="danger" />
  </svg>; void diagram;`);
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  for (const source of ['<UI.SvgEdge />;', '<UI.SvgEdge d="M0 0" arrow="start" />;',
    '<UI.SvgEdge d="M0 0" tone="#00ff00" />;', '<UI.SvgEdge d="M0 0" active="yes" />;',
    '<UI.SvgEdge d="M0 0" lineStyle="dotted" />;']) {
    const result = await compile(source);
    assert.equal(result.valid, false, source);
    assert.equal(result.javaScript, "", source);
  }
  assert.match(browserRuntimeStyles, /\.react-flow__edge-path/);
});

test("FlowDiagram compiles typed graph updates and rejects unsupported graph props", async () => {
  const valid = await compile(`const App = () => {
    const [done, setDone] = React.useState(false);
    const nodes: Parameters<typeof UI.FlowDiagram>[0]["nodes"] = [
      { id: "input", label: "Eingang", status: "done", kind: "service" },
      { id: "check", label: "Prüfung", detail: done ? "Fertig" : "Läuft", status: done ? "done" : "active", kind: "agent", items: [{label:"Regel prüfen",status:done?"done":"active"},{label:"Optionaler Schritt",status:"skipped",detail:"Nicht erforderlich"}] },
      { id: "result", label: "Ergebnis", status: done ? "done" : "blocked", kind: "actor" },
    ];
    return <><UI.FlowDiagram label="Prüfablauf" nodes={nodes}
      edges={[{ id: "first", source: "input", target: "check", label: "Prüfen" }, { source: "check", target: "result" }, {source:"result",target:"input",kind:"return",label:"Nach Korrektur"}]}
      direction="down" viewport="fit-width" className="example" />
      <UI.FlowDiagram label="Wartend" nodes={[{id:"pending",label:"Wartend",status:"pending"}]} edges={[]} direction="right" />
      <UI.Button onClick={() => setDone(true)}>Abschließen</UI.Button></>;
  }; void App;`);
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  for (const source of [
    '<UI.FlowDiagram nodes={[]} edges={[]} />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[]} edges={[]} source="input --> output" />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[{id:"input",label:"Eingang",status:"running"}]} edges={[]} />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[{id:"input",label:"Eingang",kind:"worker"}]} edges={[]} />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[{id:"input",label:"Eingang",x:10,y:20}]} edges={[]} />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[]} edges={[{source:"input"}]} />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[]} edges={[]} direction="left" />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[]} edges={[]} viewport="scroll" />;',
    '<UI.FlowDiagram label="Ablauf" nodes={[{id:"input",label:"Eingang",items:[{label:"Regel",status:"success"}]}]} edges={[]} />;',
  ]) {
    const result = await compile(source);
    assert.equal(result.valid, false, source);
    assert.equal(result.javaScript, "", source);
  }
});

test("WorkflowDiagram shares typed definitions and live state with the workflow SDK", async () => {
  const definition = `import { defineWorkflow, workflowGraph, type WorkflowState } from "@ragents/workflow";
    const definition = defineWorkflow({id:"example",title:"Beispiel",roles:{helper:{title:"Helfer"}},steps:[
      {id:"idea",title:"Idee",role:"helper",goal:"Eine Idee liefern",completion:{source:"agent",description:"Antwort liegt vor"},freedom:{mode:"fixed",description:"Eine Idee"}}
    ],transitions:[]});`;
  const valid = await compile(definition + `
    const App = () => {
      const [state, setState] = React.useState<WorkflowState>({steps:{idea:{status:"active"}}});
      const graph = workflowGraph(definition,state);
      return <><UI.WorkflowDiagram definition={definition} state={state} label="Ideenablauf" direction="down" viewport="fit-width" />
        <UI.Button onClick={()=>setState({steps:{idea:{status:"done",detail:"Idee liegt vor"}}})}>Fertig</UI.Button></>;
    }; void App;`);
  assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
  for (const source of [
    '<UI.WorkflowDiagram definition={definition} state={{steps:{idea:{status:"running"}}}} label="Ideen" />;',
    '<UI.WorkflowDiagram definition={{id:"incomplete"}} state={{steps:{}}} label="Ideen" />;',
    '<UI.WorkflowDiagram definition={definition} state={{steps:{}}} />;',
    '<UI.WorkflowDiagram definition={definition} state={{steps:{}}} label="Ideen" nodes={[]} />;',
    '<UI.WorkflowDiagram definition={definition} state={{steps:{}}} label="Ideen" viewport="scroll" />;',
  ]) {
    const result = await compile(definition + source);
    assert.equal(result.valid, false, source);
    assert.equal(result.javaScript, "", source);
  }
});

test("mini-app controls reject mixed bindings and invalid control props", async () => {
  for (const source of [
    `<UI.AppLayout title="Missing content" />;`,
    `<UI.AppLayout fill="yes">Text</UI.AppLayout>;`,
    `<UI.Stack direction="diagonal">Text</UI.Stack>;`,
    `<UI.Grid columns={0}>Text</UI.Grid>;`,
    `<UI.Grid gap="huge">Text</UI.Grid>;`,
    `<UI.Chat actor="primary" messages={[]} />;`,
    `<UI.Chat actor="primary" onSend={() => {}} />;`,
    `<UI.Chat />;`,
    `<UI.Chat messages={[{key:"one",role:"bogus",text:"Text"}]} />;`,
    `<UI.Chat messages={[]} onSend={(text:number) => {}} />;`,
    `<UI.Chat actor="primary" detailMode="invalid" />;`,
    `<UI.Chat actor="primary" owner={true} />;`,
    `<UI.Chat messages={[]} owner={1} />;`,
    `<UI.ChatMessages messages={[]} owner={[]} />;`,
    `<UI.ChatMessages messages={[{key:"one",role:"assistant",text:"Text",sender:123}]} />;`,
    `<UI.MessageList messages={[]} owner={false} />;`,
    `<UI.ChatInput />;`,
    `<UI.Button variant="primary">Alt</UI.Button>;`,
    `<UI.Button size="small">Alt</UI.Button>;`,
  ]) {
    const result = await compile(source);
    assert.equal(result.valid, false, source);
    assert.equal(result.javaScript, "", source);
    assert.ok(result.diagnostics.some((item) => item.category === "error"), source);
  }
});

test("all six new controls compile with typed rows, controlled values, native files and asynchronous callbacks", async () => {
  const result = await compile(`
    type Row = { id: string; count: number; name: string };
    const App = () => {
      const [values, setValues] = React.useState<Parameters<typeof UI.Form>[0]["values"]>({name:"Demo",count:2});
      const [files, setFiles] = React.useState<File[]>([]);
      const [selected, setSelected] = React.useState<string[]>([]);
      return <>
        <UI.Form values={values} onChange={setValues} onSubmit={async (next) => { const count = next.count; void count; }}
          validate={(next) => next.name ? {} : {name:"Name fehlt"}} fields={[
            {id:"name",label:"Name",type:"text",required:true},
            {id:"note",label:"Notiz",type:"textarea",rows:3},
            {id:"count",label:"Anzahl",type:"number",min:1,max:5,step:1},
            {id:"approved",label:"Freigabe",type:"checkbox"},
            {id:"mode",label:"Modus",type:"select",options:[{value:"read",label:"Lesen"}]},
          ]} />
        <UI.DataTable<Row> rows={[{id:"one",count:3,name:"Demo"}]} rowKey={(row) => row.id} filterable
          selectedKeys={selected} onSelectionChange={setSelected}
          columns={[{id:"count",label:"Anzahl",value:(row) => row.count,render:(row) => <strong>{row.count}</strong>,sortable:true}]}
          actions={[{id:"select",label:"Auswählen",onClick:async (row) => { setSelected([row.id]); },disabled:(row) => row.count === 0}]} />
        <UI.FilePicker label="Dateien" files={files} onChange={setFiles} multiple accept=".txt,image/*" maxFiles={3} maxBytes={4096} showPreview />
        <UI.TaskProgress title="Aufgaben" tasks={[{id:"one",label:"Lesen",status:"running",description:"Beispiel"}]} />
        <UI.DocumentViewer title="Dokument" format="code" filename="sample.ts" language="typescript" content="const count = 1;" />
        <UI.DiffViewer title="Änderungen" patch="" emptyText="Unverändert" />
      </>;
    };
    void App;
  `);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
});

test("new control contracts reject mismatched field, table, file and viewer props", async () => {
  for (const source of [
    `<UI.Form fields={[{id:"name",label:"Name",type:"select"}]} values={{}} onChange={() => {}} />;`,
    `<UI.Form fields={[{id:"name",label:"Name",type:"text",min:2}]} values={{}} onChange={() => {}} />;`,
    `<UI.Form fields={[]} values={{name:[]}} onChange={() => {}} />;`,
    `<UI.DataTable<{id:string}> rows={[{id:"one"}]} rowKey={(row) => row.id} columns={[{id:"bad",label:"Bad",value:(row) => row.missing}]} />;`,
    `<UI.DataTable rows={[{id:"one"}]} rowKey={(row) => row.id} columns={[{id:"bad",label:"Bad",value:(row) => row}]} />;`,
    `<UI.DataTable rows={[{id:"one"}]} rowKey={(row) => row.id} columns={[]} selectedKeys={[]} />;`,
    `<UI.FilePicker label="Datei" files={["file.txt"]} onChange={() => {}} />;`,
    `<UI.FilePicker label="Datei" files={[]} onChange={(files:string[]) => {}} />;`,
    `<UI.TaskProgress tasks={[{id:"one",label:"Demo",status:"finished"}]} />;`,
    `<UI.DocumentViewer format="html" content="<b>Demo</b>" />;`,
    `<UI.DiffViewer before="a" after="b" />;`,
  ]) {
    const result = await compile(source);
    assert.equal(result.valid, false, source);
    assert.equal(result.javaScript, "", source);
    assert.ok(result.diagnostics.some((item) => item.category === "error"), source);
  }
});

test("the controls template compiles its controls and SVG example in one local actor view", async () => {
  const manifest = JSON.parse(templateFiles(controlsTemplate, "controls")["package.json"]);
  const source = controlsTemplate.files["src/client.tsx"];
  assert.equal(manifest.type, "module");
  assert.equal(manifest.private, true);
  const result = await compileClientSource({ source, stateSchema: { type: "object", additionalProperties: false }, actions: [] });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(manifest.ragents.backend, undefined);
  assert.deepEqual(manifest.ragents.views, [{ id: "main", client: "src/client.tsx" }]);
  assert.equal(Object.keys(controlsTemplate.files).some((file) => file.endsWith(".css")), false);
  for (const control of ["Form", "DataTable", "FilePicker", "TaskProgress", "DocumentViewer", "DiffViewer", "SvgEdge", "FlowDiagram"]) {
    assert.ok(source.includes(`<UI.${control}`), control);
  }
  assert.doesNotMatch(source, /context\.(chat|capabilities)|useAppState|fetch\(/);
});

test("normal control modules render with the shared React and preserve native chat styling", async () => {
  const webRequire = createRequire(new URL("../../web/package.json", import.meta.url));
  const bridge = { state: { read: () => ({}), subscribe: () => () => {} },
    chat: { read: () => ({ owner: "reviewer", running: false, messages: [
      { key: "human", role: "user", sender: "human", text: "Frage" },
      { key: "reply", role: "assistant", sender: "reviewer", text: "Antwort", bubble: { label: "Prüfung", color: "#123456", side: "end" } },
    ] }), subscribe: () => () => {}, send: async () => {} },
  };
  const bundle = buildSync({
    stdin: { contents: `import * as UI from ${JSON.stringify(fileURLToPath(new URL("../../../apps/web/src/actor-programs/client-ui/index.tsx", import.meta.url)))}; export { UI };`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", target: "es2022", jsx: "automatic",
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } }, external: ["react", "react-dom"],
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles[0].text;
  const module = { exports: {} };
  const scope = vm.createContext({ require: webRequire, module, exports: module.exports, __ragentsAppContext: bridge, console });
  vm.runInContext(bundle, scope);
  const { UI } = module.exports as { UI: Record<string, unknown> };
  const React = webRequire("react");
  const ReactDOMServer = webRequire("react-dom/server");
  const renderControl = (name: string, props: string) => ReactDOMServer.renderToString(
    React.createElement(UI[name], vm.runInNewContext(`(${props})`))) as string;
  const render = (props: string) => renderControl("Chat", props);
  const readonly = render(`{ messages: [{ key: "one", role: "assistant", text: "**Antwort**" }] }`);
  assert.match(readonly, /<strong[^>]*>Antwort<\/strong>/);
  assert.doesNotMatch(readonly, /textarea|<h2/);
  const composed = render(`{ messages: [], title: "Helfer", placeholder: "Frage stellen", rows: 2, onSend: () => {} }`);
  assert.match(composed, /<h2[^>]*>Helfer<\/h2>/);
  assert.match(composed, /placeholder="Frage stellen"/);
  assert.match(composed, /rows="2"/);
  assert.doesNotMatch(render(`{ messages: [], onSend: () => {}, showInput: false }`), /textarea/);
  const bound = render(`{ actor: "@reviewer", showInput: false }`);
  assert.match(bound, /data-message="user"/);
  assert.match(bound, /data-message="answer"/);
  assert.doesNotMatch(bound, /background:#123456/);
  assert.match(render(`{ actor: "@reviewer", owner: null, showInput: false }`), /background:#123456/);
  const customOwner = render(`{ actor: "@reviewer", owner: "human", showInput: false }`);
  assert.doesNotMatch(customOwner, /data-message="user"/);
  assert.match(customOwner, /background:#123456/);
  const controlledOwner = render(`{ owner: "reviewer", messages: [{ key: "reply", role: "assistant", sender: "reviewer", text: "Antwort", bubble: { color: "#123456", side: "end" } }] }`);
  assert.match(controlledOwner, /data-message="answer"/);
  assert.doesNotMatch(controlledOwner, /background:#123456/);
  const waiting = render(`{ messages: [{ key: "action", role: "action", text: "Welche Farbe?",
    action: { actionId: "action-1", owner: "ragents.ask", payload: { options: ["Blau", "Rot"] } } }] }`);
  assert.match(waiting, /Welche Farbe\?/);
  assert.match(waiting, /data-action="waiting"/);
  assert.match(waiting, /wartet auf Eingabe/);
  assert.doesNotMatch(waiting, /<input|<button|<textarea/);
  const dismissable = renderControl("ChatMessages", `{
    messages: [{ key: "action", role: "action", text: "Welche Farbe?",
      action: { actionId: "action-1", owner: "ragents.ask", payload: null } }],
    onDismissAction: () => {},
  }`);
  assert.match(dismissable, /<button[^>]*>Verwerfen<\/button>/);
  assert.match(browserRuntimeStyles, /\.hljs-keyword/);
  assert.match(browserRuntimeStyles, /diff-code/);
  assert.doesNotMatch(browserRuntimeStyles, /@import/);
  const form = renderControl("Form", `{ fields:[{id:"name",label:"Name",type:"text",required:true},{id:"mode",label:"Modus",type:"select",options:[{value:"read",label:"Lesen"}]}],values:{name:"Demo",mode:"read"},onChange:()=>{},onSubmit:async()=>{} }`);
  assert.match(form, /value="Demo"/);
  assert.match(form, /data-slot="select-trigger"/);
  assert.match(form, /type="submit"/);
  const table = renderControl("DataTable", `{rows:[{id:"one",name:"Demo"}],rowKey:(row)=>row.id,columns:[{id:"name",label:"Name",value:(row)=>row.name,sortable:true}],selectedKeys:["one"],onSelectionChange:()=>{},actions:[{id:"open",label:"Öffnen",onClick:async()=>{}}]}`);
  assert.match(table, /<table[^>]*data-slot="table"/);
  assert.match(table, /aria-selected="true"/);
  assert.match(table, /Öffnen/);
  assert.match(renderControl("FilePicker", `{label:"Dateien wählen",files:[],onChange:()=>{}}`), /type="file"/);
  const progress = renderControl("TaskProgress", `{tasks:[{id:"read",label:"Lesen",status:"done"},{id:"write",label:"Schreiben",status:"pending"}]}`);
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, /aria-valuemax="2"/);
  assert.match(progress, /aria-valuenow="1"/);
  assert.match(renderControl("DocumentViewer", `{format:"markdown",content:"**Dokument**"}`), /<strong[^>]*>Dokument<\/strong>/);
  assert.match(renderControl("DocumentViewer", `{format:"code",filename:"example.ts",content:"const value = 1;"}`), /language-typescript/);
  assert.match(renderControl("DocumentViewer", `{content:"<script>nicht ausführen</script>"}`), /&lt;script&gt;/);
  const diff = renderControl("DiffViewer", `{patch:"--- a/demo.txt\\n+++ b/demo.txt\\n@@ -1 +1 @@\\n-alt\\n+neu"}`);
  assert.match(diff, /diff-code-insert[^>]*>(<span[^>]*>)*neu/);
  assert.match(diff, /diff-code-delete[^>]*>(<span[^>]*>)*alt/);
  assert.match(await buildTailwind([]), /\.text-destructive\s*\{/);
});
