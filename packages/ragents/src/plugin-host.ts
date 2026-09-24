import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { InlineExtension } from "@ragents/agent";
import { agentHookExtension } from "./drivers/agent-hooks.ts";
import { Value } from "typebox/value";
import { canStartEntry, defaultHttpRights, isAccessRight, unrestrictedAccess, type AccessContext } from "./access.ts";
import { DomainError } from "./runtime/domain-error.ts";
import { assertJsonValue, type JsonValue } from "./domain/json.ts";
import { canonicalHash } from "./runtime/canonical-hash.ts";
import { schemaComplaints } from "./domain/schema-errors.ts";
import type { AgentProfile, CatalogModel } from "./agents/catalog.ts";
import type { ToolContributor } from "./agents/plugins.ts";
import { describeToolAvailability, type RunFunction } from "./agents/tools.ts";
import type { ChannelContribution, ChannelDescriptor, MethodContribution, MethodDescriptor } from "./rpc/contribution.ts";
import type {
  AgentAudience,
  HttpRouteContribution,
  OperationContext,
  OperationContribution,
  RegisteredOperationDescriptor,
  AgentContribution,
  AgentContributionContext,
  PluginConfigDescriptor,
  PluginManifest,
  PluginRegistration,
  PluginStorage,
  PluginStorageModes,
  ProductDescriptor,
  ModelProviderRegistration,
  ProfileContribution,
  PromptContribution,
  PromptRenderContext,
  PublicAgentHookContribution,
  PublicPluginConfigDescriptor,
  PublicPluginManifest,
  PublicPluginProfile,
  PublicPromptContribution,
  PublicStartEntry,
  PublicPromptSnapshot,
  PublicSkillContribution,
  PublicToolDescriptor,
  RAgentsPlugin,
  ServiceToken,
  RegisteredStartOption,
  SessionLifecycleContribution,
  SessionMetadata,
  SessionMetadataContribution,
  SkillContribution,
  RunScriptPackage,
  StartEntryContribution,
  StartOptionContext,
  StartOptionContribution,
  ScriptContribution,
  ScriptFactoryContext,
  ScriptRuntime,
} from "./plugin-types.ts";

const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const OPERATION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const START_OPTION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_PLUGIN_STOP_TIMEOUT_MS = 15_000;

type Owned<T> = { owner: string; value: T };

class ContributionRegistry<T extends { id: string }> {
  readonly #kind: string;
  readonly #entries: Owned<T>[] = [];

  constructor(kind: string) {
    this.#kind = kind;
  }

  register(owner: string, values: readonly T[]): void {
    for (const value of values) {
      const existing = this.#entries.find((entry) => entry.value.id === value.id);
      if (existing) {
        throw new Error(`${this.#kind} ${value.id} wird bereits von ${existing.owner} bereitgestellt`);
      }
      this.#entries.push({ owner, value });
    }
  }

  entries(): readonly Owned<T>[] {
    return this.#entries;
  }
}

export class MethodContributionRegistry {
  readonly #methods = new ContributionRegistry<{ id: string; contribution: MethodContribution }>("Methode");

  register(owner: string, contributions: readonly MethodContribution[]): void {
    this.#methods.register(owner, contributions.map((contribution) => ({ id: contribution.contract.id, contribution })));
  }

  find(id: string): { owner: string; contribution: MethodContribution } | undefined {
    const found = this.#methods.entries().find(({ value }) => value.id === id);
    return found ? { owner: found.owner, contribution: found.value.contribution } : undefined;
  }

  describe(): readonly MethodDescriptor[] {
    return this.#methods.entries().map(({ owner, value }) => {
      const { id, description, rights, input, result, implementedBy } = value.contribution.contract;
      return Object.freeze({ owner, id, description, rights, input, result, implementedBy });
    });
  }
}

export class ChannelContributionRegistry {
  readonly #channels = new ContributionRegistry<{ id: string; contribution: ChannelContribution }>("Kanal");

  register(owner: string, contributions: readonly ChannelContribution[]): void {
    this.#channels.register(owner, contributions.map((contribution) => ({ id: contribution.contract.id, contribution })));
  }

  find(id: string): { owner: string; contribution: ChannelContribution } | undefined {
    const found = this.#channels.entries().find(({ value }) => value.id === id);
    return found ? { owner: found.owner, contribution: found.value.contribution } : undefined;
  }

  describe(): readonly ChannelDescriptor[] {
    return this.#channels.entries().map(({ owner, value }) => {
      const { id, description, rights, params, message } = value.contribution.contract;
      return Object.freeze({ owner, id, description, rights, params, message });
    });
  }
}

export class HttpContributionRegistry {
  readonly #routes = new ContributionRegistry<HttpRouteContribution>("HTTP-Route");

  register(owner: string, routes: readonly HttpRouteContribution[]): void {
    this.#routes.register(owner, routes);
  }

  isApiPath(pathname: string): boolean {
    return this.#routes.entries().some(({ value }) => value.isApiPath(pathname));
  }

  async dispatch(request: IncomingMessage, response: ServerResponse, url: URL, access: AccessContext = unrestrictedAccess): Promise<boolean> {
    const route = this.#routes.entries().find(({ value }) => value.matches(request, url));
    if (!route) return false;
    const policy = route.value.requiredRights;
    const rights = typeof policy === "function" ? policy(request, url) : policy ?? defaultHttpRights(request.method);
    const missing = rights.find((right) => !access.can(right));
    if (missing) {
      response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: `Das Recht ${missing} fehlt.`, code: "access-denied", right: missing }));
      return true;
    }
    await route.value.handle({ request, response, url, access });
    return true;
  }
}

export class OperationContributionRegistry {
  readonly #operations = new ContributionRegistry<OperationContribution>("Operation");

  register(owner: string, operations: readonly OperationContribution[]): void {
    for (const operation of operations) {
      if (!OPERATION_ID.test(operation.id)) throw new Error(`Ungültige Operation-Id: ${operation.id}`);
      if (!operation.label.trim()) throw new Error(`Operation ${operation.id} hat kein Label`);
      if (!operation.description.trim()) throw new Error(`Operation ${operation.id} hat keine Beschreibung`);
      if (operation.operator !== "direct" && operation.operator !== "confirm" && operation.operator !== "unavailable") {
        throw new Error(`Operation ${operation.id} hat eine ungültige Operator-Policy`);
      }
      if (typeof operation.execute !== "function") throw new Error(`Operation ${operation.id} hat keine Ausführung`);
    }
    this.#operations.register(owner, operations);
  }

