import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const stateFile = path.join(config.dataDir, "external-access.json");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

let open = true;

const hostOf = (req: IncomingMessage): string => {
  const header = req.headers.host ?? "";
  const bracketed = /^\[(.+)\]/.exec(header);
  return (bracketed ? bracketed[1] : header.split(":")[0] ?? "").toLowerCase();
};

export const isLocalRequest = (req: IncomingMessage): boolean => LOCAL_HOSTS.has(hostOf(req));

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

export const externalGate = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (open || isLocalRequest(req)) return false;
  res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Der Zugang von außen ist ausgeschaltet.\n");
  return true;
};
