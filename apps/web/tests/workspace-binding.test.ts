import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SessionInfo } from "../src/api.ts";
import type { SessionContext } from "../src/PluginRegistry.tsx";
import type { StartOptionState } from "../../server/src/plugin-support/start-options-contract.ts";
import {
  WORKSPACE_BINDING_OPTION_ID,
  WORKSPACE_METADATA_ID,
  type WorkspaceBinding,
  type WorkspaceClientInfo,
} from "../../../plugins/ragents.workspace/contract.ts";
import {
  workspaceFolderChoices,
  workspaceMachineChoices,
  WorkspaceBindingBadge,
  WorkspaceBindingControl,
  WorkspaceMetadata,
} from "../../../plugins/ragents.workspace/web/WorkspaceBinding.tsx";

const client = (values: Partial<WorkspaceClientInfo> & { id: string; label: string }): WorkspaceClientInfo => ({
  hostname: "workstation",
  platform: "darwin",
  folders: ["/Users/example/repos/eins", "/Users/example/repos/zwei"],
  runsDirectory: "/Users/example/.local/share/ragents/workspace/runs",
  ...values,
});

const option = (
  value: unknown,
  presentation: unknown,
  locked = false,
): StartOptionState => ({
  id: WORKSPACE_BINDING_OPTION_ID,
  owner: "ragents.workspace",
  value,
  presentation,
  selectable: true,
  locked,
});

const presentationWith = (...clients: WorkspaceClientInfo[]) =>
  ({ kind: "workspace-binding", clients, fresh: { server: "Leerer Ordner je Run", client: "Leerer Ordner je Run" }, serverFolders: true });

const contributedPresentation = (...clients: WorkspaceClientInfo[]) =>
  ({ kind: "workspace-binding", clients, fresh: { server: "Worktree je Run", client: null }, serverFolders: false });

const serverFresh: WorkspaceBinding = { machine: "server", folder: "fresh" };

const serverProject: WorkspaceBinding = { machine: "server", folder: { path: "/Users/example/repos/eins" } };

const notebookProject: WorkspaceBinding = { machine: { client: "laptop-01", label: "Notebook" }, folder: { path: "/Users/example/repos/eins" } };

const notebookFresh: WorkspaceBinding = {
  machine: { client: "laptop-01", label: "Notebook" },
  folder: { path: "/Users/example/.local/share/ragents/workspace/runs/run-1", fresh: true },
};

const session = (binding: WorkspaceBinding, summary: string): SessionInfo => ({
  id: "run-1",
  title: "Ein Run",
  updatedAt: 0,
  metadata: { [WORKSPACE_METADATA_ID]: { binding, summary } },
});

const control = (value: unknown, presentation: unknown) => renderToStaticMarkup(createElement(WorkspaceBindingControl, {
  disabled: false,
  error: undefined,
  option: option(value, presentation),
  setValue: async () => {},
}));

test("der Rechner nennt den Server und jeden verbundenen Arbeitsplatz", () => {
  const clients = [client({ id: "laptop-01", label: "Notebook" }), client({ id: "studio-02", label: "Mac Studio" })];
  assert.deepEqual(workspaceMachineChoices(presentationWith(...clients), serverFresh), [
    { value: "server", label: "Server" },
    { value: "laptop-01", label: "Arbeitsplatz Notebook" },
    { value: "studio-02", label: "Arbeitsplatz Mac Studio" },
  ]);
});

test("ein gebundener, nicht mehr verbundener Arbeitsplatz bleibt als Rechner erhalten", () => {
  assert.deepEqual(workspaceMachineChoices(presentationWith(), notebookProject).at(-1), {
    value: "laptop-01",
    label: "Arbeitsplatz Notebook (nicht verbunden)",
  });
  assert.equal(workspaceMachineChoices(presentationWith(client({ id: "laptop-01", label: "Notebook" })), notebookProject).length, 2);
});

test("der Ordner bietet auf jedem Rechner den neuen und den vorhandenen an, soweit es sie dort gibt", () => {
  const both = [{ value: "fresh", label: "Leerer Ordner je Run" }, { value: "existing", label: "Vorhandener Ordner" }];
  assert.deepEqual(workspaceFolderChoices(presentationWith(), "server"), both);
  assert.deepEqual(workspaceFolderChoices(presentationWith(), "laptop-01"), both);
  assert.deepEqual(workspaceFolderChoices(contributedPresentation(), "server"), [{ value: "fresh", label: "Worktree je Run" }]);
  assert.deepEqual(workspaceFolderChoices(contributedPresentation(), "laptop-01"), [{ value: "existing", label: "Vorhandener Ordner" }]);
});

test("ein beigesteuerter Arbeitsbereich benennt den neuen Ordner und lässt vorhandene Serverordner weg", () => {
  const html = control(serverFresh, contributedPresentation());
  assert.ok(html.includes("Worktree je Run"));
  assert.ok(!html.includes("Vorhandener Ordner"));
  assert.ok(!html.includes("Absoluter Pfad"));
});

