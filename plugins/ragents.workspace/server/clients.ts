import { Value } from "typebox/value";
import { DomainError, implement, type AccessContext, type MethodConnection, type MethodContribution } from "@aicontainer/ragents";
import type { RemoteWorkspaceOperations } from "@aicontainer/server/ragents/workspace-runtime.js";
import {
  workspaceClientContracts,
  workspaceClientOutputSchema,
  workspaceContracts,
  type WorkspaceClientDescription,
  type WorkspaceClientInfo,
} from "../contract.js";

interface ClientEntry {
  info: WorkspaceClientInfo;
  owner: string | null;
  connection: MethodConnection | undefined;
  release: (() => void) | undefined;
}

export interface WorkspaceClientRegistryOptions {
  serverHostname: string;
  folderExists: (folder: string) => Promise<boolean>;
}

const CALL_TIMEOUT_MS = 120_000;
const EXEC_GRACE_MS = 30_000;

export const ownerOf = (access: AccessContext): string | null => access.user?.id ?? null;

const outputOf = (label: string, value: unknown): Buffer => {
  if (!Value.Check(workspaceClientOutputSchema, value)) throw new Error(`Der Arbeitsplatz ${label} hat keine gültige Ausgabe geliefert`);
  return Buffer.from(value.base64, "base64");
};

/** Kennt die angemeldeten Arbeitsplätze und hält je Client die Verbindung, über die der Server ihn zurückruft. */
export class WorkspaceClientRegistry {
  readonly #options: WorkspaceClientRegistryOptions;
  readonly #clients = new Map<string, ClientEntry>();

  constructor(options: WorkspaceClientRegistryOptions) {
    this.#options = options;
  }

  async register(id: string, description: WorkspaceClientDescription, connection: MethodConnection): Promise<WorkspaceClientInfo> {
    if (connection.streamless) {
      throw new DomainError("stream-required", "Die Anmeldung eines Arbeitsplatzes braucht einen Ereignisstrom.", 409);
    }
    const owner = connection.userId;
    const existing = this.#clients.get(id);
    if (existing && existing.owner !== owner) {
      throw new DomainError("workspace-client-foreign", `Der Arbeitsplatz ${id} gehört einem anderen Benutzer.`, 403);
    }
    const sameMachine = description.hostname === this.#options.serverHostname
      && (await Promise.all(description.folders.map(this.#options.folderExists))).every(Boolean);
    existing?.release?.();
    const info: WorkspaceClientInfo = { ...description, id, connected: true, sameMachine };
    const release = connection.onClose(() => this.#disconnected(id, connection));
    this.#clients.set(id, { info, owner, connection, release });
    return info;
  }

  unregister(id: string, owner: string | null): void {
    const entry = this.#entry(id, owner);
    entry.release?.();
    this.#clients.delete(id);
  }

  list(): WorkspaceClientInfo[] {
    return [...this.#clients.values()].map((entry) => entry.info);
  }

  connected(): WorkspaceClientInfo[] {
    return this.list().filter((info) => info.connected);
  }

  info(id: string): WorkspaceClientInfo | undefined {
    return this.#clients.get(id)?.info;
  }

  operationsFor(id: string, label: string): RemoteWorkspaceOperations {
    const connection = (): MethodConnection => {
      const entry = this.#clients.get(id);
      if (!entry?.connection) throw new DomainError("workspace-client-disconnected", `Der Arbeitsplatz ${label} ist nicht verbunden.`, 409);
      return entry.connection;
    };
    return {
      label,
      readFile: async (absolutePath) => {
        const result = await connection().call(workspaceClientContracts.readFile, { path: absolutePath }, { timeoutMs: CALL_TIMEOUT_MS });
        return Buffer.from(result.base64, "base64");
      },
      writeFile: async (absolutePath, content) => {
        await connection().call(workspaceClientContracts.writeFile, { path: absolutePath, content }, { timeoutMs: CALL_TIMEOUT_MS });
      },
      access: async (absolutePath, mode) => {
        await connection().call(workspaceClientContracts.access, { path: absolutePath, mode }, { timeoutMs: CALL_TIMEOUT_MS });
      },
      mkdir: async (directory) => {
        await connection().call(workspaceClientContracts.mkdir, { path: directory }, { timeoutMs: CALL_TIMEOUT_MS });
      },
      exec: async (command, cwd, options) => connection().call(
        workspaceClientContracts.exec,
        { command, cwd, env: { ...options.env }, timeoutSeconds: options.timeoutSeconds },
        {
          signal: options.signal,
          timeoutMs: options.timeoutSeconds * 1000 + EXEC_GRACE_MS,
          onProgress: (value) => options.onData(outputOf(label, value)),
        },
      ),
    };
  }

  shutdown(): void {
    for (const entry of this.#clients.values()) entry.release?.();
    this.#clients.clear();
  }

  #entry(id: string, owner: string | null): ClientEntry {
    const entry = this.#clients.get(id);
    if (!entry) throw new DomainError("workspace-client-unknown", `Der Arbeitsplatz ${id} ist nicht angemeldet.`, 404);
    if (entry.owner !== owner) throw new DomainError("workspace-client-foreign", `Der Arbeitsplatz ${id} gehört einem anderen Benutzer.`, 403);
    return entry;
  }

  /** Eine spätere Anmeldung über eine neue Verbindung bleibt stehen; nur die aktuelle Verbindung meldet ab. */
  #disconnected(id: string, connection: MethodConnection): void {
    const entry = this.#clients.get(id);
    if (!entry || entry.connection !== connection) return;
    this.#clients.set(id, { ...entry, info: { ...entry.info, connected: false }, connection: undefined, release: undefined });
  }
}

export const clientMethods = (registry: WorkspaceClientRegistry): MethodContribution[] => [
  implement(workspaceContracts.clients.list, () => registry.list()),
  implement(workspaceContracts.clients.register, ({ id, ...description }, { connection }) => registry.register(id, description, connection)),
  implement(workspaceContracts.clients.unregister, ({ id }, { access }) => {
    registry.unregister(id, ownerOf(access));
    return null;
  }),
];
