import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { OperationInput } from "../../../packages/ragents/src/rpc/contract";
import type { RpcHandlerContext } from "../../../packages/ragents/src/rpc/peer";
import {
  workspaceClientContracts,
  workspaceContracts,
  type WorkspaceBinding,
  type WorkspaceClientDescription,
} from "../../../plugins/ragents.workspace/contract";
import type { ServerClient } from "./server-client";

export type WorkspaceClientStatus =
  | { kind: "idle" }
  | { kind: "registered"; sameMachine: boolean }
  | { kind: "failed"; message: string };

export interface WorkspaceClientIdentity extends WorkspaceClientDescription {
  id: string;
}

export interface WorkspaceClientOptions {
  shell?: string;
}

type ExecInput = OperationInput<typeof workspaceClientContracts.exec>;

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** Der echte Pfad des nächsten vorhandenen Elternordners, um die noch fehlenden Namen ergänzt. */
const realPathOf = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    const parent = dirname(target);
    return parent === target ? target : join(await realPathOf(parent), basename(target));
  }
};

const inheritedEnvironment = (): Record<string, string> => Object.fromEntries(Object.entries(process.env)
  .filter(([name, value]) => typeof value === "string" && !name.startsWith("VSCODE_") && !name.startsWith("ELECTRON_"))
  .map(([name, value]) => [name, value as string]));

const sameFolders = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((folder, index) => folder === right[index]);

/** Der Arbeitsplatz der Erweiterung: bietet seine Operationen an, meldet die geöffneten Ordner an und arbeitet die Aufträge lokal ab. */
export class WorkspaceClient {
  #identity: WorkspaceClientIdentity;
  #status: WorkspaceClientStatus = { kind: "idle" };
  #announcing: Promise<void> | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #attached: Array<() => void> = [];
  readonly #shell: string;

  constructor(private readonly client: ServerClient, identity: WorkspaceClientIdentity, options: WorkspaceClientOptions = {}) {
    this.#identity = { ...identity, folders: [...identity.folders] };
    this.#shell = options.shell ?? "/bin/bash";
  }

  get id(): string {
    return this.#identity.id;
  }

  get label(): string {
    return this.#identity.label;
  }

  get folders(): readonly string[] {
    return this.#identity.folders;
  }

