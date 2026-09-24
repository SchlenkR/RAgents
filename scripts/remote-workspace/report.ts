export type Outcome = "ok" | "FEHLER" | "übersprungen";

export interface CheckResult {
  readonly area: string;
  readonly title: string;
  readonly outcome: Outcome;
  readonly detail: string;
}

/** Was eine Prüfung zurückgibt: einen Wert für die folgenden Prüfungen und eine Zeile für den Bericht. */
export interface Checked<T> {
  readonly value: T;
  readonly detail: string;
}

export const passed = (detail: string): Checked<true> => ({ value: true, detail });

/** Eine Bedingung der Prüfung; die Meldung wird die Ursache in der Zeile FEHLER. */
export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const AREA_WIDTH = 14;

/** Sammelt die Prüfungen in Reihenfolge und schreibt je Prüfung genau eine Zeile. */
export class Report {
  readonly #results: CheckResult[] = [];
  readonly #write: (line: string) => void;
  #aborted = false;

  constructor(write: (line: string) => void) {
    this.#write = write;
  }

  get results(): readonly CheckResult[] {
    return this.#results;
  }

  get failed(): boolean {
    return this.#results.some((result) => result.outcome !== "ok");
  }

  /** Nach einem Abbruch startet keine Prüfung mehr, und eine laufende meldet nichts mehr; nur das Aufräumen läuft über final weiter. */
  abort(): void {
    this.#aborted = true;
  }

  check<T>(area: string, title: string, run: () => Promise<Checked<T>>): Promise<T | undefined> {
    return this.#aborted ? Promise.resolve(undefined) : this.#run(area, title, run, true);
  }

  final<T>(area: string, title: string, run: () => Promise<Checked<T>>): Promise<T | undefined> {
    return this.#run(area, title, run, false);
  }

  async #run<T>(area: string, title: string, run: () => Promise<Checked<T>>, abortable: boolean): Promise<T | undefined> {
    const started = Date.now();
    const outcome = await run().then((checked) => ({ checked }), (error: unknown) => ({ error }));
    if (abortable && this.#aborted) return undefined;
    if ("error" in outcome) {
      this.#add({ area, title, outcome: "FEHLER", detail: messageOf(outcome.error) });
      return undefined;
    }
    this.#add({ area, title, outcome: "ok", detail: `${outcome.checked.detail} (${((Date.now() - started) / 1000).toFixed(1)} s)` });
    return outcome.checked.value;
  }

  skip(area: string, titles: readonly string[], reason: string): void {
    if (this.#aborted) return;
    for (const title of titles) this.#add({ area, title, outcome: "übersprungen", detail: reason });
  }

  summary(): string {
    const count = (outcome: Outcome) => this.#results.filter((result) => result.outcome === outcome).length;
    return `${count("ok")} ok, ${count("FEHLER")} FEHLER, ${count("übersprungen")} übersprungen`;
  }

  #add(result: CheckResult): void {
    this.#results.push(result);
    const marker = result.outcome === "ok" ? "ok    " : result.outcome === "FEHLER" ? "FEHLER" : "--    ";
    const [first, ...rest] = result.detail.split("\n");
    this.#write(`${marker}  ${result.area.padEnd(AREA_WIDTH)} ${result.title}: ${first}`);
    for (const line of rest) this.#write(`${" ".repeat(8 + AREA_WIDTH + 1)}${line}`);
  }
}
