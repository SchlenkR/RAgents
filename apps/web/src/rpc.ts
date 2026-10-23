import { withAccessToken } from "./access-token";
import { RpcClient, RPC_STREAM_PATH } from "./rpc/client";
import { fetchEventStream } from "./rpc/event-source";

/** The page's single client; the event stream opens with the first subscription. */
export const rpc = new RpcClient({ fetch: (input, init) => input === RPC_STREAM_PATH
  ? fetchEventStream(withAccessToken(input), init?.signal)
  : fetch(input, init) });
