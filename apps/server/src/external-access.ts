import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { isLocalRequest } from "./local-request.js";
export { isLocalRequest } from "./local-request.js";

const stateFile = path.join(config.dataDir, "external-access.json");

let open = true;

export const externalAccessOpen = (): boolean => open;

export const loadExternalAccess = async (): Promise<void> => {
  const raw = await readFile(stateFile, "utf8").catch(() => "");
  if (!raw) return;
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && typeof (parsed as { open?: unknown }).open === "boolean") {
    open = (parsed as { open: boolean }).open;
  }
};

export const setExternalAccess = async (value: boolean): Promise<void> => {
  open = value;
  await writeFile(stateFile, `${JSON.stringify({ open })}\n`, "utf8");
};

/** With external access turned off only requests addressed to this machine pass. */
export const externalAllowed = (req: IncomingMessage): boolean => open || isLocalRequest(req);

export const externalGate = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (externalAllowed(req)) return false;
  res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("External access is turned off.\n");
  return true;
};
