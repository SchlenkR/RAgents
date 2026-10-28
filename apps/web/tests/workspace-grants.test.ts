import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActionViewContext, SessionContext } from "../src/PluginRegistry.tsx";
import { AccessRequestView, accessRequestOutcome } from "../../../plugins/ragents.workspace/web/AccessRequest.tsx";
import { WorkspaceGrants, workspaceGrantsFrom, workspaceGrantsOf } from "../../../plugins/ragents.workspace/web/WorkspaceGrants.tsx";
import { webPlugin } from "../../../plugins/ragents.workspace/web/index.tsx";
import { WORKSPACE_GRANTS_STATE_ID, WORKSPACE_PLUGIN_ID, type WorkspaceAccessRequest, type WorkspaceGrant } from "../../../plugins/ragents.workspace/contract.ts";

const grant: WorkspaceGrant = { path: "/home/user/reference/guide.md", access: "read" };
const sessionWith = (state: unknown): SessionContext => ({
  connected: true, session: { id: "example-run", title: "Example", updatedAt: 0 },
  runView: {
    id: "example-run", ownerId: "owner", primaryActorId: null,
    actors: [], inputs: [], turns: [], subscriptions: [], actions: [], artifacts: [],
    pluginStates: [{ pluginId: WORKSPACE_GRANTS_STATE_ID, scope: { kind: "run" }, state }],
  },
} as SessionContext);
const actionWith = (payload: unknown, result?: unknown): ActionViewContext => ({
  session: sessionWith([grant]), text: "Access request",
  action: { actionId: "example-action", owner: WORKSPACE_PLUGIN_ID, payload, ...(result ? { status: "approved", result } : {}) },
});
const request: WorkspaceAccessRequest = { kind: "access-request", path: grant.path, access: "read", reason: "Read the project reference.", file: true };

test("workspace contributes access request cards and granted paths to run details", () => {
  assert.equal(webPlugin.needsRunView, true);
  assert.equal(webPlugin.actionViews?.find((entry) => entry.owner === WORKSPACE_PLUGIN_ID)?.View, AccessRequestView);
  assert.equal(webPlugin.sessionHeaders?.find((entry) => entry.id === WORKSPACE_GRANTS_STATE_ID)?.Header, WorkspaceGrants);
});

test("access request cards show reason, path and access with file-specific choices", () => {
  const markup = renderToStaticMarkup(createElement(AccessRequestView, actionWith(request)));
  assert.ok(markup.includes(request.path));
  assert.ok(markup.includes(request.reason));
  assert.match(markup, /Read only/);
  for (const label of ["Allow", "Allow folder", "Deny"]) assert.ok(markup.includes(`>${label}</button>`));
  assert.match(markup, /Checking who may answer/);
  assert.match(markup, /disabled=""/);
  assert.doesNotMatch(markup, /\stitle=/);
  const directory = renderToStaticMarkup(createElement(AccessRequestView, actionWith({ ...request, file: false, access: "write" })));
  assert.match(directory, /Read and write/);
  assert.doesNotMatch(directory, /Allow folder/);
  const malformed = renderToStaticMarkup(createElement(AccessRequestView, actionWith({ path: grant.path })));
  assert.match(malformed, /invalid payload/);
  assert.doesNotMatch(malformed, /Access decision/);
});

test("access history reports a grant only when the run actually stores it", () => {
  const folder: WorkspaceGrant = { path: "/home/user/reference", access: "read" };
  assert.equal(accessRequestOutcome(request, { decision: "allow", ...grant }), "Closed without granting access.");
  assert.equal(accessRequestOutcome(request, { decision: "allow", ...grant }, [grant]), "Access allowed.");
  assert.equal(accessRequestOutcome(request, { decision: "allow-folder", ...folder }, [folder]), "Folder access allowed.");
  assert.equal(accessRequestOutcome(request, { decision: "allow-folder", ...grant }, [grant]), "Closed without granting access.");
  assert.equal(accessRequestOutcome(request, { decision: "allow", ...grant, access: "write" }, [grant]), "Closed without granting access.");
  assert.equal(accessRequestOutcome(request, { decision: "allow", ...grant }, [{ ...grant, access: "write" }]), "Access allowed.");
  assert.equal(accessRequestOutcome(request, { decision: "deny" }), "Access denied.");
  assert.equal(accessRequestOutcome(request, { withdrawn: true }), "Access request withdrawn.");
  assert.equal(accessRequestOutcome(request, { supersededBy: "example-input" }), "Access request closed by a new message.");
  for (const value of [null, true, {}, { decision: "approved" }]) assert.equal(accessRequestOutcome(request, value), "Closed without granting access.");
  const markup = renderToStaticMarkup(createElement(AccessRequestView, actionWith(request, { decision: "allow", ...grant })));
  assert.match(markup, /Access allowed/);
  assert.doesNotMatch(markup, /<button/);
});

