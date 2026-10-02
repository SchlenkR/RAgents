import type { HomepageCatalog } from "./homepage-catalog.js";
import { exampleOverviewMarkdown, exampleWalkthroughsMarkdown, groupStartEntries } from "./homepage-examples.js";
import type { HomepageExtensionsResult } from "./homepage-extensions.js";
import { guideMarkdownOutputs, type HomepageGuide } from "./homepage-guide.js";

export function markdownCode(value: string, language = ""): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${value}${value.endsWith("\n") ? "" : "\n"}${fence}`;
}

const json = (value: unknown) => markdownCode(JSON.stringify(value, null, 2), "json");
const heading = (value: string) => value.replace(/[\r\n]+/g, " ");
const document = (parts: string[]) => parts.join("\n\n") + "\n";
const fileLanguage = (file: string) => file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "typescript"
  : file.endsWith(".json") ? "json" : file.endsWith(".md") ? "markdown" : file.endsWith(".css") ? "css" : "";
const files = (entries: Record<string, string>) => Object.entries(entries)
  .sort(([left], [right]) => left.localeCompare(right, "en"))
  .map(([file, content]) => `#### ${heading(file)}\n\n${markdownCode(content, fileLanguage(file))}`);

function reference(catalog: HomepageCatalog): string {
  const startGroups = groupStartEntries(catalog.starts);
  const groupLabels = new Map(startGroups.map((group) => [group.entries[0].id, group.label]));
  return document([
    "# RAgents: building block reference",
    "> Public tools, operations, actor program templates, and Start page templates of the showcase profile, generated from the actual contracts.",
    "[Run setup guide and complete packages](run-setup.md) | [Developer reference](developer.md) | [JSON-RPC-API](rpc-api.md) | [LLM index](llms.txt)",
    "## Functions and native tools",
    "Domain functions are called in snippets and actor programs through context.functions. Equipped LLM actors automatically receive the function names available to them with short descriptions. typescript_api returns their types and optional long descriptions on request by name, typescript_eval executes snippets. This is the static inventory. Availability and selection depend on actor, grants, and run. Custom actor functions extend this inventory during a run.",
    ...catalog.tools.map((tool) => document([
      `### ${heading(tool.name)}`, tool.label, tool.description,
      ...(tool.longDescription ? [tool.longDescription] : []),
      `Owner: ${tool.owner}. Scope: ${tool.scope}. Native model tool: ${tool.nativeTool ? "yes" : "no"}. Availability: ${tool.availability}.`,
      tool.availabilityDetail,
      "#### Input", json(tool.schema), "#### Result", json(tool.resultSchema),
    ]).trimEnd()),
    "## Operations",
    ...catalog.operations.map((operation) => document([
      `### ${heading(operation.id)}`, operation.description, `Owner: ${operation.owner}.`,
      "#### Operator policy", json(operation.operator),
      "#### Input", json(operation.schema), "#### Result", json(operation.resultSchema),
    ]).trimEnd()),
    "## Actor program templates",
    ...catalog.templates.map((template) => document([
      `### ${heading(template.id)}: ${heading(template.title)}`, template.description,
      ...files(template.files),
    ]).trimEnd()),
    "## Actor program",
    "actor_program_create creates a package under @actors/<name>/ with fixed local dependencies. File tools and language servers use this alias, Bash uses the same alias as cwd. Before model requests, short diagnostic deltas of changed projects appear. actor_program_diagnostics returns the last complete state, actor_program_activate checks, builds, tests, and activates the package.",
    json(catalog.actorProgramAuthoring.package),
    "## Actor backend contract", json(catalog.actorProgramAuthoring.backend),
    "## Mini-app client",
    "The client API is generated from the actor contract in @ragents/client. The general reference shows the structure without concrete functions. The package contains the specialized type files for the TypeScript compiler and the language server.",
    "### Client", markdownCode(catalog.actorProgramAuthoring.client, "typescript"),
    "## Type contract of the mini-app UI",
    "Entry point: apps/web/src/actor-programs/client-ui/contracts.d.ts. All locally referenced type files follow automatically; TypeScript generates declarations from implementation files. External standard types such as React and DOM belong to their libraries. In the app package, these building blocks are available for regular import as @ragents/client/ui; context and useAppState are imported from @ragents/client.",
    ...files(catalog.clientUiFiles),
    exampleOverviewMarkdown(catalog.starts),
    exampleWalkthroughsMarkdown(),
    "## Start page templates",
    ...startGroups.flatMap((group) => group.entries).map((start) => document([
      ...(groupLabels.has(start.id) ? [`### Category: ${heading(groupLabels.get(start.id)!)}`] : []),
      `<a id="start-${start.id}"></a>`,
      `### ${heading(start.id)}: ${heading(start.title)}`, start.description,
      ...(start.tags?.length ? [`Tags: ${start.tags.join(", ")}.`] : []),
      json(start),
      ...(start.action === "script" ? ["Complete package sources are in [run-setup.md](run-setup.md)."] : []),
      ...(start.action === "skill" ? [
        `[Working instructions of the skill](../../plugins/${start.owner}/skills/${start.skill}/SKILL.md)`,
        "Start through POST /runs: Edit the task in message as needed and keep the skill name. The current task takes precedence over example text in the skill.",
        json({ title: start.title, message: `Use the skill ${start.skill} for this task.\n\n${start.prompt}` }),
      ] : []),
    ]).trimEnd()),
    "## Plugins", json(catalog.plugins),
    "## Dynamic tool contributions", json(catalog.dynamic),
  ]);
}

