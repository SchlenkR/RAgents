import { lookup } from "node:dns/promises";
import { stat } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";
import { isCheckout } from "../../apps/server/src/host-web.ts";
import { hostRoot } from "../../apps/server/src/host-version.ts";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { resolveBundledTools } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { WorkspaceClient } from "../../plugins/ragents.workspace/client/workspace-client.ts";
import type { WorkspaceBinding } from "../../plugins/ragents.workspace/contract.ts";
import { hostClient, LOGIN_REQUIRED } from "../agent/host.ts";
import { workspaceClientId } from "../workspace-client/run-workspace-client.ts";

export const localHostAddress = async (address: string): Promise<boolean> => {
  const host = new URL(address).hostname.replace(/^\[|\]$/g, "");
  const loopback = (value: string): boolean => value === "::1" || /^127\./.test(value) || /^::ffff:127\./.test(value);
  if (host === "localhost" || loopback(host)) return true;
  const own = new Set(Object.values(networkInterfaces()).flatMap((entries) => entries?.map(({ address }) => address) ?? []));
  const addresses = await lookup(host, { all: true });
  return addresses.length > 0 && addresses.every(({ address }) => loopback(address) || own.has(address));
};

export class EditorWorkspaces {
  readonly #clients = new Map<string, Promise<{ client: WorkspaceClient; rpc: RpcClient }>>();

  constructor(readonly address: string, readonly remote: boolean, readonly dataDirectory: string) {}

  async binding(cwd: string): Promise<WorkspaceBinding> {
    if (!path.isAbsolute(cwd)) throw new Error("The session cwd must be an absolute path.");
    if (!this.remote) return { machine: "server", folder: { path: path.resolve(cwd) } };
    if (!(await stat(cwd)).isDirectory()) throw new Error(`The session folder is not a directory: ${cwd}`);
    const folder = path.resolve(cwd);
    const pending = this.#clients.get(folder) ?? this.#register(folder);
    this.#clients.set(folder, pending);
    const { client } = await pending.catch((cause: unknown) => { this.#clients.delete(folder); throw cause; });
    if (client.status.kind !== "registered") throw new Error(client.status.kind === "failed" ? client.status.message : "The editor workstation is disconnected.");
    return client.binding(folder);
  }

  async #register(folder: string): Promise<{ client: WorkspaceClient; rpc: RpcClient }> {
    const machine = hostname();
    const root = hostRoot();
    const tools = resolveBundledTools({ root: isCheckout(root) ? path.join(root, "apps/vscode") : root, distribution: isCheckout(root) ? "extension" : "package" });
    const rpc = hostClient(this.address);
    const client = new WorkspaceClient({ origin: this.address, rpc }, {
      id: workspaceClientId(machine, [folder]).replace(/^cli-/, "acp-"), label: `ACP (${machine})`, hostname: machine,
      platform: process.platform, folders: [folder], runsDirectory: path.join(this.dataDirectory, "acp-workspaces"),
    }, { hostRoot, ...tools });
    try {
      await client.register();
      if (client.status.kind !== "registered") throw new Error(client.status.kind === "failed" ? client.status.message : "The editor workstation was not registered.");
      return { client, rpc };
    } catch (cause) {
      const unauthorized = rpc.status.kind === "unauthorized";
      await client.unregister();
      rpc.close();
      if (unauthorized) throw new Error(LOGIN_REQUIRED);
      throw cause;
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.#clients.values()].map(async (pending) => {
      const { client, rpc } = await pending;
      try { await client.unregister(); } finally { rpc.close(); }
    }));
    this.#clients.clear();
  }
}
