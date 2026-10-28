import os from "node:os";
import {
  MachineProcessSandbox,
  canonicalSandboxPath,
  sandboxHomeRoots,
  sandboxHostSockets,
  sandboxSearchPath,
  sandboxToolchainDirectories,
  type MachineProcessSandboxOptions,
} from "@ragents/workspace-executor/src/os-process-sandbox.ts";
import { safeProcessEnvironment } from "@ragents/workspace-executor";
import { hostRoot } from "../host-version.js";

export { PROCESS_SANDBOX_DEFAULT_NETWORK } from "@ragents/workspace-executor/src/os-process-sandbox.ts";
export type { RunProcessSandboxes, RunSandboxFolders } from "@ragents/workspace-executor/src/os-process-sandbox.ts";

export interface ServerProcessSandboxOptions extends Omit<MachineProcessSandboxOptions, "blocked" | "readable" | "searchPath"> {
  readonly hostRoot?: string;
}

export class ServerProcessSandbox extends MachineProcessSandbox {
  constructor(options: ServerProcessSandboxOptions) {
    const platform = options.platform ?? process.platform;
    const blocked = [os.homedir(), ...sandboxHomeRoots(platform), os.tmpdir(), "/tmp", options.dataDirectory,
      ...sandboxHostSockets(platform)].map(canonicalSandboxPath);
    const environment = options.environment ?? process.env;
    super({
      ...options,
      blocked,
      readable: [options.hostRoot ?? hostRoot(), ...sandboxToolchainDirectories(environment, blocked)],
      searchPath: sandboxSearchPath(safeProcessEnvironment(environment)),
    });
  }
}
