import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { agentHookOf, type AgentHook } from "./drivers/agent-hooks.ts";
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
import type { PluginState } from "./domain/model.ts";
import type {
  AccessProjectionContribution,
  AgentAudience,
  HttpRouteContribution,
  OperationContext,
  OperationContribution,
  RegisteredOperationDescriptor,
  AgentContribution,
  AgentContributionContext,
  PluginChatEvent,
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
  RunCondition,
  SessionLifecycleContribution,
  SessionMetadata,
  SessionStartedContext,
  SessionMetadataContribution,
  SkillContribution,
  RunScriptPackage,
  StartEntryContribution,
  ActorPackageContribution,
  ActorProgramFile,
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
        throw new Error(`${this.#kind} ${value.id} is already provided by ${existing.owner}`);
      }
      this.#entries.push({ owner, value });
    }
  }

  entries(): readonly Owned<T>[] {
    return this.#entries;
  }
}

/** The run condition per plugin; a plugin without one applies in every run. */
export class RunConditionRegistry {
  readonly #conditions = new Map<string, RunCondition>();

  register(owner: string, condition: RunCondition): void {
    if (this.#conditions.has(owner)) throw new Error(`Plugin ${owner} already has a run condition`);
    this.#conditions.set(owner, condition);
  }

  has(owner: string): boolean {
    return this.#conditions.has(owner);
  }

  applies(owner: string, runId: string): boolean {
    return this.#conditions.get(owner)?.(runId) ?? true;
  }
}

export class MethodContributionRegistry {
  readonly #methods = new ContributionRegistry<{ id: string; contribution: MethodContribution }>("Method");

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
  readonly #channels = new ContributionRegistry<{ id: string; contribution: ChannelContribution }>("Channel");

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
      response.end(JSON.stringify({ error: `The right ${missing} is missing.`, code: "access-denied", right: missing }));
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
      if (!OPERATION_ID.test(operation.id)) throw new Error(`Invalid operation id: ${operation.id}`);
      if (!operation.label.trim()) throw new Error(`Operation ${operation.id} has no label`);
      if (!operation.description.trim()) throw new Error(`Operation ${operation.id} has no description`);
      if (operation.operator !== "direct" && operation.operator !== "confirm" && operation.operator !== "unavailable") {
        throw new Error(`Operation ${operation.id} has an invalid operator policy`);
      }
      if (typeof operation.execute !== "function") throw new Error(`Operation ${operation.id} has no execute function`);
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
    if (!operation) throw new Error(`Operation ${id} is not registered`);
    assertJsonValue(input, `Operation ${id} input`);

    if (!Value.Check(operation.schema, input)) {
      throw new Error(`Invalid input for operation ${id}: ${schemaComplaints(operation.schema, input)}`);
    }

    if (context.principal.kind === "operator") {
      if (operation.operator === "unavailable") {
        throw new Error(`Operation ${id} is not available to the operator`);
      }
      if (operation.operator === "confirm") {
        const confirmation = "operatorConfirmation" in context ? context.operatorConfirmation : undefined;
        if (!confirmation
          || confirmation.operationId !== id
          || confirmation.invocationId !== context.invocationId
          || confirmation.inputHash !== canonicalHash(input)) {
          throw new Error(`Operation ${id} requires a confirmation bound to this call`);
        }
      }
    }

    context.signal.throwIfAborted();
    const result = await operation.execute(context, input);
    if (!Value.Check(operation.resultSchema, result)) {
      throw new Error(`Invalid result of operation ${id}: ${schemaComplaints(operation.resultSchema, result, "result")}`);
    }
    assertJsonValue(result, `Operation ${id} output`);
    return result;
  }
}

export class AgentContributionRegistry {
  readonly #contributions = new ContributionRegistry<AgentContribution>("Agent contribution");
  readonly #conditions: RunConditionRegistry;

  constructor(conditions = new RunConditionRegistry()) {
    this.#conditions = conditions;
  }

  register(owner: string, contributions: readonly AgentContribution[]): void {
    for (const contribution of contributions) {
      if (!contribution.beforeModelCall && !contribution.afterToolCall) {
        throw new Error(`Agent contribution ${contribution.id} has no hook`);
      }
    }
    this.#contributions.register(owner, contributions);
  }

