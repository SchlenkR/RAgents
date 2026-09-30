import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

export interface OwnerLifetimeOptions {
  readonly detached?: boolean;
  readonly parents?: readonly number[];
  readonly onStop: (reason: string) => void;
  readonly stdin?: Pick<Readable, "on" | "off" | "resume" | "pause" | "destroyed" | "readableEnded"> | null;
  readonly signals?: EventEmitter;
  readonly alive?: (pid: number) => boolean;
  readonly intervalMs?: number;
}

export function processAlive(pid: number): boolean;
export function watchOwnerLifetime(options: OwnerLifetimeOptions): () => void;
export function processChildren(pid?: number): number[];
export function terminateProcessTree(pid: number): void;
export function exitWorkspaceProcess(code: number): never;
