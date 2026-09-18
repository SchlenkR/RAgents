import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { assertPublicOutput, type HomepageCatalog } from "./homepage-catalog.js";
import { buildHomepageExtensions } from "./homepage-extensions.js";
import { buildHomepageGuide } from "./homepage-guide.js";
import { buildHomepageLlms, markdownCode } from "./homepage-llms.js";
import { exampleCoverage, exampleAnchor } from "./homepage-examples.js";
import { managementOpenApi, managementHttpReference } from "../../plugins/ragents.overseer/server/http-api.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
async function loadFixtures() {
  const scratch = await mkdtemp(path.join(tmpdir(), "ragents-llms-"));
  try {
    const require = createRequire(path.join(repoRoot, "apps/server/package.json"));
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import", require.resolve("tsx"), path.join(repoRoot, "scripts/homepage/homepage-catalog.ts"), "--collect",
    ], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH, DATA_DIR: scratch, PRODUCT_PROFILE: "core", PRODUCT_ID: "ragents",
        PRODUCT_TITLE: "RAgents", AGENT_MODEL: "z-ai/glm-5.3-flash", AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3",
        OPENROUTER_API_KEY: "documentation-only" },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60000,
    });
    const catalog = JSON.parse(stdout) as HomepageCatalog;
    const extensions = await buildHomepageExtensions(repoRoot);
    return { catalog, extensions, guide: await buildHomepageGuide(repoRoot) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
let loaded: ReturnType<typeof loadFixtures> | undefined;
const fixtures = () => loaded ??= loadFixtures();

test("Textreferenzen sind deterministisch und der kurze Index deckt alle erzeugten Detaildateien ab", async () => {
  const { catalog, extensions, guide } = await fixtures();
  const outputs = buildHomepageLlms(catalog, extensions, guide);
  assert.deepEqual(buildHomepageLlms(catalog, extensions, guide), outputs);
  assert.deepEqual(buildHomepageLlms(JSON.parse(JSON.stringify(catalog)), extensions, guide), outputs);
  assert.match(outputs["llms.txt"], /^# RAgents\n\n> /);
  assert.ok(outputs["llms.txt"].length < 2000);
  const links = [...outputs["llms.txt"].matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  assert.deepEqual([...links].sort(), Object.keys(outputs).filter((name) => name !== "llms.txt").sort());
  for (const [name, output] of Object.entries(outputs)) {
    assert.ok(output.length > 0, name);
    assert.doesNotThrow(() => assertPublicOutput(output), name);
  }
  for (const name of ["reference.md", "developer.md", "run-setup.md", "http-api.md"]) {
    assert.ok(outputs["llms-full.txt"].includes(outputs[name].trimEnd()), name);
  }
});

test("HTTP-Referenz und OpenAPI stammen unverändert aus den ausführbaren Management-Verträgen", async () => {
  const { catalog, extensions, guide } = await fixtures();
  const outputs = buildHomepageLlms(catalog, extensions, guide);
  assert.equal(outputs["http-api.md"], managementHttpReference());
  assert.deepEqual(JSON.parse(outputs["openapi.json"]), managementOpenApi());
  assert.ok(outputs["llms-full.txt"].includes(outputs["http-api.md"].trimEnd()));
  for (const name of ["reference.md", "developer.md", "llms.txt"]) {
    assert.ok(outputs[name].includes("[HTTP-API](http-api.md)"), name);
  }
  assert.ok(outputs["llms.txt"].includes("[OpenAPI](openapi.json)"));
});

test("alle öffentlichen Werkzeuge, Operationen, Schemata und Vorlagendateien bleiben vollständig erhalten", async () => {
  const { catalog, extensions, guide } = await fixtures();
  const output = buildHomepageLlms(catalog, extensions, guide)["reference.md"];
  assert.ok(catalog.tools.length > 20);
  assert.ok(catalog.tools.some((tool) => tool.longDescription), "Ausführliche Funktionsbeschreibungen fehlen im Katalog");
  const opener = catalog.tools.find((tool) => tool.name === "typescript_api");
  assert.ok(opener, "Der dynamische Nachschlagevertrag fehlt in der Referenz");
  assert.ok(JSON.stringify(opener.schema).includes('"names"'));
  for (const tool of catalog.tools) {
    assert.ok(output.includes(`### ${tool.name}\n`), tool.name);
    assert.ok(output.includes(tool.description), tool.name);
    if (tool.longDescription) assert.ok(output.includes(tool.longDescription), `${tool.name} long description`);
    assert.ok(output.includes(markdownCode(JSON.stringify(tool.schema, null, 2), "json")), `${tool.name} input`);
    assert.ok(output.includes(markdownCode(JSON.stringify(tool.resultSchema, null, 2), "json")), `${tool.name} output`);
  }
  for (const operation of catalog.operations) {
    assert.ok(output.includes(`### ${operation.id}\n`), operation.id);
    assert.ok(output.includes(markdownCode(JSON.stringify(operation.operator, null, 2), "json")), `${operation.id} operator`);
    assert.ok(output.includes(markdownCode(JSON.stringify(operation.schema, null, 2), "json")), `${operation.id} input`);
    assert.ok(output.includes(markdownCode(JSON.stringify(operation.resultSchema, null, 2), "json")), `${operation.id} output`);
  }
  for (const template of catalog.templates) {
    assert.ok(output.includes(`### ${template.id}:`));
    for (const [file, source] of Object.entries(template.files)) {
      assert.ok(output.includes(`#### ${file}\n`), file);
      assert.ok(output.includes(source), `${template.id}/${file}`);
    }
  }
  assert.ok(output.includes(JSON.stringify(catalog.actorProgramAuthoring.package, null, 2)));
  assert.ok(output.includes(JSON.stringify(catalog.actorProgramAuthoring.backend, null, 2)));
  assert.ok(output.includes(markdownCode(catalog.actorProgramAuthoring.client, "typescript")));
  for (const [file, source] of Object.entries(catalog.clientUiFiles)) {
    assert.ok(output.includes(`#### ${file}\n`), file);
    assert.ok(output.includes(source), file);
  }
});

test("Run-Anleitung und Entwicklerreferenz enthalten echte Quellen und unveränderte Compilerverträge", async () => {
  const { catalog, extensions, guide } = await fixtures();
  const outputs = buildHomepageLlms(catalog, extensions, guide);
  assert.equal(outputs["run-api.d.ts"], catalog.serverApiDeclarations);
  assert.ok(outputs["run-setup.md"].includes(catalog.serverApiDeclarations));
  assert.ok(outputs["run-setup.md"].includes("node:test"));
  assert.ok(catalog.scripts.length > 0);
  for (const script of catalog.scripts) {
    assert.ok(outputs["run-setup.md"].includes(`### ${script.id}\n`));
    for (const [file, source] of Object.entries(script.files)) {
      assert.ok(outputs["run-setup.md"].includes(`#### ${file}\n`), file);
      assert.ok(outputs["run-setup.md"].includes(source), `${script.id}/${file}`);
    }
  }
  for (const extension of extensions.extensions) {
    assert.ok(outputs["developer.md"].includes(extension.example), extension.id);
    for (const note of extension.notes) assert.ok(outputs["developer.md"].includes(note), extension.id);
  }
  for (const contract of extensions.contracts) {
    assert.ok(outputs["developer.md"].includes(contract.text), contract.name);
    assert.ok(outputs["developer.md"].includes(contract.file), contract.name);
  }
});

test("Beispielübersicht verlinkt beide Perspektiven und mindestens zwei Einstiege pro Produktkonzept", async () => {
  const { catalog, extensions, guide } = await fixtures();
  const output = buildHomepageLlms(catalog, extensions, guide)["reference.md"];
  const coverage = exampleCoverage(catalog.starts);
  for (const axis of coverage.axes) assert.ok(output.includes(`### ${axis.label}\n`));
  for (const concept of coverage.concepts) {
    assert.ok(concept.examples.length >= 2, concept.label);
    assert.ok(output.includes(`| ${concept.label} |`), concept.label);
    for (const example of concept.examples) {
      assert.ok(output.includes(`](#${exampleAnchor(example)})`), example.id);
      assert.ok(output.includes(`<a id="${exampleAnchor(example)}"></a>`), example.id);
    }
  }
  const requests = [...output.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
  for (const start of catalog.starts) {
    if (start.tags?.length) assert.ok(output.includes(`Tags: ${start.tags.join(", ")}.`), start.id);
    if (start.action === "skill") {
      assert.ok(requests.some((request) => request.title === start.title && request.message?.includes(start.skill)
        && request.message.endsWith(start.prompt)), start.id);
    }
  }
});

test("Codezäune erhalten eingebettetes Markdown und Paketdateireihenfolge ändert die Ausgabe nicht", async () => {
  const embedded = "# README\n\n```tsx\nconst value = `text`;\n```\n\n`````\n";
  const fenced = markdownCode(embedded, "markdown");
  assert.equal(fenced, `\`\`\`\`\`\`markdown\n${embedded}\`\`\`\`\`\``);
  const { catalog, extensions, guide } = await fixtures();
  const first = catalog.scripts[0];
  const variant = { ...catalog, scripts: [{ ...first, files: { "RUN.md": embedded, "src/server.ts": first.files["src/server.ts"]! } }] };
  const reversed = { ...variant, scripts: [{ ...first, files: { "src/server.ts": first.files["src/server.ts"]!, "RUN.md": embedded } }] };
  assert.deepEqual(buildHomepageLlms(variant, extensions, guide), buildHomepageLlms(reversed, extensions, guide));
  assert.ok(buildHomepageLlms(variant, extensions, guide)["run-setup.md"].includes(fenced));
});
