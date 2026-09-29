import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface HostRecord {
  readonly profile: string;
  readonly url: string;
  readonly pid: number;
  readonly log: string;
  readonly startedAt: string;
}

/** The remembered host of a profile; ragents run and ragents start write the same file, stop --host reads it. */
export const hostRecordFile = (dataDirectory: string): string => path.join(dataDirectory, "host.json");

export const readHostRecord = (dataDirectory: string): HostRecord | undefined => {
  const file = hostRecordFile(dataDirectory);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<HostRecord>;
  // A PID below 1 would mean the whole process group to process.kill; it must never come from this file.
  if (typeof parsed.url !== "string" || !Number.isInteger(parsed.pid) || (parsed.pid ?? 0) < 1) throw new Error(`${file} names no address or no PID of the host`);
  return parsed as HostRecord;
};

export const writeHostRecord = (dataDirectory: string, record: HostRecord): void => {
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(hostRecordFile(dataDirectory), `${JSON.stringify(record, null, 2)}\n`);
};

export const removeHostRecord = (dataDirectory: string): void => {
  rmSync(hostRecordFile(dataDirectory), { force: true });
};
