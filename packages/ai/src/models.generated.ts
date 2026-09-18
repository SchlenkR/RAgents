// Der Katalog ist auf den einzigen genutzten Provider reduziert.
import { OPENROUTER_MODELS } from "./providers/openrouter.models.ts";

export const MODELS = {
	"openrouter": OPENROUTER_MODELS,
} as const;
