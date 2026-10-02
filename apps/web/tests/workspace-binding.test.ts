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
  folders: ["/Users/example/repos/one", "/Users/example/repos/two"],
  runsDirectory: "/Users/example/.local/share/ragents/workspace/runs",
  ripgrep: true,
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
  ({ kind: "workspace-binding", clients, fresh: { server: "Empty folder per run", client: "Empty folder per run" }, serverFolders: true });

const contributedPresentation = (...clients: WorkspaceClientInfo[]) =>
  ({ kind: "workspace-binding", clients, fresh: { server: "Worktree per run", client: null }, serverFolders: false });

const serverFresh: WorkspaceBinding = { machine: "server", folder: "fresh" };

const serverProject: WorkspaceBinding = { machine: "server", folder: { path: "/Users/example/repos/one" } };

const notebookProject: WorkspaceBinding = { machine: { client: "laptop-01", label: "Notebook" }, folder: { path: "/Users/example/repos/one" } };

const notebookFresh: WorkspaceBinding = {
  machine: { client: "laptop-01", label: "Notebook" },
  folder: { path: "/Users/example/.local/share/ragents/workspace/runs/run-1", fresh: true },
};

const session = (binding: WorkspaceBinding, summary: string): SessionInfo => ({
  id: "run-1",
  title: "A run",
  updatedAt: 0,
  metadata: { [WORKSPACE_METADATA_ID]: { binding, summary } },
});

const control = (value: unknown, presentation: unknown, machines: "server" | "all" = "all") => renderToStaticMarkup(createElement(WorkspaceBindingControl, {
  disabled: false,
  error: undefined,
  machines,
  option: option(value, presentation),
  setValue: async () => {},
}));

test("the machine lists the server and every connected workstation", () => {
  const clients = [client({ id: "laptop-01", label: "Notebook" }), client({ id: "studio-02", label: "Mac Studio" })];
  assert.deepEqual(workspaceMachineChoices(presentationWith(...clients), serverFresh, "all"), [
    { value: "server", label: "Server" },
    { value: "laptop-01", label: "Workstation Notebook" },
    { value: "studio-02", label: "Workstation Mac Studio" },
  ]);
});

test("a bound workstation that is no longer connected is kept as a machine", () => {
  assert.deepEqual(workspaceMachineChoices(presentationWith(), notebookProject, "all").at(-1), {
    value: "laptop-01",
    label: "Workstation Notebook (not connected)",
  });
  assert.equal(workspaceMachineChoices(presentationWith(client({ id: "laptop-01", label: "Notebook" })), notebookProject, "all").length, 2);
});

test("if the host offers only the server, the workstations are missing; one already chosen stays readable", () => {
  const clients = [client({ id: "laptop-01", label: "Notebook" }), client({ id: "studio-02", label: "Mac Studio" })];
  assert.deepEqual(workspaceMachineChoices(presentationWith(...clients), serverFresh, "server"), [{ value: "server", label: "Server" }]);
  assert.deepEqual(workspaceMachineChoices(presentationWith(...clients), notebookProject, "server"), [
    { value: "server", label: "Server" },
    { value: "laptop-01", label: "Workstation Notebook" },
  ]);
  assert.ok(!control(serverFresh, presentationWith(...clients), "server").includes("Workstation"));
});

test("the folder offers the new and the existing one on every machine, as far as they exist there", () => {
  const both = [{ value: "fresh", label: "Empty folder per run" }, { value: "existing", label: "Existing folder" }];
  assert.deepEqual(workspaceFolderChoices(presentationWith(), "server"), both);
  assert.deepEqual(workspaceFolderChoices(presentationWith(), "laptop-01"), both);
  assert.deepEqual(workspaceFolderChoices(contributedPresentation(), "server"), [{ value: "fresh", label: "Worktree per run" }]);
  assert.deepEqual(workspaceFolderChoices(contributedPresentation(), "laptop-01"), [{ value: "existing", label: "Existing folder" }]);
});

