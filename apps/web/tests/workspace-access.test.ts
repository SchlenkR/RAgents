import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessBadge, AccessControl, accessExplanation, accessPresentationFrom } from "../../../plugins/ragents.workspace/web/AccessOption.tsx";
import { webPlugin } from "../../../plugins/ragents.workspace/web/index.tsx";
import { WORKSPACE_ACCESS_OPTION_ID } from "../../../plugins/ragents.workspace/contract.ts";
import type { StartOptionState } from "../../server/src/plugin-support/start-options-contract.ts";
import type { SessionContext } from "../src/PluginRegistry.tsx";

const option = (value: unknown, machine: "server" | "workstation", reason: string | null = null): StartOptionState => ({
  id: WORKSPACE_ACCESS_OPTION_ID,
  owner: "ragents.workspace",
  value,
  presentation: { kind: "workspace-access", machine, commandIsolation: "isolated", fullAccessDisabledReason: reason },
  selectable: true,
  locked: false,
});

test("workspace access lives in the composer and provides the run details badge", () => {
  const access = webPlugin.startOptions?.find((entry) => entry.id === WORKSPACE_ACCESS_OPTION_ID);
  assert.equal(access?.placement, "composer");
  assert.equal(access?.Control, AccessControl);
  assert.equal(access?.Badge, AccessBadge);
});

test("access presentation rejects malformed rights instead of enabling full access", () => {
  assert.deepEqual(accessPresentationFrom(option("isolated", "server").presentation), { machine: "server", commandIsolation: "isolated", fullAccessDisabledReason: null });
  for (const value of [null, {}, { kind: "workspace-access", machine: "server" }, { kind: "workspace-access", machine: "unknown", fullAccessDisabledReason: null }, { kind: "workspace-access", machine: "server", commandIsolation: "isolated", fullAccessDisabledReason: false }]) {
    assert.throws(() => accessPresentationFrom(value), /does not provide an access presentation/);
  }
});

test("access details explain the actual file, environment and process boundaries on each machine", () => {
  assert.match(accessExplanation("isolated", "server"), /Reads follow.*writes stay.*process sandbox.*safe allowlist/);
  for (const isolation of ["isolated", "unsupported", "unknown"] as const) {
    const explanation = accessExplanation("isolated", "workstation", isolation);
    assert.match(explanation, /Secrets are removed/);
    assert.match(explanation, isolation === "isolated" ? /Commands are isolated by the workstation OS sandbox/
      : isolation === "unsupported" ? /Commands are not isolated on this machine/ : /unknown until the workstation reconnects/);
  }
  assert.match(accessExplanation("full", "server"), /every path.*without the process sandbox.*safe allowlist/);
  assert.match(accessExplanation("full", "workstation"), /every path.*including secrets.*Local confirmation/);
  for (const level of ["isolated", "full"] as const) {
    const markup = renderToStaticMarkup(createElement(AccessBadge, { option: option(level, "workstation"), session: {} as SessionContext }));
    assert.match(markup, new RegExp(`data-access-level="${level}"`));
    assert.ok(markup.includes(level === "full" ? "Full access" : "Isolated"));
    assert.ok(markup.includes(accessExplanation(level, "workstation", "isolated").replaceAll("'", "&#x27;")));
    assert.doesNotMatch(markup, /\stitle=/);
  }
});

test("the compact access control exposes why full access is disabled and keeps errors visible", () => {
  const reason = "Full access on the server requires an administrator.";
  const markup = renderToStaticMarkup(createElement(AccessControl, {
    option: option("isolated", "server", reason), disabled: false, error: "The access change failed.", machines: "all", setValue: async () => undefined,
  }));
  assert.match(markup, /aria-label="Run access"/);
  assert.match(markup, /aria-describedby=/);
  assert.match(markup, /disabled=""/);
  assert.ok(markup.includes(reason));
  assert.match(markup, /role="alert">The access change failed\./);
  assert.doesNotMatch(markup, /\stitle=/);
  const invalid = renderToStaticMarkup(createElement(AccessControl, {
    option: option(true, "server"), disabled: false, error: undefined, machines: "all", setValue: async () => undefined,
  }));
  assert.match(invalid, /role="alert">The workspace access level must be isolated or full\./);
  assert.doesNotMatch(invalid, /aria-label="Run access"/);
});

test("the composer names the Windows and disconnected command-isolation limits", () => {
  for (const commandIsolation of ["unsupported", "unknown"] as const) {
    const state = option("isolated", "workstation");
    const markup = renderToStaticMarkup(createElement(AccessControl, {
      option: { ...state, presentation: { kind: "workspace-access", machine: "workstation", commandIsolation, fullAccessDisabledReason: null } },
      disabled: false, error: undefined, machines: "all", setValue: async () => undefined,
    }));
    assert.match(markup, commandIsolation === "unsupported" ? /Commands are not isolated on this machine/ : /unknown until the workstation reconnects/);
    assert.match(markup, /aria-describedby=/);
    assert.doesNotMatch(markup, /\stitle=/);
  }
});