  operation(id: string): RegisteredOperationDescriptor | undefined {
    const found = this.#operations.entries().find(({ value }) => value.id === id);
    if (!found) return undefined;
    const { execute: _execute, ...descriptor } = found.value;
    return Object.freeze({ owner: found.owner, ...descriptor });
  }

  describe(): readonly RegisteredOperationDescriptor[] {
    return this.#operations.entries().map(({ value, owner }) => {
      const { execute: _execute, ...descriptor } = value;
      return Object.freeze({ owner, ...descriptor });
    });
  }

  async invoke(id: string, context: OperationContext, input: unknown): Promise<JsonValue> {
    const operation = this.#operations.entries().find(({ value }) => value.id === id)?.value;
    if (!operation) throw new Error(`Operation ${id} ist nicht registriert`);
    assertJsonValue(input, `Operation ${id} input`);

    if (!Value.Check(operation.schema, input)) {
      throw new Error(`Ungültige Eingabe für Operation ${id}: ${schemaComplaints(operation.schema, input)}`);
    }

    if (context.principal.kind === "operator") {
      if (operation.operator === "unavailable") {
        throw new Error(`Operation ${id} ist für den Bediener nicht verfügbar`);
      }
      if (operation.operator === "confirm") {
        const confirmation = "operatorConfirmation" in context ? context.operatorConfirmation : undefined;
        if (!confirmation
          || confirmation.operationId !== id
          || confirmation.invocationId !== context.invocationId
          || confirmation.inputHash !== canonicalHash(input)) {
          throw new Error(`Operation ${id} erfordert eine an diesen Aufruf gebundene Bestätigung`);
        }
      }
    }

    context.signal.throwIfAborted();
    const result = await operation.execute(context, input);
    if (!Value.Check(operation.resultSchema, result)) {
      throw new Error(`Ungültiges Ergebnis von Operation ${id}: ${schemaComplaints(operation.resultSchema, result, "result")}`);
    }
    assertJsonValue(result, `Operation ${id} output`);
    return result;
  }
}

export class AgentContributionRegistry {
  readonly #contributions = new ContributionRegistry<AgentContribution>("Agent-Beitrag");

  register(owner: string, contributions: readonly AgentContribution[]): void {
    for (const contribution of contributions) {
      if (!contribution.beforeModelCall && !contribution.afterToolCall) {
        throw new Error(`Agent-Beitrag ${contribution.id} hat keinen Hook`);
      }
    }
    this.#contributions.register(owner, contributions);
  }

  resolve(context: AgentContributionContext): readonly InlineExtension[] {
    return this.#contributions.entries().map(({ value }) => agentHookExtension(value, context));
  }

  describe(): readonly PublicAgentHookContribution[] {
    return this.#contributions.entries().map(({ owner, value }) => ({
      id: value.id,
      owner,
      kind: "plugin" as const,
      factories: [{ name: value.id, scope: "per-agent" as const }],
      resolvesPerAgent: true as const,
    }));
  }
}

export class ToolContributionRegistry {
  readonly #contributors: Owned<ToolContributor>[] = [];

  register(owner: string, contributors: readonly ToolContributor[]): void {
    for (const contributor of contributors) {
      const existing = this.#contributors.find((entry) => entry.value.name === contributor.name);
      if (existing) {
        throw new Error(`Werkzeugbeitrag ${contributor.name} wird bereits von ${existing.owner} bereitgestellt`);
      }
      this.#contributors.push({ owner, value: contributor });
    }
  }

  registerFunctions(owner: string, functions: readonly (RunFunction | ToolContributor)[]): void {
    for (const fn of functions) {
      if (!("run" in fn)) {
        this.register(owner, [fn]);
        continue;
      }
      this.register(owner, [{
        name: `${owner}:function:${fn.name}`,
        descriptors: [{
          name: fn.name,
          description: fn.description,
          scope: "per-turn",
          nativeTool: fn.nativeTool === true,
          ...describeToolAvailability(fn.available),
        }],
        tools: () => [fn],
      }]);
    }
  }

  entries(): readonly ToolContributor[] {
    return this.#contributors.map(({ value }) => value);
  }

  describe(): readonly PublicToolDescriptor[] {
    return this.#contributors.flatMap(({ owner, value }) => value.descriptors.map((tool) => ({
      id: `plugin:${owner}:${value.name}:${tool.name}`,
      owner,
      source: value.name,
      kind: "plugin" as const,
      ...tool,
      nativeTool: tool.nativeTool === true,
    })));
  }
}

export class PromptContributionRegistry {
  readonly #prompts = new ContributionRegistry<PromptContribution>("Prompt-Beitrag");

  register(owner: string, prompts: readonly PromptContribution[]): void {
    this.#prompts.register(owner, prompts);
  }

  async render(context: PromptRenderContext): Promise<string> {
    return (await this.snapshot(context)).content;
  }

  async snapshot(context: PromptRenderContext): Promise<PublicPromptSnapshot> {
    const contributions = await this.describe(context);
    return {
      content: contributions.map((entry) => entry.content).filter(Boolean).join("\n\n"),
      contributions,
    };
  }

  async describe(context: PromptRenderContext, selection?: {
    delivery: "initial" | "on-demand";
    toolNames: readonly string[];
  }): Promise<readonly PublicPromptContribution[]> {
    const entries = [...this.#prompts.entries()]
      .filter(({ value }) => !selection || (value.delivery ?? "initial") === selection.delivery
        && (value.requiresTools?.some((name) => selection.toolNames.includes(name)) ?? false))
      .sort((left, right) => left.value.order - right.value.order || left.value.id.localeCompare(right.value.id));
    return Promise.all(entries.map(async ({ owner, value }) => ({
      id: value.id,
      owner,
      order: value.order,
      delivery: value.delivery ?? "initial",
      content: (await value.render(context)).trim(),
      requiresTools: value.requiresTools ?? [],
    })));
  }

  /** Die Beiträge, die für diesen Run anders lauten als im Schnappschuss; alles andere bleibt der gerenderte Text. */
  runOverrides(runId: string): ReadonlyMap<string, string> {
    return new Map([...this.#prompts.entries()].flatMap(({ value }) =>
      value.renderForRun ? [[value.id, value.renderForRun(runId).trim()] as const] : []));
  }

  static handlebarsContext(context: PromptRenderContext): Record<string, unknown> {
    return {};
  }
}

export class SkillContributionRegistry {
  readonly #skills = new ContributionRegistry<SkillContribution>("Skill-Beitrag");

