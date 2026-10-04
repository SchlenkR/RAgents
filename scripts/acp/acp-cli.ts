import "../../apps/server/src/host-resolution.ts";
import { Console } from "node:console";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";
import { defaultProfile } from "../agent/host.ts";
import { EditorAgent } from "./agent.ts";

const usage = "Usage: ragents acp [--profile <profile|file>] [--data-dir <folder>]\n"
  + "Serves Agent Client Protocol v1 over stdio. RAGENTS_URL selects an existing server; RAGENTS_TOKEN authenticates.\n"
  + "DATA_DIR overrides the profile data folder. Every log goes to stderr; stdout is reserved for ACP.";

export const acpArguments = (argv: readonly string[]): { profile: string; dataDirectory?: string; help: boolean } => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--help" || flag === "help") return { profile: defaultProfile(), help: true };
    if (flag !== "--profile" && flag !== "--data-dir") throw new Error(`Unknown argument: ${flag}\n${usage}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    if (values.has(flag)) throw new Error(`${flag} was given twice.`);
    values.set(flag, value);
    index += 1;
  }
  return { profile: values.get("--profile") ?? defaultProfile(), help: false,
    ...values.has("--data-dir") ? { dataDirectory: path.resolve(callerDirectory(), values.get("--data-dir")!) } : {} };
};

export const main = async (argv = process.argv.slice(2)): Promise<void> => {
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  const options = acpArguments(argv);
  if (options.help) { console.error(usage); return; }
  if (options.dataDirectory) process.env.DATA_DIR = options.dataDirectory;
  let agent: EditorAgent | undefined;
  const connection = new AgentSideConnection((connection) => agent = new EditorAgent(connection, options.profile),
    ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => stopping ??= (async () => { await agent?.close(); })();
  const onSignal = (): void => { void stop().then(() => process.exit(0), (cause) => { console.error(cause); process.exit(1); }); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try { await connection.closed; await stop(); }
  finally { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1; });
}
