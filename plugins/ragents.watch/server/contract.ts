import { serviceToken, type ServiceToken } from "@aicontainer/ragents";
import type { WatchServiceApi } from "../contract.js";

export const watchServiceToken: ServiceToken<WatchServiceApi> = serviceToken("ragents.watch.service");