  register(owner: string, skills: readonly SkillContribution[]): void {
    for (const skill of skills) {
      const audiences = skill.audiences ?? [];
      if (new Set(audiences).size !== audiences.length) {
        throw new Error(`Skill-Beitrag ${skill.id} enthält eine Zielgruppe mehrfach`);
      }
      if (audiences.some((audience) => audience !== "coordinator" && audience !== "agent")) {
        throw new Error(`Skill-Beitrag ${skill.id} enthält eine ungültige Zielgruppe`);
      }
    }
    this.#skills.register(owner, skills);
  }

  global(): Promise<readonly string[]> {
    return this.resolve(undefined);
  }

  /** Ein Skillname bestimmt seinen Skill im ganzen Profil, auch über Zielgruppen hinweg; zwei Ordner gleichen Namens scheitern beim Start. */
  async assertUniqueNames(): Promise<void> {
    const paths = await this.global();
    for (const name of new Set(paths.map(skillNameOf))) {
      const named = paths.filter((entry) => skillNameOf(entry) === name);
      if (named.length > 1) throw new Error(`Der Skillname ${name} ist im Profil mehrfach vergeben: ${named.join(", ")}`);
    }
  }

  async resolve(context: AgentContributionContext | undefined): Promise<readonly string[]> {
    const paths = (await this.describe(context)).flatMap((entry) => entry.paths);
    const unique = new Set(paths);
    if (unique.size !== paths.length) throw new Error("Ein Agent-Skill-Pfad ist mehrfach registriert");
    return [...unique];
  }

  async describe(context: AgentContributionContext | undefined): Promise<readonly PublicSkillContribution[]> {
    const allAudiences = ["coordinator", "agent"] as const satisfies readonly AgentAudience[];
    const entries = this.#skills.entries().filter(({ value }) =>
      !context || !value.audiences || value.audiences.includes(context.audience));
    return Promise.all(entries.map(async ({ owner, value }) => ({
      id: value.id,
      owner,
      audiences: value.audiences ?? allAudiences,
      paths: await value.paths(context),
    })));
  }
}

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
const GUIDE_ID = /^[a-z0-9][a-z0-9.-]*$/;
const SCRIPT_HANDLE = /^[a-z0-9][a-z0-9-]*$/;

