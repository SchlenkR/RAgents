import { stat } from "node:fs/promises";
import path from "node:path";
import { FSHARP_SERVER_FILE } from "@ragents/workspace-executor";
import {
  DOTNET_INSTRUCTION,
  downloadArchive,
  dotnetRuntimeMajors,
  provisionGap,
  provisionReady,
  readProvisionStamp,
  readZipNames,
  unpackArchive,
  writeProvisionStamp,
  type ArchiveDownload,
  type PluginProvision,
  type ProvisionState,
} from "@ragents/host/plugin-support/provision.js";

export const FSAUTOCOMPLETE_VERSION = "0.83.0";

const FEED = "https://api.nuget.org/v3/flatcontainer";
const PACKAGE = "fsautocomplete";
const TOOL_FOLDER = /^tools\/net(\d+)\.0\/any\//;

export const fsautocompleteArchiveUrl = `${FEED}/${PACKAGE}/${FSAUTOCOMPLETE_VERSION}/${PACKAGE}.${FSAUTOCOMPLETE_VERSION}.nupkg`;

/** Das Werkzeugpaket bringt je Zielplattform einen Ordner mit; genommen wird die höchste Laufzeit, die es hier gibt. */
const toolPrefix = (names: readonly string[], majors: readonly number[]): string => {
  const offered = names
    .map((name) => TOOL_FOLDER.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ prefix: match[0], major: Number(match[1]) }));
  const usable = offered.filter((entry) => majors.includes(entry.major)).sort((left, right) => right.major - left.major);
  const chosen = usable[0];
  if (!chosen) {
    throw new Error(`${PACKAGE} ${FSAUTOCOMPLETE_VERSION} bringt nur ${[...new Set(offered.map((entry) => `net${entry.major}.0`))].join(", ")} mit; `
      + `installiert sind die .NET-Laufzeiten ${majors.join(", ")}`);
  }
  return chosen.prefix;
};

export const createFsharpProvision = (
  download: ArchiveDownload = downloadArchive,
  runtimes: () => Promise<readonly number[] | undefined> = dotnetRuntimeMajors,
): PluginProvision => {
  const serverFile = (target: string): string => path.join(target, ...FSHARP_SERVER_FILE.split("/"));
  const check = async (target: string): Promise<ProvisionState> => {
    if (await runtimes() === undefined) return provisionGap("dotnet", DOTNET_INSTRUCTION, false);
    const installed = await stat(serverFile(target)).catch(() => undefined);
    if (installed?.isFile() && await readProvisionStamp(target) === FSAUTOCOMPLETE_VERSION) return provisionReady;
    return provisionGap("fsautocomplete", `fsautocomplete ${FSAUTOCOMPLETE_VERSION} fehlt unter ${serverFile(target)}`, true);
  };
  return {
    check,
    apply: async (target, log) => {
      const state = await check(target);
      if (state.kind === "ready") return;
      if (!state.installable) throw new Error(state.instruction);
      const majors = await runtimes();
      if (!majors) throw new Error(DOTNET_INSTRUCTION);
      log(`fsautocomplete ${FSAUTOCOMPLETE_VERSION} laden`);
      const archive = await download(fsautocompleteArchiveUrl);
      const prefix = toolPrefix(readZipNames(archive), majors);
      const files = await unpackArchive(archive, prefix, target, "fsautocomplete");
      if (!(await stat(serverFile(target)).catch(() => undefined))?.isFile()) {
        throw new Error(`Das Paket ${PACKAGE} ${FSAUTOCOMPLETE_VERSION} enthält ${prefix}fsautocomplete.dll nicht`);
      }
      await writeProvisionStamp(target, FSAUTOCOMPLETE_VERSION);
      log(`${files} Dateien aus ${prefix} nach ${path.join(target, "fsautocomplete")}`);
    },
  };
};

export const provision = createFsharpProvision();
