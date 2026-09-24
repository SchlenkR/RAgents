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
  title: "Leere Mini-App",
  description: "Eine reine React-View am vorhandenen Actor ohne zusätzliche Serverfunktion.",
  ragents: {
    title: "Meine View",
    description: "Eine kleine Bedienoberfläche des vorhandenen Actors.",
    views: [{ id: "main", client: "src/client.tsx" }],
  },
  files: {
    "src/client.tsx": `import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";

const App = () => (
  <UI.AppLayout title="Meine View">
    <UI.Stack><p>Bereit für deine Inhalte.</p></UI.Stack>
  </UI.AppLayout>
);

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
`,
  },
};

const chat: ActorProgramTemplate = {
  id: "chat",
  title: "Actor-Chat",
  description: "Wiederverwendbarer Chat mit Verlauf und optionaler Eingabe an den Actor dieser View.",
  ragents: {
    title: "Actor-Chat",
    description: "Zeigt das Gespräch mit einem Actor und sendet ihm Benutzereingaben.",
    views: [{ id: "main", client: "src/client.tsx" }],
  },
  files: {
    "src/client.tsx": `import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";
import { context } from "@ragents/client";

const App = () => (
  <UI.Chat actor={"@" + context.actor.handle} className="h-full" showInput placeholder="Nachricht an den Actor" />
);

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
`,
  },
};

const textAnalysis: ActorProgramTemplate = {
  id: "text-analysis",
  title: "Textanalyse",
  description: "Ein TypeScript-Actor analysiert Texte mit eigener Funktion, Zustand und React-View.",
  ragents: {
    title: "Textanalyse",
    description: "Zählt Zeichen, Wörter und Zeilen und merkt sich die Zahl der Analysen.",
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
  const [result, setResult] = React.useState("Bereit");

  const analyse = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("analyse", { text: String(next.text ?? "") });
    setResult([
      \`Zeichen: \${answer.characters}\`,
      \`Wörter: \${answer.words}\`,
      \`Zeilen: \${answer.lines}\`,
    ].join("\\n"));
  };

  return (
    <UI.AppLayout title="Textanalyse" description={<>Analysen: {state.analyses ?? 0}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "Text", type: "textarea", rows: 6, placeholder: "Text eingeben" },
        ]} values={values} onChange={setValues} onSubmit={analyse} submitLabel="Analysieren" />
        <UI.Stack><pre aria-live="polite" className="min-h-[90px] overflow-auto rounded-md border border-border bg-muted p-2.5 font-mono whitespace-pre-wrap">{result}</pre></UI.Stack>
      </UI.Grid>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
`,
    "src/contract.ts": `import { Type } from "typebox";

export const contract = {
  state: Type.Object({ analyses: Type.Optional(Type.Integer({"minimum": 0})) }, {"additionalProperties": false}),
  functions: {
    analyse: {
      label: "Text analysieren",
      description: "Zählt Wörter, Zeichen und Zeilen ohne externe Wirkung.",
      tool: { name: "analyse_text" },
      input: Type.Object({ text: Type.String({"description": "Der zu analysierende Text."}) }, {"additionalProperties": false}),
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

test("zählt Wörter, Zeilen und weitere Analysen", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.analyse({"text": "  Hallo Welt\\nNeue Zeile  "}, context), {"text": "Hallo Welt\\nNeue Zeile", "characters": 21, "words": 4, "lines": 2, "analyses": 1});
  assert.deepEqual(await program.functions.analyse({"text": ""}, context), {"text": "", "characters": 0, "words": 0, "lines": 0, "analyses": 2});
  assert.deepEqual(context.state.read(), {"analyses": 2});
});
`,
  },
};

const headlessCounter: ActorProgramTemplate = {
  id: "headless-counter",
  title: "Zähler ohne Oberfläche",
  description: "Ein TypeScript-Actor zählt Eingaben in seinem Zustand und bietet dieselbe Arbeit als Funktion an.",
  ragents: {
    title: "Zähler",
    description: "Sammelt eingehende Texte ohne Modellaufrufe oder Oberfläche.",
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
      label: "Text zählen",
      input: Type.Object({ text: Type.String() }, { additionalProperties: false }),
      output: Type.Object({ count: Type.Integer(), texts: Type.Array(Type.String()) }, { additionalProperties: false }),
      tool: { name: "record_text" },
    },
    inspect: {
      label: "Zähler lesen",
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

test("Eingaben und Funktionen teilen denselben Zähler", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  for (const content of ["eins", "zwei", "drei"]) {
    await program.onInput!({ id: content, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context);
  }
  assert.deepEqual(await program.functions.inspect({}, context), { texts: ["eins", "zwei", "drei"], count: 3 });
  assert.deepEqual(await program.functions.record({ text: "vier" }, context), { texts: ["eins", "zwei", "drei", "vier"], count: 4 });
  assert.deepEqual(context.state.read(), { texts: ["eins", "zwei", "drei", "vier"], count: 4 });
});
`,
  },
};

const sharedList: ActorProgramTemplate = {
  id: "shared-list",
  title: "Gemeinsame Liste eines Actors",
  description: "Ein Actor besitzt eine Funktion und eine React-View für denselben Listenstand.",
  ragents: {
    title: "Gemeinsame Liste",
    description: "Sammelt Texte aus der App und aus einem Agenten-Werkzeug in einer gemeinsamen Liste.",
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
  const [status, setStatus] = React.useState("Bereit");
  const entries = state.entries ?? [];

  const append = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("append", { text: String(next.text ?? "") });
    setValues({ text: "" });
    setStatus(\`Hinzugefügt: \${answer.text}\`);
  };

  return (
    <UI.AppLayout title="Gemeinsame Liste" description={<>{entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "Neuer Eintrag", type: "textarea", placeholder: "Text eingeben" },
        ]} values={values} onChange={setValues} onSubmit={append} submitLabel="Hinzufügen" />
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
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
`,
    "src/contract.ts": `import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }, {"additionalProperties": false}),
  functions: {
    append: {
      label: "Eintrag hinzufügen",
      description: "Hängt den eingegebenen Text an die gemeinsame Liste an.",
      input: Type.Object({ text: Type.String({"description": "Der Text für den neuen Listeneintrag."}) }, {"additionalProperties": false}),
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

test("ergänzt Einträge ohne vorhandene Einträge zu verlieren", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: {} });
  assert.deepEqual(await program.functions.append({"text": "  Erster Eintrag  "}, context), {"text": "Erster Eintrag", "entries": ["Erster Eintrag"]});
  assert.deepEqual(await program.functions.append({"text": "Zweiter Eintrag"}, context), {"text": "Zweiter Eintrag", "entries": ["Erster Eintrag", "Zweiter Eintrag"]});
  assert.deepEqual(context.state.read(), {"entries": ["Erster Eintrag", "Zweiter Eintrag"]});
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
  if (!template) throw new Error(`Unbekannte Actor-Programm-Vorlage ${id}. Gültig: ${runModuleTemplates.map((entry) => entry.id).join(", ")}.`);
  return template;
};