test("a contributed workspace names the new folder and omits existing server folders", () => {
  const html = control(serverFresh, contributedPresentation());
  assert.ok(html.includes("Worktree per run"));
  assert.ok(!html.includes("Existing folder"));
  assert.ok(!html.includes("Absolute path"));
});

test("the control shows machine, folder, path and the offered folders", () => {
  const html = control(notebookProject, presentationWith(client({ id: "laptop-01", label: "Notebook" })));
  assert.ok(html.includes("Workspace"));
  assert.ok(html.includes("Workstation Notebook"));
  assert.ok(html.includes("Existing folder"));
  assert.ok(html.includes('value="/Users/example/repos/one"'));
  assert.ok(html.includes("Offered folder"));
  const fresh = control(serverFresh, presentationWith());
  assert.ok(fresh.includes("Empty folder per run"));
  assert.ok(!fresh.includes("Absolute path"));
  const workstationFresh = control(notebookFresh, presentationWith(client({ id: "laptop-01", label: "Notebook" })));
  assert.ok(workstationFresh.includes("Workstation Notebook"));
  assert.ok(workstationFresh.includes("Empty folder per run"));
  assert.ok(!workstationFresh.includes("Absolute path"), "nobody chooses the path of the new folder");
  assert.ok(!workstationFresh.includes("Offered folder"));
});

test("an unreadable presentation or value reports the error instead of guessing", () => {
  const broken = control(serverFresh, { kind: "choice", options: [] });
  assert.ok(broken.includes('role="alert"'));
  assert.ok(broken.includes(`The start option ${WORKSPACE_BINDING_OPTION_ID} does not provide a workspace presentation`));
  const wrongValue = control({ kind: "path" }, presentationWith());
  assert.ok(wrongValue.includes(`The value of the start option ${WORKSPACE_BINDING_OPTION_ID} is not a workspace binding`));
  const mixed = control({ machine: "server", folder: { path: "/srv", fresh: true } }, presentationWith());
  assert.ok(mixed.includes("is not a workspace binding"), "a new folder with a path exists only on a workstation");
});

test("the badge appears only once the binding is frozen with the start, also for an older journal", () => {
  const badge = (value: unknown, locked: boolean, presentation: unknown = presentationWith()) =>
    renderToStaticMarkup(createElement(WorkspaceBindingBadge, {
      option: option(value, presentation, locked),
      session: {} as SessionContext,
    }));
  assert.equal(badge(serverProject, false), "");
  assert.ok(badge(serverProject, true).includes("Workspace"));
  assert.ok(badge(serverProject, true).includes("/Users/example/repos/one"));
  assert.ok(badge(serverFresh, true).includes("Empty folder per run"));
  assert.ok(badge(serverFresh, true, contributedPresentation()).includes("Worktree per run"));
  assert.ok(badge(notebookProject, true).includes("Notebook: /Users/example/repos/one"));
  assert.ok(badge(notebookFresh, true).includes("Notebook: /Users/example/.local/share/ragents/workspace/runs/run-1 (Empty folder per run)"));
  assert.ok(badge({ kind: "path", path: "/Users/example/repos/one" }, true).includes("/Users/example/repos/one"));
  assert.ok(badge({ kind: "client", client: "laptop-01", label: "Notebook", path: "/Users/example/repos/one" }, true)
    .includes("Notebook: /Users/example/repos/one"));
  assert.ok(badge({ kind: "fresh" }, true).includes("Empty folder per run"));
  assert.ok(badge({ kind: "other" }, true).includes("Workspace unreadable"));
});

test("the run header always names the workspace; the run list takes its line from the server", () => {
  const metadata = (info: SessionInfo) => renderToStaticMarkup(createElement(WorkspaceMetadata, { session: info }));
  assert.ok(metadata(session(serverFresh, "Empty folder per run")).includes("Empty folder per run"));
  assert.ok(metadata(session(serverProject, "/Users/example/repos/one")).includes("Workspace: /Users/example/repos/one"));
  assert.ok(metadata(session(notebookFresh, "Notebook: new folder")).includes("Notebook: new folder"));
  assert.equal(metadata({ id: "run-2", title: "Without", updatedAt: 0 }), "");
});