const requireText = (entry: { id: unknown }, value: unknown, field: string): void => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Vorlage ${String(entry.id)} hat kein gültiges ${field}`);
  }
};

const assertKnownFields = (entry: { id: unknown }, value: object, fields: readonly string[], label: string): void => {
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  if (unknown.length > 0) {
    throw new Error(`${label} ${String(entry.id)} enthält unbekannte Felder: ${unknown.join(", ")}`);
  }
};

const validateProgramFiles = (entry: StartEntryContribution, files: unknown): void => {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error(`Run-Script ${entry.id}: files braucht Paketdateien`);
  const names = new Set<string>();
  for (const file of files) {
    if (typeof file !== "object" || file === null || typeof file.path !== "string" || typeof file.content !== "string")
      throw new Error(`Run-Script ${entry.id}: jede Datei braucht path und content`);
    assertKnownFields(entry, file, ["path", "content"], "Paketdatei");
    if (!file.path || file.path.includes("\\") || file.path.includes("\0") || path.posix.isAbsolute(file.path)
      || file.path.split("/").some((part: string) => !part || part === "." || part === ".."))
      throw new Error(`Run-Script ${entry.id}: ungültiger Paketpfad ${file.path}`);
    if (names.has(file.path)) throw new Error(`Run-Script ${entry.id}: Datei ${file.path} ist doppelt`);
    names.add(file.path);
  }
  if (!names.has("package.json")) throw new Error(`Run-Script ${entry.id}: package.json fehlt`);
};

const validateScriptPackage = (entry: StartEntryContribution, script: unknown): void => {
  if (typeof script !== "object" || script === null)
    throw new Error(`Vorlage ${entry.id} hat kein Run-Script-Paket`);
  assertKnownFields(entry, script, ["handle", "coordinator", "files", "programs"], "Run-Script");
  const value = script as Record<string, unknown>;
  if (typeof value.handle !== "string" || !SCRIPT_HANDLE.test(value.handle))
    throw new Error(`Run-Script ${entry.id}: handle muss ein Handle wie gespraechsrunde sein (Kleinbuchstaben, Ziffern, Bindestrich)`);
  if (typeof value.coordinator !== "boolean")
    throw new Error(`Run-Script ${entry.id}: coordinator muss true oder false sein`);
  validateProgramFiles(entry, value.files);
  if (!Array.isArray(value.programs)) throw new Error(`Run-Script ${entry.id}: programs muss eine Liste sein`);
  const names = new Set<string>();
  for (const program of value.programs) {
    if (typeof program !== "object" || program === null || typeof program.name !== "string" || !SCRIPT_HANDLE.test(program.name))
      throw new Error(`Run-Script ${entry.id}: ungültiger Programmname`);
    assertKnownFields(entry, program, ["name", "files"], "Actor-Programm");
    if (program.name === value.handle || names.has(program.name))
      throw new Error(`Run-Script ${entry.id}: Programm ${program.name} ist doppelt`);
    names.add(program.name);
    validateProgramFiles(entry, program.files);
  }
};

const validateFixedStartOptions = (entry: StartEntryContribution): void => {
  const fixed: unknown = entry.fixedStartOptions;
  if (fixed === undefined) return;
  if (typeof fixed !== "object" || fixed === null || Array.isArray(fixed) || Object.keys(fixed).length === 0) {
    throw new Error(`Vorlage ${entry.id}: fixedStartOptions muss mindestens eine Startoption auf einen Wert festlegen`);
  }
  for (const [optionId, value] of Object.entries(fixed)) {
    if (!START_OPTION_ID.test(optionId)) throw new Error(`Vorlage ${entry.id} legt die ungültige Startoption-Id ${optionId} fest`);
    assertJsonValue(value, `Vorlage ${entry.id}: fixedStartOptions.${optionId}`);
  }
};

const validateStartEntry = (entry: StartEntryContribution): void => {
  const base = ["id", "title", "description", "order", "guide", "tags", "fixedStartOptions", "action"];
  for (const field of ["id", "title", "description"] as const) requireText(entry, entry[field], field);
  if (entry.order !== undefined && (typeof entry.order !== "number" || !Number.isFinite(entry.order))) {
    throw new Error(`Vorlage ${entry.id} hat keine gültige Ordnungszahl`);
  }
  if (entry.guide !== undefined && (typeof entry.guide !== "string" || !GUIDE_ID.test(entry.guide))) {
    throw new Error(`Vorlage ${entry.id} nennt keine gültige Leitfaden-Kennung: ${String(entry.guide)}`);
  }
  if (entry.tags !== undefined && (!Array.isArray(entry.tags)
    || entry.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag !== tag.trim())
    || new Set(entry.tags).size !== entry.tags.length)) {
    throw new Error(`Vorlage ${entry.id}: tags müssen eindeutige, nicht leere Schlagworte sein`);
  }
  validateFixedStartOptions(entry);
  switch (entry.action) {
    case "skill":
      assertKnownFields(entry, entry, [...base, "skill", "prompt", "category"], "Vorlage");
      requireText(entry, entry.category, "category");
      if (entry.category !== entry.category.trim()) throw new Error(`Vorlage ${entry.id}: category muss ein einzelner nicht leerer Text sein`);
      requireText(entry, entry.prompt, "prompt");
      requireText(entry, entry.skill, "skill");
      if (!SKILL_NAME.test(entry.skill)) {
        throw new Error(`Vorlage ${entry.id} nennt keinen gültigen Skill-Namen: ${entry.skill}`);
      }
      return;
    case "script":
      assertKnownFields(entry, entry, [...base, "script", "category"], "Vorlage");
      if (entry.category !== undefined && (typeof entry.category !== "string" || !entry.category.trim() || entry.category !== entry.category.trim())) {
        throw new Error(`Vorlage ${entry.id}: category muss ein einzelner nicht leerer Text sein`);
      }
      validateScriptPackage(entry, entry.script);
      return;
    default:
      throw new Error(
        `Vorlage ${String((entry as { id: unknown }).id)} hat die unbekannte Aktion ${String((entry as { action: unknown }).action)}; `
        + "gültig sind skill und script",
      );
  }
};

/** Der Name eines Skills ist der Name seines Ordners. */
const skillNameOf = (directory: string): string => directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "";

const byOrderThenId = (left: { order?: number; id: string }, right: { order?: number; id: string }): number =>
  (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id);

/** Skills with a start prompt and executable run scripts share one registry. */
export class StartEntryContributionRegistry {
  readonly #entries = new ContributionRegistry<StartEntryContribution>("Vorlage");

  register(owner: string, entries: readonly StartEntryContribution[]): void {
    for (const entry of entries) validateStartEntry(entry);
    this.#entries.register(owner, entries);
  }

  assertSkillsKnown(skills: readonly PublicSkillContribution[]): void {
    const names = new Set(skills.flatMap((skill) => skill.paths.map(skillNameOf)));
    for (const { owner, value } of this.#entries.entries()) {
      if (value.action === "skill" && !names.has(value.skill)) {
        throw new Error(`Vorlage ${value.id} von ${owner} verweist auf den unbekannten Skill ${value.skill}`);
      }
    }
  }

  /** Jede festgelegte Startoption muss registriert sein und ihr Wert ihrem Schema genügen; ob er angenommen wird, entscheidet erst der Start. */
  assertFixedStartOptionsKnown(startOptions: StartOptionContributionRegistry): void {
    for (const { owner, value } of this.#entries.entries()) {
      for (const [optionId, fixed] of Object.entries(value.fixedStartOptions ?? {})) {
        if (!startOptions.entry(optionId)) {
          throw new Error(`Vorlage ${value.id} von ${owner} legt die nicht registrierte Startoption ${optionId} fest`);
        }
        startOptions.assertValue(optionId, fixed, `festgelegter Wert der Vorlage ${value.id}`);
      }
    }
  }

  describe(): readonly PublicStartEntry[] {
    return this.#entries
      .entries()
      .map(({ owner, value }): PublicStartEntry => {
        const base = {
          id: value.id,
          owner,
          title: value.title,
          description: value.description,
          ...(value.order !== undefined ? { order: value.order } : {}),
          ...(value.guide !== undefined ? { guide: value.guide } : {}),
          ...(value.tags !== undefined ? { tags: [...value.tags] } : {}),
          ...(value.fixedStartOptions !== undefined ? { fixedStartOptions: structuredClone(value.fixedStartOptions) } : {}),
        };
        switch (value.action) {
          case "skill":
            return { ...base, action: "skill", skill: value.skill, category: value.category, prompt: value.prompt };
          case "script":
            return { ...base, action: "script", coordinator: value.script.coordinator, ...(value.category !== undefined ? { category: value.category } : {}) };
        }
      })
      .sort(byOrderThenId);
  }

  /** Eine Vorlage, wie das Web sie sieht; undefined für eine unbekannte Kennung. */
  entry(entryId: string): PublicStartEntry | undefined {
    return this.describe().find((candidate) => candidate.id === entryId);
  }

  /** The run script behind a script template; undefined for unknown ids and templates of another action. */
  scriptPackage(entryId: string): (RunScriptPackage & { entry: PublicStartEntry }) | undefined {
    const found = this.#entries.entries().find(({ value }) => value.id === entryId);
    if (!found || found.value.action !== "script") return undefined;
    const entry = this.entry(entryId);
    if (!entry) return undefined;
    return { ...found.value.script, entry };
  }
}

export class ProfileContributionRegistry {
  readonly #profiles = new ContributionRegistry<ProfileContribution>("Profil-Beitrag");

  register(owner: string, contributions: readonly ProfileContribution[]): void {
    this.#profiles.register(owner, contributions);
  }

  models(): readonly CatalogModel[] {
    const models = this.#profiles.entries().flatMap(({ value }) => value.models());
    const keys = models.map((model) => `${model.driver}:${model.provider}:${model.model}`);
    if (new Set(keys).size !== keys.length) throw new Error("Ein Modell ist mehrfach registriert");
    return models;
  }

  profiles(): readonly AgentProfile[] {
    const profiles = this.#profiles.entries().flatMap(({ value }) => value.profiles());
    const names = profiles.map((profile) => profile.name);
    if (new Set(names).size !== names.length) throw new Error("Ein Agentenprofil ist mehrfach registriert");
    return profiles;
  }

  async providers(): Promise<readonly ModelProviderRegistration[]> {
    const registrations = (await Promise.all(this.#profiles.entries().map(({ value }) => value.providers?.() ?? []))).flat();
    const ids = registrations.map((registration) => registration.id);
    if (new Set(ids).size !== ids.length) throw new Error("Ein Modellanbieter ist mehrfach registriert");
    return registrations;
  }
}

export class ScriptContributionRegistry {
  readonly #script = new ContributionRegistry<ScriptContribution>("Logik-Beitrag");

  register(owner: string, contributions: readonly ScriptContribution[]): void {
    this.#script.register(owner, contributions);
  }

  create(context: ScriptFactoryContext): ScriptRuntime | undefined {
    const entries = this.#script.entries();
    if (entries.length > 1) {
      throw new Error(`Die Engine verträgt höchstens einen Logik-Beitrag, registriert sind ${entries.length}`);
    }
    return entries[0]?.value.create(context);
  }
}

type SessionStopAttempt = {
  bounded: Promise<void>;
  settled: Promise<void>;
  result: PromiseSettledResult<void> | undefined;
  timeoutError: Error | undefined;
};

type ContributionStopOperation = {
  bounded: Promise<void>;
  settled: Promise<void>;
  isSettled: () => boolean;
  release: () => void;
};

export interface PluginStopOperation {
  bounded: Promise<void>;
  settled: Promise<void>;
  release: () => void;
}

export class LifecycleContributionRegistry {
  readonly #lifecycle = new ContributionRegistry<SessionLifecycleContribution>("Lifecycle-Beitrag");
  readonly #stopTimeoutMs: number;
  readonly #stopAttempts = new Map<string, SessionStopAttempt>();

  constructor(options: { stopTimeoutMs?: number } = {}) {
    const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_PLUGIN_STOP_TIMEOUT_MS;
    if (!Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1) {
      throw new Error("Die Plugin-Stopp-Zeitgrenze muss eine positive ganze Zahl sein");
    }
    this.#stopTimeoutMs = stopTimeoutMs;
  }

  register(owner: string, contributions: readonly SessionLifecycleContribution[]): void {
    this.#lifecycle.register(owner, contributions);
  }

  async initialize(): Promise<void> {
    for (const { value } of this.#lifecycle.entries()) await value.initialize?.();
  }

  async prepareSession(runId: string): Promise<void> {
    for (const { value } of this.#lifecycle.entries()) await value.prepareSession?.({ runId });
  }

  beginStopSession(runId: string): PluginStopOperation {
    return this.#beginStopPhase(runId, "stopSession");
  }

  beginAfterStopSession(runId: string): PluginStopOperation {
    return this.#beginStopPhase(runId, "afterStopSession");
  }

  #beginStopPhase(runId: string, phase: "stopSession" | "afterStopSession"): PluginStopOperation {
    const contributions = [...this.#lifecycle.entries()].reverse()
      .flatMap(({ value }) => value[phase] ? [this.#beginStopContribution(value, runId, phase)] : []);
    const bounded = this.#settleParallel("Plugin-Stopp", contributions.map(({ bounded: promise }) => promise));
    const settled = this.#settleParallel("Plugin-Stopp-Nachlauf", contributions.map(({ settled: promise }) => promise));

    return {
      bounded,
      settled,
      release: () => {
        if (contributions.some((contribution) => !contribution.isSettled())) {
          throw new Error(`Plugin-Stopp für ${runId} kann vor dem Ende aller Beiträge nicht freigegeben werden`);
        }
        contributions.forEach((contribution) => contribution.release());
      },
    };
  }

  stopSession(runId: string): Promise<void> {
    const operation = this.beginStopSession(runId);
    void operation.settled.then(
      () => operation.release(),
      () => operation.release(),
    );
    return operation.bounded;
  }

  async deleteSession(runId: string): Promise<void> {
    const pendingStops = [...this.#stopAttempts.entries()]
      .filter(([key]) => key.startsWith(`${runId}\0`))
      .map(([, attempt]) => attempt.settled);
    await Promise.allSettled(pendingStops);
    await this.#settle("Plugin-Löschung", [...this.#lifecycle.entries()].reverse()
      .map(({ value }) => () => value.deleteSession?.({ runId })));
    this.#releaseStopAttempts(runId);
  }

  shutdown(): Promise<void> {
    const pendingStops = [...new Set([...this.#stopAttempts.values()].map((attempt) => attempt.settled))];
    return this.#settle("Plugin-Shutdown", [
      ...[...this.#lifecycle.entries()].reverse().map(({ value }) => () => value.shutdown?.()),
      ...pendingStops.map((settled) => () => settled),
    ]);
  }

  async #settleParallel(name: string, operations: readonly Promise<void>[]): Promise<void> {
    const results = await Promise.allSettled(operations);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, `${name} ist in ${failures.length} Plugin(s) fehlgeschlagen`);
  }

  #beginStopContribution(
    contribution: SessionLifecycleContribution,
    runId: string,
    phase: "stopSession" | "afterStopSession",
  ): ContributionStopOperation {
    const stopSession = contribution[phase];
    if (!stopSession) throw new Error(`Lifecycle-Beitrag ${contribution.id} hat keinen Stopp-Hook`);
    const key = `${runId}\0${phase}\0${contribution.id}`;
    const existing = this.#stopAttempts.get(key);
    if (existing) {
      return this.#contributionStopOperation(key, existing);
    }

    const controller = new AbortController();
    const attempt: SessionStopAttempt = {
      bounded: Promise.resolve(),
      settled: Promise.resolve(),
      result: undefined,
      timeoutError: undefined,
    };
    attempt.settled = Promise.resolve().then(() => stopSession({ runId, signal: controller.signal }));
    void attempt.settled.then(
      () => {
        attempt.result = { status: "fulfilled", value: undefined };
      },
      (reason) => {
        attempt.result = { status: "rejected", reason };
      },
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(
          `Plugin-Stopp ${contribution.id} (${phase}) hat die Zeitgrenze von ${this.#stopTimeoutMs} ms überschritten`,
        );
        attempt.timeoutError = error;
        controller.abort(error);
        reject(error);
      }, this.#stopTimeoutMs);
    });
    attempt.bounded = Promise.race([attempt.settled, deadline]);
    this.#stopAttempts.set(key, attempt);
    void attempt.bounded.then(
      () => { if (timeout) clearTimeout(timeout); },
      () => { if (timeout) clearTimeout(timeout); },
    );
    return this.#contributionStopOperation(key, attempt);
  }

  #contributionStopOperation(key: string, attempt: SessionStopAttempt): ContributionStopOperation {
    const bounded = attempt.result?.status === "fulfilled"
      ? Promise.resolve()
      : attempt.result?.status === "rejected"
        ? Promise.reject(attempt.result.reason)
        : attempt.timeoutError
          ? Promise.reject(attempt.timeoutError)
          : attempt.bounded;

    return {
      bounded,
      settled: attempt.settled,
      isSettled: () => attempt.result !== undefined,
      release: () => {
        if (this.#stopAttempts.get(key) === attempt) this.#stopAttempts.delete(key);
      },
    };
  }

  #releaseStopAttempts(runId: string): void {
    for (const key of this.#stopAttempts.keys()) {
      if (key.startsWith(`${runId}\0`)) this.#stopAttempts.delete(key);
    }
  }

  async #settle(name: string, operations: ReadonlyArray<() => void | Promise<void> | undefined>): Promise<void> {
    const failures: unknown[] = [];
    for (const operation of operations) {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, `${name} ist in ${failures.length} Plugin(s) fehlgeschlagen`);
  }
}