test("die Control zeigt Rechner, Ordner, Pfad und die angebotenen Ordner", () => {
  const html = control(notebookProject, presentationWith(client({ id: "laptop-01", label: "Notebook" })));
  assert.ok(html.includes("Arbeitsbereich"));
  assert.ok(html.includes("Arbeitsplatz Notebook"));
  assert.ok(html.includes("Vorhandener Ordner"));
  assert.ok(html.includes('value="/Users/example/repos/eins"'));
  assert.ok(html.includes("Angebotener Ordner"));
  const fresh = control(serverFresh, presentationWith());
  assert.ok(fresh.includes("Leerer Ordner je Run"));
  assert.ok(!fresh.includes("Absoluter Pfad"));
  const workstationFresh = control(notebookFresh, presentationWith(client({ id: "laptop-01", label: "Notebook" })));
  assert.ok(workstationFresh.includes("Arbeitsplatz Notebook"));
  assert.ok(workstationFresh.includes("Leerer Ordner je Run"));
  assert.ok(!workstationFresh.includes("Absoluter Pfad"), "den Pfad des neuen Ordners wählt niemand");
  assert.ok(!workstationFresh.includes("Angebotener Ordner"));
});

test("eine unlesbare Darstellung oder ein unlesbarer Wert meldet den Fehler statt zu raten", () => {
  const broken = control(serverFresh, { kind: "choice", options: [] });
  assert.ok(broken.includes('role="alert"'));
  assert.ok(broken.includes(`Die Startoption ${WORKSPACE_BINDING_OPTION_ID} liefert keine Arbeitsbereich-Darstellung`));
  const wrongValue = control({ kind: "path" }, presentationWith());
  assert.ok(wrongValue.includes(`Der Wert der Startoption ${WORKSPACE_BINDING_OPTION_ID} ist keine Arbeitsbereich-Bindung`));
  const mixed = control({ machine: "server", folder: { path: "/srv", fresh: true } }, presentationWith());
  assert.ok(mixed.includes("ist keine Arbeitsbereich-Bindung"), "einen neuen Ordner mit Pfad gibt es nur auf einem Arbeitsplatz");
});

test("das Abzeichen erscheint erst, wenn die Bindung mit dem Start eingefroren ist, auch für ein älteres Journal", () => {
  const badge = (value: unknown, locked: boolean, presentation: unknown = presentationWith()) =>
    renderToStaticMarkup(createElement(WorkspaceBindingBadge, {
      option: option(value, presentation, locked),
      session: {} as SessionContext,
    }));
  assert.equal(badge(serverProject, false), "");
  assert.ok(badge(serverProject, true).includes("Arbeitsbereich"));
  assert.ok(badge(serverProject, true).includes("/Users/example/repos/eins"));
  assert.ok(badge(serverFresh, true).includes("Leerer Ordner je Run"));
  assert.ok(badge(serverFresh, true, contributedPresentation()).includes("Worktree je Run"));
  assert.ok(badge(notebookProject, true).includes("Notebook: /Users/example/repos/eins"));
  assert.ok(badge(notebookFresh, true).includes("Notebook: /Users/example/.local/share/ragents/workspace/runs/run-1 (Leerer Ordner je Run)"));
  assert.ok(badge({ kind: "path", path: "/Users/example/repos/eins" }, true).includes("/Users/example/repos/eins"));
  assert.ok(badge({ kind: "client", client: "laptop-01", label: "Notebook", path: "/Users/example/repos/eins" }, true)
    .includes("Notebook: /Users/example/repos/eins"));
  assert.ok(badge({ kind: "fresh" }, true).includes("Leerer Ordner je Run"));
  assert.ok(badge({ kind: "anders" }, true).includes("Arbeitsbereich unlesbar"));
});

test("die Run-Liste zeigt nur einen abweichenden Arbeitsbereich, die Kopfzeile immer", () => {
  const metadata = (placement: "header" | "list", info: SessionInfo) =>
    renderToStaticMarkup(createElement(WorkspaceMetadata, { placement, session: info }));
  assert.equal(metadata("list", session(serverFresh, "Leerer Ordner je Run")), "");
  assert.ok(metadata("header", session(serverFresh, "Leerer Ordner je Run")).includes("Leerer Ordner je Run"));
  const bound = session(serverProject, "/Users/example/repos/eins");
  assert.ok(metadata("list", bound).includes("/Users/example/repos/eins"));
  assert.ok(metadata("list", bound).includes("Arbeitsbereich: /Users/example/repos/eins"));
  assert.ok(metadata("list", session(notebookFresh, "Notebook: neuer Ordner")).includes("Notebook: neuer Ordner"), "ein neuer Ordner auf einem Arbeitsplatz weicht ab");
  assert.equal(metadata("list", { id: "run-2", title: "Ohne", updatedAt: 0 }), "");
});
