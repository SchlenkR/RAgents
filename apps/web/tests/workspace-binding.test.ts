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
  workspaceBindingChoices,
  WorkspaceBindingBadge,
  WorkspaceBindingControl,
  WorkspaceMetadata,
} from "../../../plugins/ragents.workspace/web/WorkspaceBinding.tsx";

const client = (values: Partial<WorkspaceClientInfo> & { id: string; label: string }): WorkspaceClientInfo => ({
  hostname: "macstudio",
  platform: "darwin",
  folders: ["/Users/ronald/repos/eins", "/Users/ronald/repos/zwei"],
  connected: true,
  sameMachine: false,
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

const presentationWith = (...clients: WorkspaceClientInfo[]) => ({ kind: "workspace-binding", clients });

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

test("die Auswahl nennt beide Serverarten und jeden verbundenen Arbeitsplatz", () => {
  const clients = [client({ id: "laptop-01", label: "Notebook" }), client({ id: "studio-02", label: "Mac Studio" })];
  assert.deepEqual(workspaceBindingChoices(clients, { kind: "fresh" }), [
    { value: "fresh", label: "Leerer Ordner je Run" },
    { value: "path", label: "Ordner auf dem Server" },
    { value: "laptop-01", label: "Arbeitsplatz Notebook" },
    { value: "studio-02", label: "Arbeitsplatz Mac Studio" },
  ]);
});

test("ein gebundener, nicht mehr verbundener Arbeitsplatz bleibt als Auswahl erhalten", () => {
  const binding: WorkspaceBinding = { kind: "client", client: "laptop-01", label: "Notebook", path: "/Users/ronald/repos/eins" };
  assert.deepEqual(workspaceBindingChoices([], binding).at(-1), {
    value: "laptop-01",
    label: "Arbeitsplatz Notebook (nicht verbunden)",
  });
  assert.equal(workspaceBindingChoices([client({ id: "laptop-01", label: "Notebook" })], binding).length, 3);
});

test("die Control zeigt die gewählte Art, den Pfad und die angebotenen Ordner", () => {
  const html = control(
    { kind: "client", client: "laptop-01", label: "Notebook", path: "/Users/ronald/repos/eins" },
    presentationWith(client({ id: "laptop-01", label: "Notebook" })),
  );
  assert.ok(html.includes("Arbeitsbereich"));
  assert.ok(html.includes("Arbeitsplatz Notebook"));
  assert.ok(html.includes('value="/Users/ronald/repos/eins"'));
  assert.ok(html.includes("Angebotener Ordner"));
  const fresh = control({ kind: "fresh" }, presentationWith());
  assert.ok(fresh.includes("Leerer Ordner je Run"));
  assert.ok(!fresh.includes("Absoluter Pfad"));
});

test("eine unlesbare Darstellung oder ein unlesbarer Wert meldet den Fehler statt zu raten", () => {
  const broken = control({ kind: "fresh" }, { kind: "choice", options: [] });
  assert.ok(broken.includes('role="alert"'));
  assert.ok(broken.includes(`Die Startoption ${WORKSPACE_BINDING_OPTION_ID} liefert keine Arbeitsbereich-Darstellung`));
  const wrongValue = control({ kind: "path" }, presentationWith());
  assert.ok(wrongValue.includes(`Der Wert der Startoption ${WORKSPACE_BINDING_OPTION_ID} ist keine Arbeitsbereich-Bindung`));
});

test("das Abzeichen erscheint erst, wenn die Bindung mit dem Start eingefroren ist", () => {
  const badge = (value: unknown, locked: boolean) => renderToStaticMarkup(createElement(WorkspaceBindingBadge, {
    option: option(value, presentationWith(), locked),
    session: {} as SessionContext,
  }));
  const bound = { kind: "path", path: "/Users/ronald/repos/eins" };
  assert.equal(badge(bound, false), "");
  assert.ok(badge(bound, true).includes("Arbeitsbereich"));
  assert.ok(badge(bound, true).includes("/Users/ronald/repos/eins"));
  assert.ok(badge({ kind: "fresh" }, true).includes("Leerer Ordner je Run"));
  assert.ok(badge({ kind: "anders" }, true).includes("Arbeitsbereich unlesbar"));
});

test("die Run-Liste zeigt nur einen abweichenden Arbeitsbereich, die Kopfzeile immer", () => {
  const metadata = (placement: "header" | "list", info: SessionInfo) =>
    renderToStaticMarkup(createElement(WorkspaceMetadata, { placement, session: info }));
  assert.equal(metadata("list", session({ kind: "fresh" }, "Leerer Ordner je Run")), "");
  assert.ok(metadata("header", session({ kind: "fresh" }, "Leerer Ordner je Run")).includes("Leerer Ordner je Run"));
  const bound = session({ kind: "path", path: "/Users/ronald/repos/eins" }, "/Users/ronald/repos/eins");
  assert.ok(metadata("list", bound).includes("/Users/ronald/repos/eins"));
  assert.ok(metadata("list", bound).includes("Arbeitsbereich: /Users/ronald/repos/eins"));
  assert.equal(metadata("list", { id: "run-2", title: "Ohne", updatedAt: 0 }), "");
});