const WORKSPACE_NOT_ACCESSIBLE = "Der Arbeitsbereich dieses Runs ist für diesen Zugang nicht erreichbar.";

export class SessionMetadataContributionRegistry {
  readonly #metadata = new ContributionRegistry<SessionMetadataContribution>("Run-Metadaten-Beitrag");

  register(owner: string, contributions: readonly SessionMetadataContribution[]): void {
    this.#metadata.register(owner, contributions);
  }

  /** Alle Beiträge zugleich; wer nicht innerhalb von `timeoutMs` antwortet oder scheitert, verliert nur seinen Wert und nennt den Grund. */
  async describe(runId: string, workspaceAccessible: boolean, timeoutMs: number): Promise<SessionMetadata> {
    type Outcome = { readonly id: string; readonly value: unknown } | { readonly id: string; readonly reason: string };
    const outcomes = await Promise.all(this.#metadata.entries().map(async ({ value }): Promise<Outcome> => {
      if (value.requiresWorkspace === true && !workspaceAccessible) return { id: value.id, reason: WORKSPACE_NOT_ACCESSIBLE };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const silent = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`keine Antwort nach ${timeoutMs} ms`)), timeoutMs);
      });
      try {
        return { id: value.id, value: await Promise.race([Promise.resolve().then(() => value.describe({ runId })), silent]) };
      } catch (error) {
        return { id: value.id, reason: error instanceof Error ? error.message : String(error) };
      } finally {
        clearTimeout(timer);
      }
    }));
    return {
      values: Object.fromEntries(outcomes.flatMap((outcome) => "value" in outcome ? [[outcome.id, outcome.value] as const] : [])),
      unavailable: Object.fromEntries(outcomes.flatMap((outcome) => "reason" in outcome ? [[outcome.id, outcome.reason] as const] : [])),
    };
  }
}