function developer(extensions: HomepageExtensionsResult): string {
  const categories = [...new Set(extensions.extensions.map((extension) => extension.category))];
  return document([
    "# RAgents: developer reference",
    "> Extension points, examples, and current contract surfaces from the code.",
    "[Tool contracts](reference.md) | [Run script packages and API](run-setup.md) | [JSON-RPC-API](rpc-api.md) | [LLM index](llms.txt)",
    "The examples are excerpts for the place of use named in each case. Run-local scripts are native TypeScript modules with an explicit context; plugin server code and web modules are built with the application.",
    ...categories.flatMap((category) => [
      `## ${heading(category)}`,
      ...extensions.extensions.filter((extension) => extension.category === category).map((extension) => document([
        `### ${heading(extension.title)}`, extension.description,
        `Place of use: ${extension.environment}`, markdownCode(extension.example, extension.language),
        ...extension.notes,
        ...(extension.sources?.map((source) => `[${source.title}](../../${source.file})`) ?? []),
        `Contract fields: ${extension.covers.join(", ")}.`,
      ]).trimEnd()),
    ]),
    "## Built-in permissions",
    "The list comes from the permission contracts of the host and the coordinator plugin; plugins can use additional exact names.",
    ...extensions.permissions.map((permission) => `- ${permission.id}: ${permission.description}`),
    "", "### Core methods", "",
    "Generated automatically from the registered contracts; the host checks methods without fixed permissions per run. The global coordinator adds its own rule.", "",
    "| Method | Permissions |", "| --- | --- |",
    ...extensions.methodRights.map((method) => `| ${method.id} | ${method.rights.join(", ") || "per run"} |`),
    "## Current contract surfaces",
    ...extensions.contracts.map((contract) => document([
      `### ${heading(contract.name)}`, `Source in the repository: ${contract.file}`,
      markdownCode(contract.text, "typescript"),
    ]).trimEnd()),
  ]);
}

