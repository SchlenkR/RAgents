import { runContracts } from "../../packages/ragents/src/http/contracts";
import { processesContracts } from "../../plugins/ragents.processes/contract";
import { profileDistributionContracts } from "../../plugins/ragents.profile-distribution/contract";
import { workspaceClientContracts, workspaceContracts } from "../../plugins/ragents.workspace/contract";
import { coreContracts } from "../../apps/server/src/api/contracts";

/** What an extension and a server of another release must agree on; EXTENSION_API_VERSION numbers it, apps/vscode/extension-api.json records it. */
export const extensionApi = {
  /** Every operation the extension and its workstation call or serve and every channel they subscribe to. */
  contracts: [
    coreContracts.plugins.bootstrap,
    coreContracts.runs.list,
    coreContracts.runs.delete,
    coreContracts.runs.sharing,
    coreContracts.runs.share,
    coreContracts.channels.runs,
    coreContracts.channels.run,
    runContracts.events,
    profileDistributionContracts.describe,
    processesContracts.tunnel,
    workspaceContracts.clients.contributions,
    workspaceContracts.clients.register,
    workspaceContracts.clients.unregister,
    workspaceClientContracts.execute,
  ],
  /** The frame protocol between server page and webview, the message layer, and the HTTP routes the extension uses directly. */
  files: [
    "apps/web/src/run-panel/host-contract.ts",
    "packages/ragents/src/rpc/protocol.ts",
    "apps/server/src/rpc/http-transport.ts",
    "apps/server/src/access-session.ts",
    "packages/ragents/src/access.ts",
    "apps/server/src/host-package.ts",
    "packages/workspace-executor/src/processes/tunnel.ts",
  ],
} as const;
