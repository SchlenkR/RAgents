import { writeFileSync } from "node:fs";
import * as vscode from "vscode";
import type { ColumnHostMessage } from "../../../web/src/column/host-contract";
import type { RAgentsApi } from "../../src/extension";

const waitFor = async (condition: () => boolean, timeoutMs: number, label: string): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Zeitüberschreitung: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** Läuft im Extension-Host eines echten VS Code gegen einen laufenden Server; tests/host/launch.mjs startet ihn. */
export async function run(): Promise<void> {
  const report: Record<string, unknown> = {};
  const output = process.env.RAGENTS_HOST_TEST_OUTPUT;
  try {
    const extension = vscode.extensions.getExtension<RAgentsApi>("schlenkr.ragents-vscode");
    if (!extension) throw new Error("Die Erweiterung schlenkr.ragents-vscode ist nicht geladen.");
    const api = await extension.activate();
    const seen: ColumnHostMessage[] = [];
    api.messages((message) => seen.push(message));
    const token = process.env.RAGENTS_HOST_TEST_TOKEN;
    if (token) {
      await waitFor(() => api.store.status.kind === "login-required", 15_000, "Server verlangt einen Zugangstoken");
      report.tokenGate = api.store.status;
      await api.applyToken(token);
    }
    const login = process.env.RAGENTS_HOST_TEST_LOGIN;
    if (login) {
      await waitFor(() => api.store.status.kind === "login-required", 15_000, "Server verlangt eine Anmeldung");
      report.loginRequired = api.store.status;
      const [id, password] = login.split(":", 2);
      await api.loginWith(id ?? "", password ?? "");
      report.user = api.store.user;
    }
    await vscode.commands.executeCommand("workbench.view.extension.ragents-explorer");
    await vscode.commands.executeCommand("ragents.column.focus");
    await waitFor(() => api.store.status.kind === "connected" && api.store.runs.length > 0 && api.store.runs.every((run) => run.loaded), 20_000, "Verbindung und Laufansichten");
    report.status = api.store.status;
    report.runs = api.store.runs.map((run) => ({ id: run.id, title: run.title, state: run.state, actors: run.actors.length, apps: run.apps.map((app) => app.id), questions: run.questions }));
    await waitFor(() => seen.some((message) => message.type === "ready"), 30_000, "Spalte meldet ready");
    const run = api.store.runs.find((entry) => entry.apps.length > 0) ?? api.store.runs[0]!;
    api.selectRun(run.id);
    await waitFor(() => seen.some((message) => message.type === "runChanged" && message.runId === run.id), 15_000, "Spalte übernimmt den Run");
    const app = run.apps[0];
    if (app) {
      await vscode.commands.executeCommand("ragents.openAppInCenter", run.id, app.id, app.title);
      await waitFor(() => seen.filter((message) => message.type === "ready").length >= 2, 30_000, "Mini-App in der Mitte meldet ready");
      report.centerApp = app.id;
    }
    report.messages = seen;
    report.ok = true;
  } catch (cause) {
    report.ok = false;
    report.error = cause instanceof Error ? cause.message : String(cause);
  }
  if (output) writeFileSync(output, JSON.stringify(report, null, 2));
  if (report.ok !== true) throw new Error(String(report.error));
}
