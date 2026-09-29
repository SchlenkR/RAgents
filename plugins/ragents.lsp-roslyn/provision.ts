import { stat } from "node:fs/promises";
import path from "node:path";
import {
  DOTNET_INSTRUCTION,
  downloadArchive,
  dotnetRuntimeMajors,
  provisionGap,
  provisionReady,
  readProvisionStamp,
  unpackArchive,
  writeProvisionStamp,
  type ArchiveDownload,
  type PluginProvision,
  type ProvisionState,
} from "@ragents/host/plugin-support/provision.js";
import { ROSLYN_SERVER_FILE } from "./executor.js";

export const ROSLYN_VERSION = "5.4.0-2.26179.14";

const FEED = "https://pkgs.dev.azure.com/azure-public/vside/_packaging/vs-impl/nuget/v3/flat2";
const PACKAGE = "microsoft.codeanalysis.languageserver.neutral";
const PREFIX = "content/LanguageServer/neutral/";

export const roslynArchiveUrl = `${FEED}/${PACKAGE}/${ROSLYN_VERSION}/${PACKAGE}.${ROSLYN_VERSION}.nupkg`;

export const createRoslynProvision = (
  download: ArchiveDownload = downloadArchive,
  runtimes: () => Promise<readonly number[] | undefined> = dotnetRuntimeMajors,
): PluginProvision => {
  const serverFile = (target: string): string => path.join(target, ...ROSLYN_SERVER_FILE.split("/"));
  const check = async (target: string): Promise<ProvisionState> => {
    if (await runtimes() === undefined) return provisionGap("dotnet", DOTNET_INSTRUCTION, false);
    const installed = await stat(serverFile(target)).catch(() => undefined);
    if (installed?.isFile() && await readProvisionStamp(target) === ROSLYN_VERSION) return provisionReady;
    return provisionGap("roslyn", `Microsoft.CodeAnalysis.LanguageServer ${ROSLYN_VERSION} is missing at ${serverFile(target)}`, true);
  };
  return {
    check,
    apply: async (target, log) => {
      const state = await check(target);
      if (state.kind === "ready") return;
      if (!state.installable) throw new Error(state.instruction);
      log(`Downloading Roslyn ${ROSLYN_VERSION}`);
      const files = await unpackArchive(await download(roslynArchiveUrl), PREFIX, target, "roslyn");
      if (!(await stat(serverFile(target)).catch(() => undefined))?.isFile()) {
        throw new Error(`The package ${PACKAGE} ${ROSLYN_VERSION} does not contain ${ROSLYN_SERVER_FILE}`);
      }
      await writeProvisionStamp(target, ROSLYN_VERSION);
      log(`${files} files to ${path.join(target, "roslyn")}`);
    },
  };
};

export const provision = createRoslynProvision();
