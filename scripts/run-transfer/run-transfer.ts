import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";

const usage = (): string => `Verwendung: RAGENTS_TOKEN=<token> pnpm run-transfer <quelle-url> <ziel-url> <runId> [--workspace <pfad>]
Holt den gestoppten Run von der Quelle als Archiv und legt ihn auf dem Ziel an: Journal,
Payloads, Modellkontexte und die Plugin-Ablagen seiner Session. Beide Server müssen auf
derselben Host-Version laufen, und die Kennung darf auf dem Ziel noch nicht belegt sein.
--workspace nennt den Ersatzordner auf dem Ziel für einen Run mit Bindung path, als absoluten
Pfad auf dem Zielserver.
Je Seite geht auch ein eigener Token: RAGENTS_SOURCE_TOKEN, RAGENTS_TARGET_TOKEN.`;

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
      if (!value || value.startsWith("-")) throw new Error(`--workspace braucht einen Ordner.\n${usage()}`);
      if (!path.isAbsolute(value)) throw new Error(`--workspace ist ein Ordner auf dem Zielserver und braucht einen absoluten Pfad: ${value}`);
      workspacePath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unbekanntes Argument: ${argument}\n${usage()}`);
    positional.push(argument);
  }
  if (positional.length !== 3) throw new Error(`Quelle, Ziel und Run-Kennung sind Pflicht.\n${usage()}`);
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
  console.log(`== Export ${arguments_.runId} von ${arguments_.sourceUrl}`);
  const exported = await source.call(coreContracts.transfer.export, { runId: arguments_.runId });
  const { manifest } = exported;
  console.log(`== Archiv ${Buffer.from(exported.archive, "base64").byteLength} Byte, ${manifest.events} Ereignisse, `
    + `Revision ${manifest.revision}, Profil ${manifest.profile}, Host ${manifest.hostVersion.slice(0, 12)}`);
  if (manifest.boundDirectory) console.log(`== Bindung an den Projektordner ${manifest.boundDirectory} der Quelle`);
  console.log(`== Import nach ${arguments_.targetUrl}`);
  const imported = await target.call(coreContracts.transfer.import, {
    archive: exported.archive,
    ...(arguments_.workspacePath ? { workspacePath: arguments_.workspacePath } : {}),
  });
  console.log(`== Run ${imported.manifest.runId} liegt auf ${arguments_.targetUrl}: Sequenz ${imported.sequence}, ${imported.events} Ereignisse`);
  console.log(`== Arbeitsbereich ${imported.workspace}${imported.boundDirectory ? ` (gebundener Projektordner)` : ""}`);
  console.log("== Der Run bleibt auf der Quelle liegen; dort ausdrücklich löschen, wenn er umziehen sollte.");
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