test("a generic resolution cannot use an unrelated grant or change the requested access", () => {
  const unrelated: WorkspaceGrant = { path: "/home/user/exports", access: "read" };
  for (const decision of ["allow", "allow-folder"]) {
    assert.equal(accessRequestOutcome(request, { decision, ...unrelated }, [unrelated]), "Closed without granting access.");
    const forged = actionWith(request, { decision, ...unrelated });
    assert.match(renderToStaticMarkup(createElement(AccessRequestView, { ...forged, session: sessionWith([unrelated]) })), /Closed without granting access/);
  }
  assert.equal(accessRequestOutcome({ ...request, access: "write" }, { decision: "allow", ...grant }, [{ ...grant, access: "write" }]), "Closed without granting access.");
  assert.equal(accessRequestOutcome({ ...request, file: false }, { decision: "allow-folder", path: "/home/user/reference", access: "read" }, [{ path: "/home/user/reference", access: "read" }]), "Closed without granting access.");
});

test("folder approval follows the requested file's actual parent on POSIX and Windows", () => {
  const windows: WorkspaceAccessRequest = { ...request, path: "C:\\Users\\alice\\reference\\guide.md" };
  const folder: WorkspaceGrant = { path: "C:\\Users\\alice\\reference", access: "read" };
  assert.equal(accessRequestOutcome(windows, { decision: "allow-folder", path: "c:/users/alice/reference", access: "read" }, [folder]), "Folder access allowed.");
  assert.equal(accessRequestOutcome(windows, { decision: "allow-folder", path: "C:\\Users\\alice", access: "read" }, [{ path: "C:\\Users\\alice", access: "read" }]), "Closed without granting access.");
  const unc: WorkspaceAccessRequest = { ...request, path: "\\\\server\\share\\reference\\guide.md" };
  assert.equal(accessRequestOutcome(unc, { decision: "allow-folder", path: "//server/share/reference", access: "read" }, [{ path: "\\\\server\\share\\reference", access: "read" }]), "Folder access allowed.");
  for (const [filename, root] of [["/guide.md", "/"], ["C:\\guide.md", "C:\\"], ["\\\\server\\share\\guide.md", "\\\\server\\share"]]) {
    assert.equal(accessRequestOutcome({ ...request, path: filename! }, { decision: "allow-folder", path: root, access: "read" }, [{ path: root!, access: "read" }]), "Closed without granting access.");
  }
});

test("run details list read and write grants and reject malformed state", () => {
  const grants: readonly WorkspaceGrant[] = [grant, { path: "/home/user/exports", access: "write" }];
  assert.deepEqual(workspaceGrantsFrom(grants), grants);
  assert.deepEqual(workspaceGrantsOf(sessionWith(grants)), grants);
  const markup = renderToStaticMarkup(createElement(WorkspaceGrants, { session: sessionWith(grants) }));
  assert.match(markup, /aria-label="Granted paths"/);
  for (const entry of grants) assert.ok(markup.includes(entry.path));
  assert.match(markup, /Read only/);
  assert.match(markup, /Read and write/);
  assert.doesNotMatch(markup, /\stitle=/);
  for (const value of [null, {}, [{ path: "", access: "read" }], [{ path: grant.path, access: "execute" }]]) {
    assert.throws(() => workspaceGrantsFrom(value), /stored workspace grants are invalid/);
    const invalid = renderToStaticMarkup(createElement(WorkspaceGrants, { session: sessionWith(value) }));
    assert.match(invalid, /role="alert"/);
  }
  assert.equal(renderToStaticMarkup(createElement(WorkspaceGrants, { session: sessionWith([]) })), "");
});
