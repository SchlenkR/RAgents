import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccessContext } from "../../../packages/ragents/src/access";
import type { SessionContext, SurfaceElementContribution } from "../src/PluginRegistry.tsx";
import { runAppAdditions } from "../src/run-apps.ts";
import { APP_DISPLAYS_STATE_ID, type AppDisplayGroup, type AppDisplaySnapshot } from "../../../plugins/ragents.actor-programs/contract.ts";
import { AppDisplayChoices, AppDisplayView, appDisplaySurfaceElements } from "../../../plugins/ragents.actor-programs/web/AppDisplays.tsx";
import type { ActorProgramsApi } from "../../../plugins/ragents.actor-programs/web/api.ts";

const session = (state: unknown): SessionContext => ({ session: { id: "run" }, runView: {
  id: "run", ownerId: "owner", primaryActorId: null, actors: [], inputs: [], turns: [], subscriptions: [], actions: [], artifacts: [],
  pluginStates: state === undefined ? [] : [{ pluginId: APP_DISPLAYS_STATE_ID, scope: { kind: "run" }, state }],
} } as unknown as SessionContext);

const view = (snapshot: AppDisplaySnapshot | undefined, options: { error?: string; removable?: boolean } = {}) => renderToStaticMarkup(createElement(AppDisplayView, {
  api: {} as ActorProgramsApi, title: "Board (read-only)", snapshot, error: options.error, onRetry: () => undefined,
  onRemove: options.removable ? () => undefined : undefined, removal: { pending: false },
}));

test("a run's displays become read-only windows titled with the app's name, from the projected state every viewer gets", () => {
  assert.deepEqual(appDisplaySurfaceElements(session(undefined)), []);
  const elements = appDisplaySurfaceElements(session({ version: 1, displays: [{ id: "0123456789ab", title: "Board" }, { id: "abcdef012345", title: "Board" }] }));
  assert.deepEqual(elements, [
    { id: "display-0123456789ab", title: "Board (read-only)", data: { display: "0123456789ab" } },
    { id: "display-abcdef012345", title: "Board (read-only)", data: { display: "abcdef012345" } },
  ]);
  assert.throws(() => appDisplaySurfaceElements(session({ version: 1, displays: [{ id: "../frame", title: "Board" }] })), /damaged/);
  assert.throws(() => appDisplaySurfaceElements(session({ displays: "none" })), /damaged/);
});

test("the window marks itself read-only and names where the app lives", () => {
  const loading = view(undefined, { removable: true });
  assert.match(loading, /Read-only/);
  assert.match(loading, /An app from elsewhere/);
  assert.match(loading, /Loading app/);
  assert.match(loading, /aria-label="Remove display"/);
  assert.doesNotMatch(view(undefined), /Remove display/, "a viewer who cannot write gets no removal");
  const removed = view({ status: "removed", title: "Board", from: 'Run "Planning"', message: "The app was removed from its run." });
  assert.match(removed, /From Run &quot;Planning&quot;/);
  assert.match(removed, /The app was removed from its run\./);
  assert.doesNotMatch(removed, /Retry|<iframe/);
});

test("unavailable states are calm messages, and only a failure offers another try", () => {
  const denied = view({ status: "denied", title: "Board", from: null, message: "This app is not available to you." });
  assert.match(denied, /This app is not available to you\./);
  assert.doesNotMatch(denied, /From |Retry|<iframe|role="alert"/);
  const failed = view({ status: "failed", title: "Board", from: "Global apps: board", message: "The app cannot be loaded: The journal is locked." });
  assert.match(failed, /The app cannot be loaded: The journal is locked\./);
  assert.match(failed, /Retry/);
  assert.doesNotMatch(failed, /role="alert"/, "a failed source is not an error of this run");
  const lost = view(undefined, { error: "The connection was lost." });
  assert.match(lost, /The display cannot be loaded: The connection was lost\./);
  assert.match(lost, /Retry/);
});

test("the picker groups named apps and runs, describes each view, and keeps shown views visible but not selectable", () => {
  const groups: AppDisplayGroup[] = [
    { label: "Global apps", apps: [{ title: "Daily draft", detail: "daily-draft", runId: "global", view: "daily-draft.daily-draft--main", shown: false }] },
    { label: "Planning", apps: [{ title: "Board", detail: null, runId: "planning", view: "board--main", shown: true }, { title: "Details", detail: "Board", runId: "planning", view: "board--detail", shown: false }] },
  ];
  const html = renderToStaticMarkup(createElement(AppDisplayChoices, { groups, pending: false, onChoose: () => undefined }));
  assert.match(html, /aria-label="Global apps"/);
  assert.match(html, /aria-label="Planning"/);
  assert.match(html, /aria-label="Show Daily draft"/);
  assert.match(html, /daily-draft<\/span>/);
  assert.match(html, /aria-label="Board is shown"[^>]*disabled=""/);
  assert.match(html, /Shown/);
  assert.match(html, /aria-label="Show Details"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(AppDisplayChoices, { groups, pending: true, onChoose: () => undefined })), /aria-label="Show Details"(?![^>]*disabled)/, "a pending choice blocks the others");
  assert.match(renderToStaticMarkup(createElement(AppDisplayChoices, { groups: [], pending: false, onChoose: () => undefined })), /No other app is available to you/);
});

test("the host offers a contribution's addition only to viewers with its right", () => {
  const Dialog = () => null;
  const contributions: SurfaceElementContribution[] = [
    { id: "apps", order: 0, select: () => [], Element: () => null },
    { id: "displays", order: 1, select: () => [], Element: () => null, add: { label: "Show app...", right: "runs.write", Dialog } },
  ];
  const writer = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read", "runs.write"] } });
  const reader = createAccessContext({ enabled: true, user: { id: "bob", label: "Bob", rights: ["runs.read"] } });
  assert.deepEqual(runAppAdditions(contributions, writer), [{ id: "add:displays", label: "Show app...", Dialog }]);
  assert.deepEqual(runAppAdditions(contributions, reader), []);
});
