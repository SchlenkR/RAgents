import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";

const usage = (): string => `Usage: RAGENTS_TOKEN=<token> pnpm run-transfer <source-url> <target-url> <runId> [--workspace <path>]
Fetches the stopped run from the source as an archive and creates it on the target: journal,
payloads, model contexts and its plugin stores. Both servers must run on
the same host version, and the id must not yet be taken on the target.
--workspace names the replacement folder on the target for a run with binding path, as an absolute
path on the target server.
Each side can also have its own token: RAGENTS_SOURCE_TOKEN, RAGENTS_TARGET_TOKEN.`;

export interface TransferArguments {
  readonly sourceUrl: string;
  readonly targetUrl: string;
  readonly runId: string;
  readonly workspacePath: string | undefined;
}

export const parseArguments = (argv: readonly string[]): TransferArguments => {
  const positional: string[] = [];
  let workspacePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--workspace") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`--workspace needs a folder.\n${usage()}`);
      if (!path.isAbsolute(value)) throw new Error(`--workspace is a folder on the target server and needs an absolute path: ${value}`);
      workspacePath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    positional.push(argument);
  }
  if (positional.length !== 3) throw new Error(`Source, target and run id are required.\n${usage()}`);
  return { sourceUrl: positional[0]!, targetUrl: positional[1]!, runId: positional[2]!, workspacePath };
};

const clientFor = (serverUrl: string, token: string | undefined): RpcClient => new RpcClient({
  baseUrl: serverUrl.replace(/\/+$/, ""),
  fetch: (input, init) => fetch(input, {
    ...init,
    headers: {
      ...init?.headers as Record<string, string> | undefined,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }),
});

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(process.argv.slice(2));
  const source = clientFor(arguments_.sourceUrl, process.env.RAGENTS_SOURCE_TOKEN ?? process.env.RAGENTS_TOKEN);
  const target = clientFor(arguments_.targetUrl, process.env.RAGENTS_TARGET_TOKEN ?? process.env.RAGENTS_TOKEN);
  console.log(`== Export ${arguments_.runId} from ${arguments_.sourceUrl}`);
  const exported = await source.call(coreContracts.transfer.export, { runId: arguments_.runId });
  const { manifest } = exported;
  console.log(`== Archive ${Buffer.from(exported.archive, "base64").byteLength} bytes, ${manifest.events} events, `
    + `revision ${manifest.revision}, profile ${manifest.profile}, host ${manifest.hostVersion.slice(0, 12)}`);
  if (manifest.boundDirectory) console.log(`== Binding to the source's project folder ${manifest.boundDirectory}`);
  console.log(`== Import to ${arguments_.targetUrl}`);
  const imported = await target.call(coreContracts.transfer.import, {
    archive: exported.archive,
    ...(arguments_.workspacePath ? { workspacePath: arguments_.workspacePath } : {}),
  });
  console.log(`== Run ${imported.manifest.runId} is on ${arguments_.targetUrl}: sequence ${imported.sequence}, ${imported.events} events`);
  console.log(`== Workspace ${imported.workspace}${imported.boundDirectory ? ` (bound project folder)` : ""}`);
  console.log("== The run stays on the source; delete it there explicitly if it should move.");
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
