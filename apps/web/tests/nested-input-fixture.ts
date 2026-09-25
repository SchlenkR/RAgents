import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { frameHtml } from "../../../plugins/ragents.actor-programs/server/routes";

export async function nestedInputFixture(serverUrl: string): Promise<Record<string, string>> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const bundle = async (contents: string) => (await build({
    stdin: { contents, resolveDir: root, loader: "tsx" }, bundle: true, platform: "browser", format: "iife",
    jsx: "automatic", write: false, logLevel: "silent",
  })).outputFiles[0].text;
  const top = await bundle(`
    import { createRoot } from "react-dom/client";
    import { ActorViewFrame } from "./plugins/ragents.actor-programs/web/ActorViewFrame";
    import { installRunPanelInputBridge } from "./apps/web/src/run-panel/input-bridge";
    import { initializeTheme } from "./apps/web/src/theme";
    initializeTheme(window);
    if (new URLSearchParams(location.search).get("host") === "vscode") installRunPanelInputBridge(window);
    const app = {id:"first",actorId:"worker",actorHandle:"worker",title:"Mini-App",revision:"1",actions:[],placements:[],invocations:[],state:null};
    const api = {frameUrl: () => ${JSON.stringify(`${serverUrl}/first`)}};
    createRoot(document.getElementById("root")).render(<ActorViewFrame api={api} app={app} invoke={async()=>{throw new Error("unused")}} presentation="embedded" runId="test" session={{session:{id:"test"}}}/>);
  `);
  const client = await bundle(`
    import { createRoot } from "react-dom/client";
    import { useState } from "react";
    import { hostInputEnabled, relayFrameInput } from "./apps/web/src/run-panel/input-bridge";
    window.inputEvents=[];
    document.addEventListener("input",event=>window.inputEvents.push({value:event.target.value,inputType:event.inputType}));
    function Editor(){const [value,setValue]=useState("");return <><textarea id="editor" aria-label="Editor" value={value} onChange={e=>setValue(e.target.value)}/><output id="value">{value}</output><input id="input"/><div contentEditable id="editable">Editable text</div></>}
    createRoot(document.getElementById("root")).render(<Editor/>);
    if (location.pathname === "/first") {
      const frame=document.createElement("iframe");
      frame.id="nested";frame.sandbox="allow-scripts";frame.style.cssText="width:100%;height:260px";
      const token=crypto.randomUUID().replaceAll("-","");
      let activePort;
      window.addEventListener("message",event=>{
        if(event.source!==frame.contentWindow||event.origin!=="null"||event.data.token!==token)return;
        if(event.data.type==="ragents.app.escape") {window.dispatchEvent(new KeyboardEvent("keydown",{...event.data.keyboard.event,bubbles:true,cancelable:true}));return;}
        if(event.data.type!=="ragents.app.frame-ready"||event.ports.length!==1)return;
        const port=event.ports[0];activePort=port;
        port.onmessage=({data})=>relayFrameInput(window,data,message=>{if(activePort===port)port.postMessage(message)});
        port.start();port.postMessage({type:"ragents.app.ready",version:1,theme:"dark",hostInput:hostInputEnabled(window),app:{id:"second",actions:[]},state:null,invocations:[]});
      });
      frame.src=${JSON.stringify(`${serverUrl}/second`)}+"#ragentsBridge="+token;
      document.body.appendChild(frame);
    }
  `);
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';
  const frame = frameHtml({ html, styles: "textarea,input{display:block;width:85%;margin:12px}iframe{border:1px solid}body{margin:0}", clientJavaScript: client } as Parameters<typeof frameHtml>[0], "fixture-nonce");
  return {
    "/run-panel.html": '<!doctype html><html><head><style>html,body,#root{height:100%;margin:0}#root,#root>div{display:flex;flex-direction:column}#root>div{flex:1}#root>div>div:last-child{position:relative;flex:1}iframe{position:absolute;width:100%;height:100%;border:0}</style></head><body><div id="root"></div><script src="/root.js"></script></body></html>',
    "/root.js": top,
    "/first": frame,
    "/second": frame,
  };
}
