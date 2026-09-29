import * as vscode from "vscode";
import { runContracts } from "../../../packages/ragents/src/http/contracts";
import type { ServerClient } from "./server-client";

export const DOCUMENT_SCHEME = "ragents";

const segment = (value: string) => encodeURIComponent(value);

export const journalUri = (connection: string, runId: string, title: string): vscode.Uri =>
  vscode.Uri.parse(`${DOCUMENT_SCHEME}:/connections/${segment(connection)}/runs/${segment(runId)}/journal/${segment(`${title || runId}.journal.json`)}`);

/** The journal of a run as a read-only document, loaded with the access of its server. */
export class RunDocuments implements vscode.TextDocumentContentProvider {
  readonly #changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.#changed.event;

  constructor(private readonly client: (connection: string) => ServerClient) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parts = uri.path.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "connections" || parts[1] === undefined || parts[2] !== "runs" || parts[3] === undefined) {
      throw new Error(`Unknown RAgents address: ${uri.toString()}`);
    }
    const client = this.client(parts[1]);
    const runId = parts[3];
    if (parts[4] === "journal") return `${JSON.stringify(await client.rpc.call(runContracts.events, { runId }), null, 2)}\n`;
    throw new Error(`Unknown RAgents address: ${uri.toString()}`);
  }

  invalidate(uri: vscode.Uri): void {
    this.#changed.fire(uri);
  }

  dispose(): void {
    this.#changed.dispose();
  }
}
