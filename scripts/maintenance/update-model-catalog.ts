import { writeFile } from "node:fs/promises";
import { OPENROUTER_MODELS } from "../../packages/ai/src/providers/openrouter.models.ts";
import type { InputModality, Model } from "../../packages/ai/src/types.ts";

type OpenRouterCompat = NonNullable<Model<"openai-completions">["compat"]>;
type OpenRouterThinkingLevelMap = NonNullable<Model<"openai-completions">["thinkingLevelMap"]>;

interface CatalogCost {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
}

interface CatalogEntry {
	readonly id: string;
	readonly name: string;
	readonly api: string;
	readonly provider: string;
	readonly baseUrl: string;
	readonly compat?: Readonly<OpenRouterCompat>;
	readonly reasoning: boolean;
	readonly thinkingLevelMap?: Readonly<OpenRouterThinkingLevelMap>;
	readonly input: readonly InputModality[];
	readonly cost: CatalogCost;
	readonly contextWindow: number;
	readonly maxTokens: number;
}

interface ApiPricing {
	readonly prompt?: string;
	readonly completion?: string;
	readonly input_cache_read?: string;
	readonly input_cache_write?: string;
}

interface ApiReasoning {
	readonly supported_efforts?: unknown;
	readonly mandatory?: unknown;
}

interface ApiModel {
	readonly id?: unknown;
	readonly name?: unknown;
	readonly context_length?: unknown;
	readonly architecture?: { readonly input_modalities?: unknown };
	readonly pricing?: ApiPricing;
	readonly top_provider?: {
		readonly context_length?: unknown;
		readonly max_completion_tokens?: unknown;
	};
	readonly supported_parameters?: unknown;
	readonly reasoning?: ApiReasoning;
}

const catalogUrl = new URL("../../packages/ai/src/providers/openrouter.models.ts", import.meta.url);
const apiUrl = "https://openrouter.ai/api/v1/models";
const baseUrl = "https://openrouter.ai/api/v1";
const api = "openai-completions";
const provider = "openrouter";
const defaultMaxTokens = 4096;

const fileHeader = `// Statischer Modellkatalog für openrouter. Einzige Quelle: es gibt keinen
// Laufzeit-Store und keine Auffrischung über das Netz.

import type { Model } from "../types.ts";

export const OPENROUTER_MODELS = {
`;
const fileFooter = "} as const;\n";

const known: Record<string, CatalogEntry> = OPENROUTER_MODELS;

function perMillion(price: string | undefined): number {
	const parsed = Number(price ?? 0);
	if (!Number.isFinite(parsed)) return 0;
	return Number((parsed * 1_000_000).toPrecision(12));
}

function toNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toInputModalities(value: unknown): readonly InputModality[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("Modellkatalog ohne Eingabemodalitäten.");
	const allowed: readonly InputModality[] = ["text", "image", "video", "file", "audio"];
	return value.map((modality) => {
		if (!allowed.includes(modality)) throw new Error(`Unbekannte Eingabemodalität ${String(modality)}.`);
		return modality as InputModality;
	});
}

const effortLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Die Denkstufen nach dem reasoning-Block der API: angebotene Stufen gehen wörtlich hinaus, "off" als "none", solange Reasoning nicht Pflicht ist. */
function thinkingLevelMapOf(reasoning: ApiReasoning | undefined): OpenRouterThinkingLevelMap | undefined {
	const efforts = reasoning?.supported_efforts;
	if (!Array.isArray(efforts)) return undefined;
	return {
		off: reasoning?.mandatory === true ? null : "none",
		...Object.fromEntries(effortLevels.map((level) => [level, efforts.includes(level) ? level : null])),
	};
}