  get status(): WorkspaceClientStatus {
    return this.#status;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Erst die Operationen anbieten - das öffnet den Strom -, dann anmelden, sobald er steht; der Strom ist der Rückweg des Servers. */
  async register(): Promise<void> {
    this.#attach();
    try {
      await this.#connected();
    } catch (cause) {
      this.#set({ kind: "failed", message: messageOf(cause) });
      return;
    }
    await this.#announce();
  }

  /** Geänderte Ordner werden erneut angemeldet; ohne Ordner meldet sich der Arbeitsplatz ab. */
  async update(folders: readonly string[]): Promise<void> {
    if (sameFolders(this.#identity.folders, folders)) return;
    this.#identity = { ...this.#identity, folders: [...folders] };
    if (this.#status.kind === "idle") return;
    if (folders.length === 0) await this.unregister();
    else await this.register();
  }

  async unregister(): Promise<void> {
    for (const release of this.#attached.splice(0)) release();
    this.#set({ kind: "idle" });
    try {
      await this.client.rpc.call(workspaceContracts.clients.unregister, { id: this.id });
    } catch (cause) {
      this.#set({ kind: "failed", message: messageOf(cause) });
    }
  }

  /** Auf demselben Rechner bindet der Server den Ordner direkt, sonst läuft alles über diesen Arbeitsplatz. */
  binding(folder: string): WorkspaceBinding {
    return this.#status.kind === "registered" && this.#status.sameMachine
      ? { kind: "path", path: folder }
      : { kind: "client", client: this.id, label: this.label, path: folder };
  }

  #attach(): void {
    if (this.#attached.length > 0) return;
    const rpc = this.client.rpc;
    this.#attached.push(
      rpc.handle(workspaceClientContracts.readFile, async ({ path }) => ({ base64: (await readFile(await this.#inside(path))).toString("base64") })),
      rpc.handle(workspaceClientContracts.writeFile, async ({ path, content }) => {
        await writeFile(await this.#inside(path), content, "utf8");
        return null;
      }),
      rpc.handle(workspaceClientContracts.access, async ({ path, mode }) => {
        await access(await this.#inside(path), mode === "write" ? constants.R_OK | constants.W_OK : constants.R_OK);
        return null;
      }),
      rpc.handle(workspaceClientContracts.mkdir, async ({ path }) => {
        await mkdir(await this.#inside(path), { recursive: true });
        return null;
      }),
      rpc.handle(workspaceClientContracts.exec, (input, context) => this.#exec(input, context)),
      rpc.onConnected(() => void this.#announce()),
    );
  }

  /** Wartet auf den Ereignisstrom; ohne ihn nimmt der Server die Anmeldung nicht an. */
  #connected(): Promise<void> {
    const rpc = this.client.rpc;
    if (rpc.status.kind === "connected") return Promise.resolve();
    return new Promise((settle, fail) => {
      const release = rpc.onStatus((status) => {
        if (status.kind === "connecting") return;
        release();
        if (status.kind === "connected") settle();
        else if (status.kind === "retrying") fail(new Error(status.message));
        else if (status.kind === "unauthorized") fail(new Error("Der Server verlangt eine Anmeldung."));
        else fail(new Error("Der Ereignisstrom des Servers ist geschlossen."));
      });
    });
  }

  #announce(): Promise<void> {
    this.#announcing ??= this.#send().finally(() => { this.#announcing = undefined; });
    return this.#announcing;
  }

  async #send(): Promise<void> {
    try {
      const info = await this.client.rpc.call(workspaceContracts.clients.register, {
        id: this.#identity.id,
        label: this.#identity.label,
        hostname: this.#identity.hostname,
        platform: this.#identity.platform,
        folders: [...this.#identity.folders],
      });
      this.#set({ kind: "registered", sameMachine: info.sameMachine });
    } catch (cause) {
      this.#set({ kind: "failed", message: messageOf(cause) });
    }
  }

  async #exec(input: ExecInput, context: RpcHandlerContext): Promise<{ exitCode: number | null }> {
    if (this.#identity.platform === "win32") throw new Error("Bash ist auf dieser Plattform nicht verfügbar");
    const cwd = await this.#inside(input.cwd);
    const child = spawn(this.#shell, ["-c", input.command], {
      cwd,
      env: { ...inheritedEnvironment(), ...input.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const forward = (chunk: Buffer) => context.progress({ base64: chunk.toString("base64") });
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    const kill = () => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    };
    try {
      return await new Promise<{ exitCode: number | null }>((settle, fail) => {
        const cleanup: Array<() => void> = [];
        const end = (outcome: () => void) => {
          for (const undo of cleanup.splice(0)) undo();
          outcome();
        };
        const timer = setTimeout(() => end(() => { kill(); fail(new Error(`timeout:${input.timeoutSeconds}`)); }), input.timeoutSeconds * 1000);
        const abort = () => end(() => { kill(); settle({ exitCode: null }); });
        cleanup.push(() => clearTimeout(timer), () => context.signal.removeEventListener("abort", abort));
        context.signal.addEventListener("abort", abort, { once: true });
        child.on("error", (cause) => end(() => fail(cause)));
        child.on("close", (exitCode) => end(() => settle({ exitCode })));
      });
    } finally {
      await this.client.flush();
    }
  }

  /** Jeder Pfad muss in einem der angebotenen Ordner liegen; fehlende Pfade zählen über ihren vorhandenen Elternordner. */
  async #inside(candidate: string): Promise<string> {
    const target = resolve(candidate);
    const real = await realPathOf(target);
    const roots = await Promise.all(this.#identity.folders.map((folder) => realPathOf(resolve(folder))));
    if (!roots.some((root) => real === root || real.startsWith(`${root}${sep}`))) {
      throw new Error(`Pfad außerhalb des angebotenen Ordners: ${candidate}`);
    }
    return target;
  }

  #set(status: WorkspaceClientStatus): void {
    this.#status = status;
    for (const listener of [...this.#listeners]) listener();
  }
}