export class StartOptionContributionRegistry {
  readonly #options = new ContributionRegistry<StartOptionContribution>("Startoption");

  register(owner: string, contributions: readonly StartOptionContribution[]): void {
    for (const contribution of contributions) {
      if (!START_OPTION_ID.test(contribution.id)) throw new Error(`Ungültige Startoption-Id: ${contribution.id}`);
      if (typeof contribution.schema !== "object" || contribution.schema === null) {
        throw new Error(`Startoption ${contribution.id} hat kein Schema`);
      }
      for (const name of ["selectable", "defaultValue", "accept", "describe"] as const) {
        if (typeof contribution[name] !== "function") throw new Error(`Startoption ${contribution.id} hat kein ${name}`);
      }
      if (contribution.ownerOnly !== undefined && typeof contribution.ownerOnly !== "function") {
        throw new Error(`Startoption ${contribution.id} hat ein ungültiges ownerOnly`);
      }
      if (contribution.rights !== undefined && (!Array.isArray(contribution.rights) || !contribution.rights.every(isAccessRight))) {
        throw new Error(`Startoption ${contribution.id} hat ungültige rights`);
      }
      if (contribution.changeable !== undefined && typeof contribution.changeable !== "boolean") {
        throw new Error(`Startoption ${contribution.id} hat ein ungültiges changeable`);
      }
    }
    this.#options.register(owner, contributions);
  }

  entries(): readonly RegisteredStartOption[] {
    return this.#options.entries().map(({ owner, value }) => ({ owner, option: value }));
  }

  entry(id: string): RegisteredStartOption | undefined {
    const found = this.#options.entries().find(({ value }) => value.id === id);
    return found ? { owner: found.owner, option: found.value } : undefined;
  }

  describe(): readonly { id: string; owner: string }[] {
    return this.#options.entries().map(({ owner, value }) => ({ id: value.id, owner }));
  }

  /** Das erste Recht der Option, das dem Zugang fehlt; eine unbekannte Option verlangt keins. */
  missingRight(id: string, access: Pick<AccessContext, "can">): string | undefined {
    return this.entry(id)?.option.rights?.find((right) => !access.can(right));
  }

  assertRights(id: string, access: Pick<AccessContext, "can">): void {
    const missing = this.missingRight(id, access);
    if (missing) throw new DomainError("access-denied", `Das Recht ${missing} fehlt für die Startoption ${id}.`, 403);
  }

  defaultValue(id: string, context: StartOptionContext): JsonValue {
    const { option } = this.#require(id);
    const value = option.defaultValue(context);
    this.#check(option, value, "Standardwert");
    return value;
  }

  accept(id: string, value: unknown, context: StartOptionContext): JsonValue {
    const { option } = this.#require(id);
    assertJsonValue(value, `Startoption ${id} value`);
    this.#check(option, value, "Wert");
    const accepted = option.accept(value, context);
    this.#check(option, accepted, "Ergebnis von accept");
    return accepted;
  }

  /** Prüft einen Wert gegen das Schema der Option, ohne ihn anzunehmen. */
  assertValue(id: string, value: unknown, label: string): void {
    this.#check(this.#require(id).option, value, label);
  }