function toEntry(model: ApiModel): CatalogEntry {
	const id = String(model.id);
	const previous = known[id];
	const supported = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
	const contextWindow = toNumber(model.top_provider?.context_length) ?? toNumber(model.context_length) ?? 0;
	const thinkingLevelMap = previous ? previous.thinkingLevelMap : thinkingLevelMapOf(model.reasoning);
	return {
		id,
		name: typeof model.name === "string" && model.name.length > 0 ? model.name : id,
		api,
		provider,
		baseUrl,
		...(previous?.compat ? { compat: previous.compat } : {}),
		reasoning: supported.includes("reasoning"),
		...(thinkingLevelMap ? { thinkingLevelMap } : {}),
		input: toInputModalities(model.architecture?.input_modalities),
		cost: {
			input: perMillion(model.pricing?.prompt),
			output: perMillion(model.pricing?.completion),
			cacheRead: perMillion(model.pricing?.input_cache_read),
			cacheWrite: perMillion(model.pricing?.input_cache_write),
		},
		contextWindow,
		maxTokens: toNumber(model.top_provider?.max_completion_tokens) ?? defaultMaxTokens,
	};
}

function renderEntry(entry: CatalogEntry): string {
	const compat = entry.compat ? `\t\tcompat: ${JSON.stringify(entry.compat)},\n` : "";
	const thinkingLevelMap = entry.thinkingLevelMap
		? `\t\tthinkingLevelMap: ${JSON.stringify(entry.thinkingLevelMap)},\n`
		: "";
	const input = entry.input.map((modality) => JSON.stringify(modality)).join(", ");
	return (
		`\t${JSON.stringify(entry.id)}: {\n` +
		`\t\tid: ${JSON.stringify(entry.id)},\n` +
		`\t\tname: ${JSON.stringify(entry.name)},\n` +
		`\t\tapi: ${JSON.stringify(entry.api)},\n` +
		`\t\tprovider: ${JSON.stringify(entry.provider)},\n` +
		`\t\tbaseUrl: ${JSON.stringify(entry.baseUrl)},\n` +
		compat +
		`\t\treasoning: ${entry.reasoning},\n` +
		thinkingLevelMap +
		`\t\tinput: [${input}],\n` +
		`\t\tcost: {\n` +
		`\t\t\tinput: ${entry.cost.input},\n` +
		`\t\t\toutput: ${entry.cost.output},\n` +
		`\t\t\tcacheRead: ${entry.cost.cacheRead},\n` +
		`\t\t\tcacheWrite: ${entry.cost.cacheWrite},\n` +
		`\t\t},\n` +
		`\t\tcontextWindow: ${entry.contextWindow},\n` +
		`\t\tmaxTokens: ${entry.maxTokens},\n` +
		`\t} satisfies Model<${JSON.stringify(entry.api)}>,\n`
	);
}

async function fetchModels(): Promise<ApiModel[]> {
	const response = await fetch(apiUrl, { headers: { accept: "application/json" } }).catch((cause: unknown) => {
		throw new Error(`Modellkatalog nicht abrufbar: ${apiUrl} ist nicht erreichbar (${String(cause)}).`);
	});
	if (!response.ok) {
		throw new Error(`Modellkatalog nicht abrufbar: ${apiUrl} antwortete mit ${response.status} ${response.statusText}.`);
	}
	const payload = (await response.json()) as { data?: unknown };
	const models = Array.isArray(payload.data) ? (payload.data as ApiModel[]) : [];
	const usable = models.filter((model) => typeof model.id === "string" && model.id.length > 0);
	if (usable.length === 0) {
		throw new Error(`Modellkatalog nicht abrufbar: ${apiUrl} lieferte keine verwertbaren Modelle.`);
	}
	return usable;
}

async function main(): Promise<void> {
	const fetched = await fetchModels();
	const entries = fetched.map(toEntry);
	const fetchedIds = new Set(entries.map((entry) => entry.id));
	const kept = Object.values(known).filter((entry) => !fetchedIds.has(entry.id));
	const all = [...entries, ...kept].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
	const added = entries.filter((entry) => known[entry.id] === undefined);

	await writeFile(catalogUrl, fileHeader + all.map(renderEntry).join("") + fileFooter, "utf8");

	console.log(`Modellkatalog geschrieben: ${all.length} Modelle in ${catalogUrl.pathname}`);
	console.log(`Neu aus der API: ${added.length}`);
	console.log(`Nicht mehr in der API, unverändert übernommen: ${kept.length}`);
	for (const entry of kept) console.log(`  ${entry.id}`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
