import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";
import { hostApiModules } from "./host-api.js";

const channel = new MessageChannel();
register("./host-resolution-hooks.mjs", {
  parentURL: import.meta.url,
  data: { port: channel.port2, serverModules: hostApiModules("server") },
  transferList: [channel.port2],
});
channel.port1.unref();

let announcement = 0;

/** Tells the loader thread which bundle folder (real path) belongs to which id; resolves once it knows. */
export const announceBundles = (bundles: ReadonlyMap<string, string>): Promise<void> => new Promise((resolve) => {
  announcement += 1;
  const id = announcement;
  const acknowledged = (message: { readonly acknowledged?: number }): void => {
    if (message.acknowledged !== id) return;
    channel.port1.off("message", acknowledged);
    channel.port1.unref();
    resolve();
  };
  channel.port1.on("message", acknowledged);
  channel.port1.ref();
  channel.port1.postMessage({ id, bundles: [...bundles] });
});
