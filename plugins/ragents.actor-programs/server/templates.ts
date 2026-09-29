import type { AppPackage } from "@ragents/host/plugin-support/actor-programs/app-project.js";
import { controlsTemplate } from "./controls-template";

export interface ActorProgramTemplate {
  id: string;
  title: string;
  description: string;
  ragents: AppPackage;
  files: Readonly<Record<string, string>> & { readonly "package.json"?: never };
}

const blank: ActorProgramTemplate = {
  id: "blank",
  title: "Blank mini-app",
  description: "A pure React view on the existing actor without an additional server function.",
  ragents: {
    title: "My view",
    description: "A small interface of the existing actor.",
    views: [{ id: "main", client: "src/client.tsx" }],
  },
  files: {
    "src/client.tsx": `import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";

const App = () => (
  <UI.AppLayout title="My view">
    <UI.Stack><p>Ready for your content.</p></UI.Stack>
  </UI.AppLayout>
);

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
`,
  },
};

const chat: ActorProgramTemplate = {
  id: "chat",
  title: "Actor chat",
  description: "Reusable chat with history and optional input to the actor of this view.",
  ragents: {
    title: "Actor chat",
    description: "Shows the conversation with an actor and sends it user input.",
    views: [{ id: "main", client: "src/client.tsx" }],
  },
  files: {
    "src/client.tsx": `import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";
import { context } from "@ragents/client";

const App = () => (
  <UI.Chat actor={"@" + context.actor.handle} className="h-full" showInput placeholder="Message to the actor" />
);

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
`,
  },
};

