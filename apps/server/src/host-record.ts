import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface HostRecord {
  readonly profile: string;
  readonly url: string;
  readonly pid: number;
  readonly log: string;
  readonly startedAt: string;
}

/** Der gemerkte Host eines Profils; ragents run und ragents start schreiben dieselbe Datei, stop --host liest sie. */
export const hostRecordFile = (dataDirectory: string): string => path.join(dataDirectory, "host.json");

export const readHostRecord = (dataDirectory: string): HostRecord | undefined => {
  const file = hostRecordFile(dataDirectory);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<HostRecord>;
  // Eine PID unter 1 wäre für process.kill die ganze Prozessgruppe; sie darf nie aus dieser Datei kommen.
  if (typeof parsed.url !== "string" || !Number.isInteger(parsed.pid) || (parsed.pid ?? 0) < 1) throw new Error(`${file} nennt keine Adresse oder keine PID des Hosts`);
  return parsed as HostRecord;
};

export const writeHostRecord = (dataDirectory: string, record: HostRecord): void => {
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(hostRecordFile(dataDirectory), `${JSON.stringify(record, null, 2)}\n`);
};

export const removeHostRecord = (dataDirectory: string): void => {
  rmSync(hostRecordFile(dataDirectory), { force: true });
};