  #require(id: string): RegisteredStartOption {
    const entry = this.entry(id);
    if (!entry) throw new Error(`Startoption ${id} ist nicht registriert`);
    return entry;
  }

  #check(option: StartOptionContribution, value: unknown, label: string): void {
    if (Value.Check(option.schema, value)) return;
    throw new Error(`Ungültiger ${label} für Startoption ${option.id}: ${schemaComplaints(option.schema, value, "value")}`);
  }
}

export class ConfigContributionRegistry {
  readonly #entries: Array<{ owners: string[]; value: PluginConfigDescriptor }> = [];

  register(owner: string, descriptors: readonly PluginConfigDescriptor[]): void {
    for (const descriptor of descriptors) {
      const existing = this.#entries.find((entry) => entry.value.key === descriptor.key);
      if (!existing) {
        this.#entries.push({ owners: [owner], value: descriptor });
        continue;
      }
      if (existing.value.source !== descriptor.source || Boolean(existing.value.secret) !== Boolean(descriptor.secret)) {
        throw new Error(`Konfiguration ${descriptor.key} ist widersprüchlich deklariert`);
      }
      if (existing.owners.includes(owner)) {
        throw new Error(`Konfiguration ${descriptor.key} ist in ${owner} mehrfach deklariert`);
      }
      existing.owners.push(owner);
    }
  }

  entries(): readonly PluginConfigDescriptor[] {
    return this.#entries.map(({ value }) => value);
  }

  secretKeys(): readonly string[] {
    return this.#entries
      .filter(({ value }) => value.secret)
      .map(({ value }) => value.key);
  }

  publicEntries(owner: string): readonly PublicPluginConfigDescriptor[] {
    return this.#entries
      .filter((entry) => entry.owners.includes(owner))
      .map(({ value }) => ({
        key: value.key,
        source: value.secret ? "environment" : value.source,
        secret: Boolean(value.secret),
      }));
  }
}

const joinSafe = (base: string, segments: readonly string[]): string => {
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || path.isAbsolute(segment)
      || segment.includes("/") || segment.includes("\\")) {
      throw new Error(`Ungültiges Plugin-Speichersegment: ${segment}`);
    }
  }
  return path.join(base, ...segments);
};

export class StorageRegistry {
  readonly #dataDirectory: string;
  readonly #modes: PluginStorageModes;
  readonly #scopes = new Map<string, PluginStorage>();

  constructor(dataDirectory: string, modes: PluginStorageModes) {
    this.#dataDirectory = dataDirectory;
    this.#modes = Object.freeze({ ...modes });
  }

