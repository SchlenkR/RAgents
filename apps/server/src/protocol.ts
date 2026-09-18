import { appendFileSync, createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from "node:fs";
import path from "node:path";
import { layout } from "./layout.js";

const MAX_BYTES = 32 * 1024 * 1024;
const KEPT_GENERATIONS = 3;

export class Protocol {
  private stream: WriteStream | undefined;
  private written = 0;

  constructor(private readonly file: string, private readonly dirMode = 0o750) {}

  static forServer(): Protocol {
    return new Protocol(layout.serverLog);
  }

  static fatal(text: string): void {
    const file = layout.serverLog;
    try {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
      appendFileSync(file, `${new Date().toISOString()} [fatal] ${text}\n`, { mode: 0o640 });
    } catch {
    }
    process.stderr.write(`${text}\n`);
  }

  write(text: string): void {
    const stamp = new Date().toISOString();
    const block = text
      .split("\n")
      .map((line) => `${stamp} ${line.replaceAll("\r", "")}`)
      .join("\n");
    this.target().write(`${block}\n`);
    this.written += Buffer.byteLength(block) + 1;
    if (this.written >= MAX_BYTES) this.rotate();
  }

  async close(): Promise<void> {
    const stream = this.stream;
    this.stream = undefined;
    if (!stream || stream.closed) return;
    await new Promise<void>((resolve, reject) => {
      const finished = (): void => {
        stream.off("error", failed);
        resolve();
      };
      const failed = (error: Error): void => {
        stream.off("close", finished);
        reject(error);
      };
      stream.once("close", finished);
      stream.once("error", failed);
      stream.end();
    });
  }

  private target(): WriteStream {
    if (this.stream) return this.stream;
    mkdirSync(path.dirname(this.file), { recursive: true, mode: this.dirMode });
    this.written = statSync(this.file, { throwIfNoEntry: false })?.size ?? 0;
    this.stream = createWriteStream(this.file, { flags: "a", mode: 0o640 });
    this.stream.on("error", (error) => {
      process.stderr.write(`Protokoll ${this.file} nicht schreibbar: ${error.message}\n`);
      this.stream = undefined;
    });
    return this.stream;
  }

  private rotate(): void {
    const stream = this.stream;
    this.stream = undefined;
    this.written = 0;
    stream?.end();
    try {
      for (let generation = KEPT_GENERATIONS - 1; generation >= 1; generation--) {
        const from = generation === 1 ? this.file : `${this.file}.${generation - 1}`;
        if (statSync(from, { throwIfNoEntry: false })) renameSync(from, `${this.file}.${generation}`);
      }
    } catch (error) {
      process.stderr.write(`Protokoll ${this.file} nicht rotierbar: ${(error as Error).message}\n`);
    }
  }
}

export const teeConsole = (protocol: Protocol): void => {
  const forward = (level: string, original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      original(...args);
      protocol.write(`[${level}] ${args.map((arg) => textOf(arg)).join(" ")}`);
    };
  console.log = forward("log", console.log.bind(console));
  console.info = forward("info", console.info.bind(console));
  console.warn = forward("warn", console.warn.bind(console));
  console.error = forward("error", console.error.bind(console));
};

const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ""}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
