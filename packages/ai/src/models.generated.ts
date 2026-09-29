// The catalog is reduced to the only provider in use.
import { OPENROUTER_MODELS } from "./providers/openrouter.models.ts";

export const MODELS = {
	"openrouter": OPENROUTER_MODELS,
} as const;