  register(manifest: PluginManifest): PluginStorage {
    if (this.#scopes.has(manifest.id)) throw new Error(`Speicher für ${manifest.id} ist bereits registriert`);
    const pluginDirectory = path.join("plugins", manifest.id);
    const scope: PluginStorage = Object.freeze({
      sessionsRoot: path.join(this.#dataDirectory, "sessions"),
      modes: this.#modes,
      root: (...segments: string[]) => joinSafe(path.join(this.#dataDirectory, pluginDirectory), segments),
      session: (runId: string, ...segments: string[]) => {
        if (!RUN_ID.test(runId)) throw new Error(`Ungültige Run-ID: ${runId}`);
        return joinSafe(path.join(this.#dataDirectory, "sessions", runId, pluginDirectory), segments);
      },
    });
    this.#scopes.set(manifest.id, scope);
    return scope;
  }

  of(pluginId: string): PluginStorage {
    const scope = this.#scopes.get(pluginId);
    if (!scope) throw new Error(`Speicher für ${pluginId} ist nicht registriert`);
    return scope;
  }
}

class ClientConfigRegistry {
  readonly #values = new Map<string, Record<string, unknown>>();

  register(owner: string, values: Readonly<Record<string, unknown>>): void {
    const existing = this.#values.get(owner) ?? {};
    for (const key of Object.keys(values)) {
      if (Object.hasOwn(existing, key)) {
        throw new Error(`Client-Konfiguration ${key} ist in ${owner} mehrfach gesetzt`);
      }
    }
    this.#values.set(owner, { ...existing, ...values });
  }

  valuesFor(owner: string): Readonly<Record<string, unknown>> | undefined {
    return this.#values.get(owner);
  }
}

class ServiceRegistry {
  readonly #services = new Map<string, { owner: string; value: unknown }>();

  provide<T>(owner: string, token: ServiceToken<T>, service: T): void {
    const existing = this.#services.get(token.id);
    if (existing) throw new Error(`Service ${token.id} wird bereits von ${existing.owner} bereitgestellt`);
    this.#services.set(token.id, { owner, value: service });
  }

  require<T>(token: ServiceToken<T>): T {
    const entry = this.#services.get(token.id);
    if (!entry) throw new Error(`Erforderlicher Plugin-Service ${token.id} ist nicht registriert`);
    return entry.value as T;
  }

  optional<T>(token: ServiceToken<T>): T | undefined {
    return this.#services.get(token.id)?.value as T | undefined;
  }
}

export interface PluginHostOptions {
  product: ProductDescriptor;
  dataDirectory: string;
  storageModes: PluginStorageModes;
  /** The entry a new run takes by default; must be registered by a plugin of the profile. */
  defaultStartEntry?: string;
}

const HOST_OWNER = "host";

export class PluginHost {
  readonly methods = new MethodContributionRegistry();
  readonly channels = new ChannelContributionRegistry();
  readonly http = new HttpContributionRegistry();
  readonly operations = new OperationContributionRegistry();
  readonly agentRuntime = new AgentContributionRegistry();
  readonly tools = new ToolContributionRegistry();
  readonly prompts = new PromptContributionRegistry();
  readonly skills = new SkillContributionRegistry();
  readonly startEntries = new StartEntryContributionRegistry();
  readonly profiles = new ProfileContributionRegistry();
  readonly script = new ScriptContributionRegistry();
  readonly lifecycle = new LifecycleContributionRegistry();
  readonly sessionMetadata = new SessionMetadataContributionRegistry();
  readonly startOptions = new StartOptionContributionRegistry();
  readonly config = new ConfigContributionRegistry();
  readonly storage: StorageRegistry;
  readonly #product: ProductDescriptor;
  readonly #defaultStartEntry: string | undefined;
  readonly #services = new ServiceRegistry();
  readonly #clientConfig = new ClientConfigRegistry();
  readonly #manifests: PluginManifest[] = [];
  #sealed = false;

  constructor(options: PluginHostOptions) {
    this.#product = Object.freeze({ ...options.product });
    this.#defaultStartEntry = options.defaultStartEntry;
    this.storage = new StorageRegistry(options.dataDirectory, options.storageModes);
  }

  provideHost<T>(token: ServiceToken<T>, service: T): void {
    this.#services.provide(HOST_OWNER, token, service);
  }

  register(plugin: RAgentsPlugin): this {
    if (this.#sealed) throw new Error("Nach dem Start können keine Plugins mehr registriert werden");
    const { manifest } = plugin;
    if (!PLUGIN_ID.test(manifest.id)) throw new Error(`Ungültige Plugin-Id: ${manifest.id}`);
    if (this.#manifests.some((entry) => entry.id === manifest.id)) {
      throw new Error(`Plugin ${manifest.id} ist bereits registriert`);
    }
    this.#manifests.push(manifest);
    const storage = this.storage.register(manifest);
    const registration: PluginRegistration = {
      manifest,
      storage,
      clientConfig: (values) => this.#clientConfig.register(manifest.id, values),
      config: (...entries) => this.config.register(manifest.id, entries),
      channels: (...entries) => this.channels.register(manifest.id, entries),
      methods: (...entries) => this.methods.register(manifest.id, entries),
      http: (...entries) => this.http.register(manifest.id, entries),
      lifecycle: (...entries) => this.lifecycle.register(manifest.id, entries),
      operation: (id) => this.operations.operation(id),
      operations: (...entries) => this.operations.register(manifest.id, entries),
      invokeOperation: (id, context, input) => this.operations.invoke(id, context, input),
      agentRuntime: (...entries) => this.agentRuntime.register(manifest.id, entries),
      profiles: (...entries) => this.profiles.register(manifest.id, entries),
      prompts: (...entries) => this.prompts.register(manifest.id, entries),
      provide: (token, service) => this.#services.provide(manifest.id, token, service),
      service: (token) => this.#services.require(token),
      optionalService: (token) => this.#services.optional(token),
      sessionMetadata: (...entries) => this.sessionMetadata.register(manifest.id, entries),
      skills: (...entries) => this.skills.register(manifest.id, entries),
      startEntries: (...entries) => this.startEntries.register(manifest.id, entries),
      startOptions: (...entries) => this.startOptions.register(manifest.id, entries),
      functions: (...entries) => this.tools.registerFunctions(manifest.id, entries),
      script: (...entries) => this.script.register(manifest.id, entries),
    };
    plugin.register(registration);
    return this;
  }

  seal(): void {
    if (this.#sealed) return;
    const positions = new Map(this.#manifests.map((manifest, index) => [manifest.id, index]));
    for (const [index, manifest] of this.#manifests.entries()) {
      for (const dependency of manifest.requires ?? []) {
        const position = positions.get(dependency);
        if (position === undefined) throw new Error(`Plugin ${manifest.id} benötigt das fehlende Plugin ${dependency}`);
        if (position >= index) throw new Error(`Plugin ${dependency} muss vor ${manifest.id} registriert werden`);
      }
    }
    this.startEntries.assertFixedStartOptionsKnown(this.startOptions);
    const defaultStartEntry = this.#defaultStartEntry;
    if (defaultStartEntry !== undefined) {
      const entries = this.startEntries.describe().map((entry) => entry.id);
      if (!entries.includes(defaultStartEntry)) {
        throw new Error(`defaultStartEntry ${defaultStartEntry} ist keine registrierte Vorlage; `
          + (entries.length > 0 ? `registriert sind ${entries.join(", ")}` : "kein Plugin dieses Profils registriert Vorlagen"));
      }
    }
    this.#sealed = true;
  }

  async initialize(): Promise<void> {
    this.seal();
    this.startEntries.assertSkillsKnown(await this.skills.describe(undefined));
    await this.skills.assertUniqueNames();
    await this.lifecycle.initialize();
  }

  publicProfile(access: AccessContext = unrestrictedAccess): PublicPluginProfile {
    this.seal();
    const startEntries = this.startEntries.describe().filter((entry) => canStartEntry(access, entry.id)
      && (entry.action === "script" || access.can("runs.create")));
    const defaultStartEntry = this.#defaultStartEntry;
    return {
      product: this.#product,
      startEntries,
      ...(defaultStartEntry !== undefined && startEntries.some((entry) => entry.id === defaultStartEntry) ? { defaultStartEntry } : {}),
      plugins: this.#manifests.map((manifest) => {
        const config = this.#mergedClientConfig(manifest);
        return {
          id: manifest.id,
          ...(manifest.web ? { web: manifest.web } : {}),
          ...(config ? { config } : {}),
        };
      }),
    };
  }

  publicManifests(): readonly PublicPluginManifest[] {
    this.seal();
    return this.#manifests.map((manifest) => {
      const clientConfig = this.#mergedClientConfig(manifest);
      return {
        id: manifest.id,
        requires: [...(manifest.requires ?? [])],
        ...(clientConfig ? { clientConfig } : {}),
        configuration: this.config.publicEntries(manifest.id),
      };
    });
  }

  #mergedClientConfig(manifest: PluginManifest): Readonly<Record<string, unknown>> | undefined {
    const registered = this.#clientConfig.valuesFor(manifest.id);
    const declared = manifest.client?.config;
    if (!declared && !registered) return undefined;
    return { ...(declared ?? {}), ...(registered ?? {}) };
  }

  isApiPath(pathname: string): boolean {
    return pathname === "/api/plugins" || this.http.isApiPath(pathname);
  }

  async dispatchHttp(request: IncomingMessage, response: ServerResponse, url: URL, access: AccessContext = unrestrictedAccess): Promise<boolean> {
    if (request.method === "GET" && url.pathname === "/api/plugins") {
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
      response.end(JSON.stringify(this.publicProfile(access)));
      return true;
    }
    return this.http.dispatch(request, response, url, access);
  }

  scriptRuntime(context: ScriptFactoryContext): ScriptRuntime | undefined {
    this.seal();
    return this.script.create(context);
  }

  service<T>(token: ServiceToken<T>): T {
    return this.#services.require(token);
  }

  optionalService<T>(token: ServiceToken<T>): T | undefined {
    return this.#services.optional(token);
  }
}