function runSetup(catalog: HomepageCatalog): string {
  return document([
    "# RAgents: write a run setup",
    "> A run script is a native actor program. The examples and SDK types below come from the actual public sources.",
    "[Tool contracts](reference.md) | [Developer examples](developer.md) | [Server SDK](run-api.d.ts) | [JSON-RPC-API](rpc-api.md) | [LLM index](llms.txt)",
    "## Snippet or persistent program",
    "One-off work needs no actor package: typescript_api returns the catalog or exact function types. typescript_eval receives code or path; the source text is an async function body with context and an optional return. Example: return await context.functions.actor_list({});. The same compiler and the same registered functions serve actor programs with later inputs, state, or views.",
    "Snippets act as the caller. onInput acts as its actor. A called actor function owns that actor's state, but executes further run calls under the caller's identity. Function calls that have already completed persist after a later error; retries check the existing setup.",
    "Domain user tasks and skill templates describe the desired result. Technical contracts are in the environment; the LLM chooses the approach itself. A run script is an additional option for prepared templates.",
    "## Mini-app navigation",
    "Activated visible views enter the app catalog automatically. The browser shows tabs beside Chat; VS Code opens each app in its own editor tab. Programs do not arrange the host interface.",
    "## Package and execution",
    "A reusable script template lives under plugins/<plugin-id>/run-scripts/<name>/. RUN.md names title, description, and optionally order, guide, tags, coordinator, and embeddable. The folder determines the actor handle; coordinator is true by default, embeddable false. The plugin must be active in the profile.",
    "package.json contains private: true, type: module, and ragents.backend with the entry point src/server.ts. It exports defineActor from @ragents/server with state, functions, and input as well as the onInput implementation and optionally onStart. Capabilities appear only in the TypeScript contract, not again in RUN.md.",
    "Domain tests are regular node:test files under tests/**/*.test.ts. createTestContext from @ragents/server/testing provides state and typed functions as mocks under functions. Tests call program.onInput or program.functions and check the result, stored state, and actual calls separately. A return value is never stored as state; context.state.replace serves that purpose.",
    "Further actor programs live under actors/<name>/. The host takes them into the private @actors collection before the setup. The setup activates them with actor_program_activate by name; actor: self or @handle binds to an existing actor. A pure view package needs no new actor.",
    "A program several scripts use lives as a shared actor package under plugins/<plugin-id>/actors/<name>/; RUN.md names it in shared-programs: a, b. The host copies it into the run; each script calls actor_program_ensure({ name }), which returns an active package unchanged and installs or activates it only once.",
    "## Start value and contact",
    "ragents.chat.start passes { runId, entry, input }. The setup actor receives in the content of its ActorInput the JSON { input: <guide result or null>, options: { <option-id>: <value> } }. The shape of the guide result belongs to the package and is checked before use.",
    "With onStart(start, context), the program receives every start there instead of in onInput: start carries input, options, embedded, startedBy (the actor ID of the starter), and count (which start of this package in the run it is). Other inputs keep arriving in onInput.",
    "With embeddable: true, the script also starts inside a running run, through ragents.chat.start or ragents.runs.startScript, which waits and returns the actor or the error. The primary actor stays, the template's fixed start options must match the run's, and every start opens a room of its own named after the script, with its own setup actor and bundled programs; shared packages stay in the main room.",
    "Browser runs share the VS Code panel: Chat and mini-app tabs, one visible view, with visited app input retained. In VS Code apps open in editor tabs. New apps never steal focus and unavailable selected apps return to Chat.",
    "context.finish(result, { summary }) ends a start in onStart, onInput, or onResult; outside onStart it names the start with { start: count }. The owner reads the summary in the chat, an LLM starter gets summary and result as a message, a TypeScript starter gets them in onResult. The coordinator starts scripts with run_script_list and run_script_start; an embedded script adds its visible mini-apps to the shared catalog without changing the selected view.",
    "With coordinator: true, the host creates the coordinator. With coordinator: false, the setup must choose a primary actor through run_configure and give it a concrete task as ActorInput. The setup records the completed setup in its state and processes later inputs without setting up twice.",
    "The host uses the same import and activation path as actor_program_activate: check TypeScript, build, run domain tests, and activate the successful state. The start requires no model call, no separate check/test/install contract, and no build ID in the package.",
    "Prepared local packages can also be started through the HTTP administration with packageDirectory. The path points to a directory on the server; the request uploads no files and registers no persistent template.",
    "## Capabilities and state",
    "context.functions.actor_input(input) calls a registered function with types. Dotted grants such as actor.input are permissions. The SDK catalog grants no permissions; the declared program contract and the bound actor limit the usage.",
    "context.actor identifies the owner of functions and state. context.std provides the available standard functions. Subscription events are under input.event and deliver regular ActorInputs; a running turn does not wait for future inputs.",
    "## Complete public run script packages",
    ...catalog.scripts.map((script) => document([
      `### ${heading(script.id)}`,
      ...files(script.files),
    ]).trimEnd()),
    "## Generated server SDK",
    "These are the real @ragents/server declarations with the static capability inventory of showcase, also available as [run-api.d.ts](run-api.d.ts). The file is a regular module with exports. Installed programs use the same generator with their current contracts; this creates no additional globals or permissions.",
    markdownCode(catalog.serverApiDeclarations, "typescript"),
  ]);
}

export function buildHomepageLlms(catalog: HomepageCatalog, extensions: HomepageExtensionsResult, guide: HomepageGuide): Record<string, string> {
  const referenceText = reference(catalog);
  const developerText = developer(extensions);
  const setupText = runSetup(catalog);
  const apiText = catalog.rpcReference;
  const index = document([
    "# RAgents",
    "> Programmable AI harness with chat, multiple agents, TypeScript actors, and small user interfaces on one surface.",
    "This reference describes the existing public building blocks of the showcase profile (the core base set and the bundled examples). Contracts, API, and package sources are generated from the code. For a new run setup, read the guide and the typed API first, then look up the tool contracts you need.",
    "## Understand and get started",
    "- [Guide](guide.md): Getting started, runtime, access, distributed work, TypeScript functions, mini-apps, plugins, and permissions from the current documentation.",
    guide.chapters.map((chapter) => `- [${chapter.title}](guide-${chapter.id}.md)`).join("\n"),
    "## Run setups",
    "- [Run setup guide](run-setup.md): Package structure, start input, tests, complete examples, and generated API.\n- [Run API](run-api.d.ts): Original TypeScript declarations of the compiler.",
    "## References",
    "- [Building blocks](reference.md): All static tools and operations with input and result schemas, actor program templates, and Start page templates.\n- [Develop](developer.md): Extension points, examples, and current contract surfaces.",
    "## External clients",
    "- [JSON-RPC-API](rpc-api.md): Methods and channels with inputs, results, and errors from the executable contracts.\n- [OpenRPC](openrpc.json): Machine-readable contract from the same sources.",
  ]);
  return {
    ...guideMarkdownOutputs(guide),
    "llms.txt": index,
    "reference.md": referenceText,
    "developer.md": developerText,
    "run-setup.md": setupText,
    "run-api.d.ts": catalog.serverApiDeclarations,
    "rpc-api.md": apiText,
    "openrpc.json": JSON.stringify(catalog.openRpc, null, 2) + "\n",
  };
}
