import type { LanguageServerAdapter } from "../host.js";
import { fsharpAdapter } from "./fsharp.js";
import { roslynAdapter } from "./roslyn.js";
import { typescriptAdapter } from "./typescript.js";

/** Jeder Executor bietet dieselbe Menge Sprachserver an; fehlt einer auf der Maschine, scheitert erst der Aufruf. */
export const workspaceLanguageServers: readonly LanguageServerAdapter[] = [roslynAdapter, fsharpAdapter, typescriptAdapter];
