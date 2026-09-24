import { serviceToken, type ServiceToken } from "@ragents/engine";
import type { WatchServiceApi } from "../contract.js";

export const watchServiceToken: ServiceToken<WatchServiceApi> = serviceToken("ragents.watch.service");
