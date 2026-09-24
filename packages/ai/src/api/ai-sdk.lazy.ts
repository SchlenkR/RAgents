import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const aiSdkApi = (): ProviderStreams => lazyApi(() => import("./ai-sdk.ts"));