const textAnalysis: ActorProgramTemplate = {
  id: "text-analysis",
  title: "Text analysis",
  description: "A TypeScript actor analyzes texts with its own function, state, and React view.",
  ragents: {
    title: "Text analysis",
    description: "Counts characters, words, and lines and remembers the number of analyses.",
    backend: "src/server.ts",
    views: [{ id: "main", client: "src/client.tsx" }],
  },
  files: {
    "src/client.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];

const App = () => {
  const state = useAppState();
  const [values, setValues] = React.useState<FormValues>({ text: "" });
  const [result, setResult] = React.useState("Ready");

  const analyse = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("analyse", { text: String(next.text ?? "") });
    setResult([
      \`Characters: \${answer.characters}\`,
      \`Words: \${answer.words}\`,
      \`Lines: \${answer.lines}\`,
    ].join("\\n"));
  };

  return (
    <UI.AppLayout title="Text analysis" description={<>Analyses: {state.analyses ?? 0}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "Text", type: "textarea", rows: 6, placeholder: "Enter text" },
        ]} values={values} onChange={setValues} onSubmit={analyse} submitLabel="Analyze" />
        <UI.Stack><pre aria-live="polite" className="min-h-[90px] overflow-auto rounded-md border border-border bg-muted p-2.5 font-mono whitespace-pre-wrap">{result}</pre></UI.Stack>
      </UI.Grid>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
`,
    "src/contract.ts": `import { Type } from "typebox";

export const contract = {
  state: Type.Object({ analyses: Type.Optional(Type.Integer({"minimum": 0})) }, {"additionalProperties": false}),
  functions: {
    analyse: {
      label: "Analyze text",
      description: "Counts words, characters, and lines without external effects.",
      tool: { name: "analyse_text" },
      input: Type.Object({ text: Type.String({"description": "The text to analyze."}) }, {"additionalProperties": false}),
      output: Type.Object({ text: Type.String(), characters: Type.Integer({"minimum": 0}), words: Type.Integer({"minimum": 0}), lines: Type.Integer({"minimum": 0}), analyses: Type.Integer({"minimum": 1}) }, {"additionalProperties": false}),
      capabilities: [],
    },
  },
} as const;
`,
    "src/server.ts": `import { defineActor } from "@ragents/server";
import { contract } from "./contract.ts";

export default defineActor(contract, {
  functions: {
    analyse: async (input, context) => {
      const text = input.text.trim();
      const state = context.state.read();
      const analyses = (state.analyses ?? 0) + 1;
      context.state.replace({ analyses });

      return {
        text,
        characters: text.length,
        words: text ? text.split(/\\s+/).length : 0,
        lines: text ? text.split(/\\r?\\n/).length : 0,
        analyses,
      };
    },
  },
});
`,
    "tests/program.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("counts words, lines, and further analyses", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.analyse({"text": "  Hello world\\nNew line  "}, context), {"text": "Hello world\\nNew line", "characters": 20, "words": 4, "lines": 2, "analyses": 1});
  assert.deepEqual(await program.functions.analyse({"text": ""}, context), {"text": "", "characters": 0, "words": 0, "lines": 0, "analyses": 2});
  assert.deepEqual(context.state.read(), {"analyses": 2});
});
`,
  },
};

const headlessCounter: ActorProgramTemplate = {
  id: "headless-counter",
  title: "Counter without interface",
  description: "A TypeScript actor counts inputs in its state and offers the same work as a function.",
  ragents: {
    title: "Counter",
    description: "Collects incoming texts without model calls or interface.",
    backend: "src/server.ts",
  },
  files: {
    "src/contract.ts": `import { Type } from "typebox";

const state = Type.Object({
  texts: Type.Optional(Type.Array(Type.String())),
  count: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

export const contract = {
  state,
  functions: {
    record: {
      label: "Count text",
      input: Type.Object({ text: Type.String() }, { additionalProperties: false }),
      output: Type.Object({ count: Type.Integer(), texts: Type.Array(Type.String()) }, { additionalProperties: false }),
      tool: { name: "record_text" },
    },
    inspect: {
      label: "Read counter",
      input: Type.Object({}, { additionalProperties: false }),
      output: state,
      tool: { name: "read_counter" },
    },
  },
  input: { capabilities: [] },
} as const;
`,
    "src/server.ts": `import { defineActor } from "@ragents/server";
import type { Static } from "typebox";
import { contract } from "./contract.ts";

const record = (state: Static<typeof contract.state>, text: string) => {
  const texts = [...(state.texts ?? []), text];
  return { texts, count: texts.length };
};

export default defineActor(contract, {
  functions: {
    record: (input, context) => {
      const result = record(context.state.read(), input.text);
      context.state.replace(result);
      return result;
    },
    inspect: (_input, context) => context.state.read(),
  },
  onInput: (input, context) => {
    context.state.replace(record(context.state.read(), input.content));
  },
});
`,
    "tests/program.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("inputs and functions share the same counter", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  for (const content of ["one", "two", "three"]) {
    await program.onInput!({ id: content, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context);
  }
  assert.deepEqual(await program.functions.inspect({}, context), { texts: ["one", "two", "three"], count: 3 });
  assert.deepEqual(await program.functions.record({ text: "four" }, context), { texts: ["one", "two", "three", "four"], count: 4 });
  assert.deepEqual(context.state.read(), { texts: ["one", "two", "three", "four"], count: 4 });
});
`,
  },
};

const sharedList: ActorProgramTemplate = {
  id: "shared-list",
  title: "Shared list of an actor",
  description: "An actor owns a function and a React view for the same list state.",
  ragents: {
    title: "Shared list",
    description: "Collects texts from the app and from an agent tool in a shared list.",
    backend: "src/server.ts",
    views: [{ id: "main", client: "src/client.tsx" }],
  },
  files: {
    "src/client.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];

const App = () => {
  const state = useAppState();
  const [values, setValues] = React.useState<FormValues>({ text: "" });
  const [status, setStatus] = React.useState("Ready");
  const entries = state.entries ?? [];

  const append = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("append", { text: String(next.text ?? "") });
    setValues({ text: "" });
    setStatus(\`Added: \${answer.text}\`);
  };

  return (
    <UI.AppLayout title="Shared list" description={<>{entries.length} {entries.length === 1 ? "item" : "items"}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "New item", type: "textarea", placeholder: "Enter text" },
        ]} values={values} onChange={setValues} onSubmit={append} submitLabel="Add" />
        <UI.Stack>
          <p className="text-muted-foreground" role="status">{status}</p>
          <ul className="border-t border-border">
            {entries.map((entry, index) => <li className="min-h-[31px] border-b border-border-soft py-1.5 [overflow-wrap:anywhere]" key={index}>{entry}</li>)}
          </ul>
        </UI.Stack>
      </UI.Grid>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
`,
    "src/contract.ts": `import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }, {"additionalProperties": false}),
  functions: {
    append: {
      label: "Add entry",
      description: "Appends the entered text to the shared list.",
      input: Type.Object({ text: Type.String({"description": "The text for the new list entry."}) }, {"additionalProperties": false}),
      output: Type.Object({ text: Type.String(), entries: Type.Array(Type.String()) }, {"additionalProperties": false}),
      capabilities: [],
      tool: { name: "append_to_list", card: true },
    },
  },
} as const;
`,
    "src/server.ts": `import { defineActor } from "@ragents/server";
import { contract } from "./contract.ts";

export default defineActor(contract, {
  functions: {
    append: async (input, context) => {
      const text = input.text.trim();
      const state = context.state.read();
      const entries = [...(state.entries ?? []), text];
      context.state.replace({ entries });
      return { text, entries };
    },
  },
});
`,
    "tests/program.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("adds entries without losing existing entries", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.append({"text": "  First entry  "}, context), {"text": "First entry", "entries": ["First entry"]});
  assert.deepEqual(await program.functions.append({"text": "Second entry"}, context), {"text": "Second entry", "entries": ["First entry", "Second entry"]});
  assert.deepEqual(context.state.read(), {"entries": ["First entry", "Second entry"]});
});
`,
  },
};

export const runModuleTemplates = [blank, chat, controlsTemplate, textAnalysis, headlessCounter, sharedList] as const;

export const templateFiles = (template: ActorProgramTemplate, name: string): Readonly<Record<string, string>> => ({
  "package.json": `${JSON.stringify({ name, private: true, type: "module", ragents: template.ragents }, null, 2)}\n`,
  ...template.files,
});

export const templateById = (id: string): ActorProgramTemplate => {
  const template = runModuleTemplates.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown actor program template ${id}. Valid: ${runModuleTemplates.map((entry) => entry.id).join(", ")}.`);
  return template;
};
