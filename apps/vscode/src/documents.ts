import * as vscode from "vscode";
import type { ServerClient } from "./server-client";

export const DOCUMENT_SCHEME = "ragents";

const segment = (value: string) => encodeURIComponent(value);

export const artifactUri = (runId: string, artifactId: string, title: string): vscode.Uri =>
  vscode.Uri.parse(`${DOCUMENT_SCHEME}:/runs/${segment(runId)}/artifacts/${segment(artifactId)}/${segment(title || artifactId)}`);

export const journalUri = (runId: string, title: string): vscode.Uri =>
  vscode.Uri.parse(`${DOCUMENT_SCHEME}:/runs/${segment(runId)}/journal/${segment(`${title || runId}.journal.json`)}`);

/** Artefakte und Journale eines Runs als schreibgeschützte Dokumente, geladen mit dem Zugang der Erweiterung. */
export class RunDocuments implements vscode.TextDocumentContentProvider {
  readonly #changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.#changed.event;

  constructor(private readonly client: () => ServerClient) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parts = uri.path.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "runs" || parts[1] === undefined) throw new Error(`Unbekannte RAgents-Adresse: ${uri.toString()}`);
    const runId = parts[1];
    if (parts[2] === "artifacts" && parts[3] !== undefined) return this.client().artifactText(runId, parts[3]);
    if (parts[2] === "journal") return `${JSON.stringify(await this.client().journal(runId), null, 2)}\n`;
    throw new Error(`Unbekannte RAgents-Adresse: ${uri.toString()}`);
  }

  invalidate(uri: vscode.Uri): void {
    this.#changed.fire(uri);
  }

  dispose(): void {
    this.#changed.dispose();
  }
}