  resolve(context: AgentContributionContext): readonly AgentHook[] {
    return this.#contributions.entries()
      .filter(({ owner }) => this.#conditions.applies(owner, context.runId))
      .map(({ value }) => agentHookOf(value, context));
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
  readonly #conditions: RunConditionRegistry;

  constructor(conditions = new RunConditionRegistry()) {
    this.#conditions = conditions;
  }

  register(owner: string, contributors: readonly ToolContributor[]): void {
    for (const contributor of contributors) {
      const existing = this.#contributors.find((entry) => entry.value.name === contributor.name);
      if (existing) {
        throw new Error(`Tool contribution ${contributor.name} is already provided by ${existing.owner}`);
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
    return this.#contributors.map(({ owner, value }) => this.#conditions.has(owner)
      ? { ...value, runCondition: (runId: string) => this.#conditions.applies(owner, runId) }
      : value);
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
  readonly #prompts = new ContributionRegistry<PromptContribution>("Prompt contribution");
  readonly #conditions: RunConditionRegistry;

  constructor(conditions = new RunConditionRegistry()) {
    this.#conditions = conditions;
  }

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

  /** The contributions that read differently for this run than in the snapshot; an empty text is missing there, everything else stays the rendered text. */
  runOverrides(runId: string): ReadonlyMap<string, string> {
    return new Map([...this.#prompts.entries()].flatMap(({ owner, value }) => {
      if (!this.#conditions.applies(owner, runId)) return [[value.id, ""] as const];
      const text = value.renderForRun?.(runId);
      return text === undefined ? [] : [[value.id, text.trim()] as const];
    }));
  }

  static handlebarsContext(context: PromptRenderContext): Record<string, unknown> {
    return {};
  }
}

export class SkillContributionRegistry {
  readonly #skills = new ContributionRegistry<SkillContribution>("Skill contribution");
  readonly #conditions: RunConditionRegistry;

  constructor(conditions = new RunConditionRegistry()) {
    this.#conditions = conditions;
  }

  register(owner: string, skills: readonly SkillContribution[]): void {
    for (const skill of skills) {
      const audiences = skill.audiences ?? [];
      if (new Set(audiences).size !== audiences.length) {
        throw new Error(`Skill contribution ${skill.id} contains an audience more than once`);
      }
      if (audiences.some((audience) => audience !== "coordinator" && audience !== "agent")) {
        throw new Error(`Skill contribution ${skill.id} contains an invalid audience`);
      }
    }
    this.#skills.register(owner, skills);
  }

  global(): Promise<readonly string[]> {
    return this.resolve(undefined);
  }

  /** A skill name determines its skill across the whole profile, across audiences too; two folders with the same name fail at startup. */
  async assertUniqueNames(): Promise<void> {
    const paths = await this.global();
    for (const name of new Set(paths.map(skillNameOf))) {
      const named = paths.filter((entry) => skillNameOf(entry) === name);
      if (named.length > 1) throw new Error(`The skill name ${name} is used more than once in the profile: ${named.join(", ")}`);
    }
  }

  async resolve(context: AgentContributionContext | undefined): Promise<readonly string[]> {
    const paths = (await this.describe(context)).flatMap((entry) => entry.paths);
    const unique = new Set(paths);
    if (unique.size !== paths.length) throw new Error("An agent skill path is registered more than once");
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
      paths: context && !this.#conditions.applies(owner, context.runId) ? [] : await value.paths(context),
    })));
  }
}

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
const GUIDE_ID = /^[a-z0-9][a-z0-9.-]*$/;
const SCRIPT_HANDLE = /^[a-z0-9][a-z0-9-]*$/;
const ACTOR_PACKAGE_NAME = /^[a-z][a-z0-9-]{0,63}$/;

const requireText = (entry: { id: unknown }, value: unknown, field: string): void => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Template ${String(entry.id)} has no valid ${field}`);
  }
};

const assertKnownFields = (entry: { id: unknown }, value: object, fields: readonly string[], label: string): void => {
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  if (unknown.length > 0) {
    throw new Error(`${label} ${String(entry.id)} contains unknown fields: ${unknown.join(", ")}`);
  }
};

const validateProgramFiles = (owner: string, files: unknown): void => {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error(`${owner}: files needs package files`);
  const names = new Set<string>();
  for (const file of files) {
    if (typeof file !== "object" || file === null || typeof file.path !== "string" || typeof file.content !== "string")
      throw new Error(`${owner}: every file needs path and content`);
    assertKnownFields({ id: owner }, file, ["path", "content"], "Package file of");
    if (!file.path || file.path.includes("\\") || file.path.includes("\0") || path.posix.isAbsolute(file.path)
      || file.path.split("/").some((part: string) => !part || part === "." || part === ".."))
      throw new Error(`${owner}: invalid package path ${file.path}`);
    if (names.has(file.path)) throw new Error(`${owner}: file ${file.path} is duplicated`);
    names.add(file.path);
  }
  if (!names.has("package.json")) throw new Error(`${owner}: package.json is missing`);
};

const validateScriptPackage = (entry: StartEntryContribution, script: unknown): void => {
  if (typeof script !== "object" || script === null)
    throw new Error(`Template ${entry.id} has no run script package`);
  assertKnownFields(entry, script, ["handle", "coordinator", "embeddable", "sharedPrograms", "files", "programs"], "Run script");
  const value = script as Record<string, unknown>;
  if (typeof value.handle !== "string" || !SCRIPT_HANDLE.test(value.handle))
    throw new Error(`Run script ${entry.id}: handle must be a handle like roundtable (lowercase letters, digits, hyphen)`);
  if (typeof value.coordinator !== "boolean")
    throw new Error(`Run script ${entry.id}: coordinator must be true or false`);
  if (value.embeddable !== undefined && typeof value.embeddable !== "boolean")
    throw new Error(`Run script ${entry.id}: embeddable must be true or false`);
  const shared = value.sharedPrograms;
  if (shared !== undefined && (!Array.isArray(shared) || shared.some((name) => typeof name !== "string" || !ACTOR_PACKAGE_NAME.test(name)) || new Set(shared).size !== shared.length))
    throw new Error(`Run script ${entry.id}: sharedPrograms must name each shared actor package once`);
  validateProgramFiles(`Run script ${entry.id}`, value.files);
  if (!Array.isArray(value.programs)) throw new Error(`Run script ${entry.id}: programs must be a list`);
  const names = new Set<string>();
  for (const program of value.programs) {
    if (typeof program !== "object" || program === null || typeof program.name !== "string" || !SCRIPT_HANDLE.test(program.name))
      throw new Error(`Run script ${entry.id}: invalid program name`);
    assertKnownFields(entry, program, ["name", "files"], "Actor program");
    if (program.name === value.handle || names.has(program.name))
      throw new Error(`Run script ${entry.id}: program ${program.name} is duplicated`);
    names.add(program.name);
    validateProgramFiles(`Run script ${entry.id}`, program.files);
  }
};

const validateFixedStartOptions = (entry: StartEntryContribution): void => {
  const fixed: unknown = entry.fixedStartOptions;
  if (fixed === undefined) return;
  if (typeof fixed !== "object" || fixed === null || Array.isArray(fixed) || Object.keys(fixed).length === 0) {
    throw new Error(`Template ${entry.id}: fixedStartOptions must fix at least one start option to a value`);
  }
  for (const [optionId, value] of Object.entries(fixed)) {
    if (!START_OPTION_ID.test(optionId)) throw new Error(`Template ${entry.id} fixes the invalid start option id ${optionId}`);
    assertJsonValue(value, `Template ${entry.id}: fixedStartOptions.${optionId}`);
  }
};

const validateStartEntry = (entry: StartEntryContribution): void => {
  const base = ["id", "title", "description", "order", "guide", "tags", "fixedStartOptions", "action"];
  for (const field of ["id", "title", "description"] as const) requireText(entry, entry[field], field);
  if (entry.order !== undefined && (typeof entry.order !== "number" || !Number.isFinite(entry.order))) {
    throw new Error(`Template ${entry.id} has no valid order number`);
  }
  if (entry.guide !== undefined && (typeof entry.guide !== "string" || !GUIDE_ID.test(entry.guide))) {
    throw new Error(`Template ${entry.id} names no valid guide id: ${String(entry.guide)}`);
  }
  if (entry.tags !== undefined && (!Array.isArray(entry.tags)
    || entry.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag !== tag.trim())
    || new Set(entry.tags).size !== entry.tags.length)) {
    throw new Error(`Template ${entry.id}: tags must be unique, non-empty keywords`);
  }
  validateFixedStartOptions(entry);
  switch (entry.action) {
    case "skill":
      assertKnownFields(entry, entry, [...base, "skill", "prompt", "category"], "Template");
      requireText(entry, entry.category, "category");
      if (entry.category !== entry.category.trim()) throw new Error(`Template ${entry.id}: category must be a single non-empty text`);
      requireText(entry, entry.prompt, "prompt");
      requireText(entry, entry.skill, "skill");
      if (!SKILL_NAME.test(entry.skill)) {
        throw new Error(`Template ${entry.id} names no valid skill name: ${entry.skill}`);
      }
      return;
    case "script":
      assertKnownFields(entry, entry, [...base, "script", "category"], "Template");
      if (entry.category !== undefined && (typeof entry.category !== "string" || !entry.category.trim() || entry.category !== entry.category.trim())) {
        throw new Error(`Template ${entry.id}: category must be a single non-empty text`);
      }
      validateScriptPackage(entry, entry.script);
      return;
    default:
      throw new Error(
        `Template ${String((entry as { id: unknown }).id)} has the unknown action ${String((entry as { action: unknown }).action)}; `
        + "valid are skill and script",
      );
  }
};

/** The name of a skill is the name of its folder. */
const skillNameOf = (directory: string): string => directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "";

const byOrderThenId = (left: { order?: number; id: string }, right: { order?: number; id: string }): number =>
  (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id);

/** Actor packages a plugin shares with the run scripts of the profile; one name, one package. */
export class ActorPackageContributionRegistry {
  readonly #packages = new ContributionRegistry<ActorPackageContribution & { id: string }>("Shared actor package");

  register(owner: string, packages: readonly ActorPackageContribution[]): void {
    for (const entry of packages) {
      if (typeof entry.name !== "string" || !ACTOR_PACKAGE_NAME.test(entry.name))
        throw new Error(`Shared actor package ${String(entry.name)} of ${owner}: the name must be a package name like notes (lowercase letters, digits, hyphen)`);
      validateProgramFiles(`Shared actor package ${entry.name}`, entry.files);
    }
    this.#packages.register(owner, packages.map((entry) => ({ id: entry.name, name: entry.name, files: entry.files })));
  }

  get(name: string): { pluginId: string; files: readonly ActorProgramFile[] } | undefined {
    const found = this.#packages.entries().find(({ value }) => value.name === name);
    return found ? { pluginId: found.owner, files: found.value.files } : undefined;
  }

  names(): readonly string[] {
    return this.#packages.entries().map(({ value }) => value.name);
  }
}

/** Skills with a start prompt and executable run scripts share one registry. */
export class StartEntryContributionRegistry {
  readonly #entries = new ContributionRegistry<StartEntryContribution>("Template");

  register(owner: string, entries: readonly StartEntryContribution[]): void {
    for (const entry of entries) validateStartEntry(entry);
    this.#entries.register(owner, entries);
  }

  assertSkillsKnown(skills: readonly PublicSkillContribution[]): void {
    const names = new Set(skills.flatMap((skill) => skill.paths.map(skillNameOf)));
    for (const { owner, value } of this.#entries.entries()) {
      if (value.action === "skill" && !names.has(value.skill)) {
        throw new Error(`Template ${value.id} of ${owner} refers to the unknown skill ${value.skill}`);
      }
    }
  }

  /** Every fixed start option must be registered and its value must satisfy its schema; whether it is accepted is decided only at start. */
  assertFixedStartOptionsKnown(startOptions: StartOptionContributionRegistry): void {
    for (const { owner, value } of this.#entries.entries()) {
      for (const [optionId, fixed] of Object.entries(value.fixedStartOptions ?? {})) {
        if (!startOptions.entry(optionId)) {
          throw new Error(`Template ${value.id} of ${owner} fixes the unregistered start option ${optionId}`);
        }
        startOptions.assertValue(optionId, fixed, `fixed value of template ${value.id}`);
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

  /** A template as the web sees it; undefined for an unknown id. */
  entry(entryId: string): PublicStartEntry | undefined {
    return this.describe().find((candidate) => candidate.id === entryId);
  }

  /** Names share one namespace per run: a shared package is neither a script's handle nor its bundled program, and every name a script needs exists. */
  assertSharedPrograms(packages: ActorPackageContributionRegistry): void {
    for (const { value } of this.#entries.entries()) {
      if (value.action !== "script") continue;
      const script = value.script;
      const clash = [script.handle, ...script.programs.map((program) => program.name)].find((name) => packages.get(name));
      if (clash !== undefined) {
        throw new Error(`Run script ${value.id} uses the name ${clash}, which is also the shared actor package of ${packages.get(clash)!.pluginId}; `
          + "run script handles, their bundled programs and shared packages share one namespace per run");
      }
      const missing = (script.sharedPrograms ?? []).filter((name) => !packages.get(name));
      if (missing.length > 0) {
        throw new Error(`Run script ${value.id} needs the shared actor packages ${missing.join(", ")}, which no plugin of this profile provides`
          + (packages.names().length > 0 ? `; shared are ${packages.names().join(", ")}` : ""));
      }
    }
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
  readonly #profiles = new ContributionRegistry<ProfileContribution>("Profile contribution");

  register(owner: string, contributions: readonly ProfileContribution[]): void {
    this.#profiles.register(owner, contributions);
  }

  models(): readonly CatalogModel[] {
    const models = this.#profiles.entries().flatMap(({ value }) => value.models());
    const keys = models.map((model) => `${model.driver}:${model.provider}:${model.model}`);
    if (new Set(keys).size !== keys.length) throw new Error("A model is registered more than once");
    return models;
  }

  profiles(): readonly AgentProfile[] {
    const profiles = this.#profiles.entries().flatMap(({ value }) => value.profiles());
    const names = profiles.map((profile) => profile.name);
    if (new Set(names).size !== names.length) throw new Error("An agent profile is registered more than once");
    return profiles;
  }

  async providers(): Promise<readonly ModelProviderRegistration[]> {
    const registrations = (await Promise.all(this.#profiles.entries().map(({ value }) => value.providers?.() ?? []))).flat();
    const ids = registrations.map((registration) => registration.id);
    if (new Set(ids).size !== ids.length) throw new Error("A model provider is registered more than once");
    return registrations;
  }
}

export class ScriptContributionRegistry {
  readonly #script = new ContributionRegistry<ScriptContribution>("Logic contribution");

  register(owner: string, contributions: readonly ScriptContribution[]): void {
    this.#script.register(owner, contributions);
  }

  create(context: ScriptFactoryContext): ScriptRuntime | undefined {
    const entries = this.#script.entries();
    if (entries.length > 1) {
      throw new Error(`The engine supports at most one logic contribution, ${entries.length} are registered`);
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
  readonly #lifecycle = new ContributionRegistry<SessionLifecycleContribution>("Lifecycle contribution");
  readonly #stopTimeoutMs: number;
  readonly #stopAttempts = new Map<string, SessionStopAttempt>();

  constructor(options: { stopTimeoutMs?: number } = {}) {
    const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_PLUGIN_STOP_TIMEOUT_MS;
    if (!Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1) {
      throw new Error("The plugin stop timeout must be a positive integer");
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

  async sessionStarted(runId: string, startEntry: SessionStartedContext["startEntry"]): Promise<void> {
    for (const { value } of this.#lifecycle.entries()) await value.sessionStarted?.({ runId, startEntry });
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
    const bounded = this.#settleParallel("Plugin stop", contributions.map(({ bounded: promise }) => promise));
    const settled = this.#settleParallel("Plugin stop follow-up", contributions.map(({ settled: promise }) => promise));

    return {
      bounded,
      settled,
      release: () => {
        if (contributions.some((contribution) => !contribution.isSettled())) {
          throw new Error(`Plugin stop for ${runId} cannot be released before all contributions have ended`);
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
    await this.#settle("Plugin deletion", [...this.#lifecycle.entries()].reverse()
      .map(({ value }) => () => value.deleteSession?.({ runId })));
    this.#releaseStopAttempts(runId);
  }

  shutdown(): Promise<void> {
    const pendingStops = [...new Set([...this.#stopAttempts.values()].map((attempt) => attempt.settled))];
    return this.#settle("Plugin shutdown", [
      ...[...this.#lifecycle.entries()].reverse().map(({ value }) => () => value.shutdown?.()),
      ...pendingStops.map((settled) => () => settled),
    ]);
  }

  async #settleParallel(name: string, operations: readonly Promise<void>[]): Promise<void> {
    const results = await Promise.allSettled(operations);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, `${name} failed in ${failures.length} plugin(s)`);
  }

  #beginStopContribution(
    contribution: SessionLifecycleContribution,
    runId: string,
    phase: "stopSession" | "afterStopSession",
  ): ContributionStopOperation {
    const stopSession = contribution[phase];
    if (!stopSession) throw new Error(`Lifecycle contribution ${contribution.id} has no stop hook`);
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
          `Plugin stop ${contribution.id} (${phase}) exceeded the timeout of ${this.#stopTimeoutMs} ms`,
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
    if (failures.length > 0) throw new AggregateError(failures, `${name} failed in ${failures.length} plugin(s)`);
  }
}

