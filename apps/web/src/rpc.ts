import { RpcClient } from "./rpc/client";

/** The page's single client; the event stream opens with the first subscription. */
export const rpc = new RpcClient();