const WORKSPACE_NOT_ACCESSIBLE = "The workspace of this run is not reachable for this access.";

export class SessionMetadataContributionRegistry {
  readonly #metadata = new ContributionRegistry<SessionMetadataContribution>("Run metadata contribution");

  register(owner: string, contributions: readonly SessionMetadataContribution[]): void {
    this.#metadata.register(owner, contributions);
  }

  /** All contributions at once; whoever does not answer within `timeoutMs` or fails loses only its value and states the reason. */
  async describe(runId: string, workspaceAccessible: boolean, timeoutMs: number): Promise<SessionMetadata> {
    type Outcome = { readonly id: string; readonly value: unknown } | { readonly id: string; readonly reason: string };
    const outcomes = await Promise.all(this.#metadata.entries().map(async ({ value }): Promise<Outcome> => {
      if (value.requiresWorkspace === true && !workspaceAccessible) return { id: value.id, reason: WORKSPACE_NOT_ACCESSIBLE };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const silent = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer after ${timeoutMs} ms`)), timeoutMs);
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
  readonly #options = new ContributionRegistry<StartOptionContribution>("Start option");

  register(owner: string, contributions: readonly StartOptionContribution[]): void {
    for (const contribution of contributions) {
      if (!START_OPTION_ID.test(contribution.id)) throw new Error(`Invalid start option id: ${contribution.id}`);
      if (typeof contribution.schema !== "object" || contribution.schema === null) {
        throw new Error(`Start option ${contribution.id} has no schema`);
      }
      for (const name of ["selectable", "defaultValue", "accept", "describe"] as const) {
        if (typeof contribution[name] !== "function") throw new Error(`Start option ${contribution.id} has no ${name}`);
      }
      if (contribution.ownerOnly !== undefined && typeof contribution.ownerOnly !== "function") {
        throw new Error(`Start option ${contribution.id} has an invalid ownerOnly`);
      }
      if (contribution.rights !== undefined && (!Array.isArray(contribution.rights) || !contribution.rights.every(isAccessRight))) {
        throw new Error(`Start option ${contribution.id} has invalid rights`);
      }
      if (contribution.changeable !== undefined && typeof contribution.changeable !== "boolean") {
        throw new Error(`Start option ${contribution.id} has an invalid changeable`);
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

  /** The first right of the option that the access lacks; an unknown option requires none. */
  missingRight(id: string, access: Pick<AccessContext, "can">): string | undefined {
    return this.entry(id)?.option.rights?.find((right) => !access.can(right));
  }

  assertRights(id: string, access: Pick<AccessContext, "can">): void {
    const missing = this.missingRight(id, access);
    if (missing) throw new DomainError("access-denied", `The right ${missing} is missing for the start option ${id}.`, 403);
  }

  defaultValue(id: string, context: StartOptionContext): JsonValue {
    const { option } = this.#require(id);
    const value = option.defaultValue(context);
    this.#check(option, value, "default value");
    return value;
  }

  accept(id: string, value: unknown, context: StartOptionContext): JsonValue {
    const { option } = this.#require(id);
    assertJsonValue(value, `Start option ${id} value`);
    this.#check(option, value, "value");
    const accepted = option.accept(value, context);
    this.#check(option, accepted, "result of accept");
    return accepted;
  }

  /** Checks a value against the schema of the option without accepting it. */
  assertValue(id: string, value: unknown, label: string): void {
    this.#check(this.#require(id).option, value, label);
  }

  #require(id: string): RegisteredStartOption {
    const entry = this.entry(id);
    if (!entry) throw new Error(`Start option ${id} is not registered`);
    return entry;
  }

  #check(option: StartOptionContribution, value: unknown, label: string): void {
    if (Value.Check(option.schema, value)) return;
    throw new Error(`Invalid ${label} for start option ${option.id}: ${schemaComplaints(option.schema, value, "value")}`);
  }
}

/** What an access without runs.inspect sees of plugin states: a start option only with its rights, otherwise the projection of its plugin, without one everything. */
export class AccessProjectionRegistry {
  readonly #projections = new ContributionRegistry<AccessProjectionContribution>("Access projection");
  readonly #startOptions: StartOptionContributionRegistry;

  constructor(startOptions = new StartOptionContributionRegistry()) {
    this.#startOptions = startOptions;
  }

  register(owner: string, contributions: readonly AccessProjectionContribution[]): void {
    for (const contribution of contributions) {
      for (const name of ["state", "chatEvent"] as const) {
        if (typeof contribution[name] !== "function") throw new Error(`Access projection ${contribution.id} has no ${name}`);
      }
    }
    this.#projections.register(owner, contributions);
  }

  state(entry: PluginState, access: Pick<AccessContext, "can">): PluginState | undefined {
    if (access.can("runs.inspect")) return entry;
    if (this.#startOptions.missingRight(entry.pluginId, access) !== undefined) return undefined;
    const projection = this.#find(entry.pluginId);
    if (!projection) return entry;
    const state = projection.state(entry);
    return state === undefined ? undefined : { ...entry, state };
  }

  chatEvent<T extends PluginChatEvent>(pluginId: string, event: T, access: Pick<AccessContext, "can">): T | undefined {
    if (access.can("runs.inspect")) return event;
    if (this.#startOptions.missingRight(pluginId, access) !== undefined) return undefined;
    const projection = this.#find(pluginId);
    if (!projection) return event;
    const projected = projection.chatEvent(event.payload === undefined ? { type: event.type } : { type: event.type, payload: event.payload });
    return projected === undefined ? undefined : { ...event, type: projected.type, payload: projected.payload };
  }

  #find(id: string): AccessProjectionContribution | undefined {
    return this.#projections.entries().find(({ value }) => value.id === id)?.value;
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
        throw new Error(`Configuration ${descriptor.key} is declared inconsistently`);
      }
      if (existing.owners.includes(owner)) {
        throw new Error(`Configuration ${descriptor.key} is declared more than once in ${owner}`);
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
      throw new Error(`Invalid plugin storage segment: ${segment}`);
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
    if (this.#scopes.has(manifest.id)) throw new Error(`Storage for ${manifest.id} is already registered`);
    const pluginDirectory = path.join("plugins", manifest.id);
    const scope: PluginStorage = Object.freeze({
      sessionsRoot: path.join(this.#dataDirectory, "sessions"),
      modes: this.#modes,
      root: (...segments: string[]) => joinSafe(path.join(this.#dataDirectory, pluginDirectory), segments),
      session: (runId: string, ...segments: string[]) => {
        if (!RUN_ID.test(runId)) throw new Error(`Invalid run id: ${runId}`);
        return joinSafe(path.join(this.#dataDirectory, "sessions", runId, pluginDirectory), segments);
      },
    });
    this.#scopes.set(manifest.id, scope);
    return scope;
  }

  of(pluginId: string): PluginStorage {
    const scope = this.#scopes.get(pluginId);
    if (!scope) throw new Error(`Storage for ${pluginId} is not registered`);
    return scope;
  }
}

class ClientConfigRegistry {
  readonly #values = new Map<string, Record<string, unknown>>();

  register(owner: string, values: Readonly<Record<string, unknown>>): void {
    const existing = this.#values.get(owner) ?? {};
    for (const key of Object.keys(values)) {
      if (Object.hasOwn(existing, key)) {
        throw new Error(`Client configuration ${key} is set more than once in ${owner}`);
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
    if (existing) throw new Error(`Service ${token.id} is already provided by ${existing.owner}`);
    this.#services.set(token.id, { owner, value: service });
  }

  require<T>(token: ServiceToken<T>): T {
    const entry = this.#services.get(token.id);
    if (!entry) throw new Error(`Required plugin service ${token.id} is not registered`);
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
  readonly runConditions = new RunConditionRegistry();
  readonly agentRuntime = new AgentContributionRegistry(this.runConditions);
  readonly tools = new ToolContributionRegistry(this.runConditions);
  readonly prompts = new PromptContributionRegistry(this.runConditions);
  readonly skills = new SkillContributionRegistry(this.runConditions);
  readonly startEntries = new StartEntryContributionRegistry();
  readonly actorPackages = new ActorPackageContributionRegistry();
  readonly profiles = new ProfileContributionRegistry();
  readonly script = new ScriptContributionRegistry();
  readonly lifecycle = new LifecycleContributionRegistry();
  readonly sessionMetadata = new SessionMetadataContributionRegistry();
  readonly startOptions = new StartOptionContributionRegistry();
  readonly accessProjections = new AccessProjectionRegistry(this.startOptions);
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
    if (this.#sealed) throw new Error("No more plugins can be registered after startup");
    const { manifest } = plugin;
    if (!PLUGIN_ID.test(manifest.id)) throw new Error(`Invalid plugin id: ${manifest.id}`);
    if (this.#manifests.some((entry) => entry.id === manifest.id)) {
      throw new Error(`Plugin ${manifest.id} is already registered`);
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
      runCondition: (condition) => this.runConditions.register(manifest.id, condition),
      provide: (token, service) => this.#services.provide(manifest.id, token, service),
      service: (token) => this.#services.require(token),
      optionalService: (token) => this.#services.optional(token),
      sessionMetadata: (...entries) => this.sessionMetadata.register(manifest.id, entries),
      skills: (...entries) => this.skills.register(manifest.id, entries),
      startEntries: (...entries) => this.startEntries.register(manifest.id, entries),
      actorPackages: (...entries) => this.actorPackages.register(manifest.id, entries),
      startOptions: (...entries) => this.startOptions.register(manifest.id, entries),
      accessProjections: (...entries) => this.accessProjections.register(manifest.id, entries),
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
        if (position === undefined) throw new Error(`Plugin ${manifest.id} requires the missing plugin ${dependency}`);
        if (position >= index) throw new Error(`Plugin ${dependency} must be registered before ${manifest.id}`);
      }
    }
    this.startEntries.assertFixedStartOptionsKnown(this.startOptions);
    this.startEntries.assertSharedPrograms(this.actorPackages);
    const defaultStartEntry = this.#defaultStartEntry;
    if (defaultStartEntry !== undefined) {
      const entries = this.startEntries.describe().map((entry) => entry.id);
      if (!entries.includes(defaultStartEntry)) {
        throw new Error(`defaultStartEntry ${defaultStartEntry} is not a registered template; `
          + (entries.length > 0 ? `registered are ${entries.join(", ")}` : "no plugin of this profile registers templates"));
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
