import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import type { ActorProgramStatus } from "../../server/src/plugin-support/actor-programs/contract";
import type { GlobalAppSummary, GlobalAppsSnapshot } from "../../../plugins/ragents.global-apps/contract";
import { GlobalAppsPage } from "../../../plugins/ragents.global-apps/web/GlobalAppsPage";
import { AccessContext } from "../src/AccessContext";
import { initializeAppearance } from "../src/appearance";
import { initializeTheme } from "../src/theme";
import { Button } from "../src/ui";
import "../src/ui/tailwind.css";

const app: GlobalAppSummary = {
  name: "daily-summary", actorId: "summary-actor", program: "daily-summary.main", description: "A daily summary of the example workspace.",
  input: true, triggers: { daily: { at: "08:00", timeZone: "UTC" } }, views: [], paused: false, status: "ready",
  lastRunAt: "2026-10-20T08:00:00Z", nextRunAt: "2026-10-21T08:00:00Z",
  lastResult: { outcome: "completed", at: "2026-10-20T08:00:00Z", summary: "The example workspace is ready." }, problem: null,
};
const initial: GlobalAppsSnapshot = {
  runId: "global-space", revision: 1, apps: [app, { ...app, name: "static-summary", actorId: "static-actor", program: "static-summary.main", input: false }],
  errors: [{ id: "unavailable", name: "unavailable-app", problem: "The example package could not be loaded." }], problem: null,
};
const backend = { snapshot: initial, opened: 0, closed: 0 };
const listeners = new Set<{ message: (snapshot: GlobalAppsSnapshot) => void; error: (problem: string) => void }>();
const calls: { id: string; input: Record<string, unknown> }[] = [];
const publish = (snapshot: GlobalAppsSnapshot) => {
  backend.snapshot = snapshot;
  for (const listener of listeners) listener.message(snapshot);
};
const status = (actorId: unknown): ActorProgramStatus => {
  const current = backend.snapshot.apps.find((entry) => entry.actorId === actorId)!;
  return {
    ...current, permissions: {}, sandbox: null, state: { revision: backend.snapshot.revision },
    log: [{ at: "2026-10-20T08:00:00Z", level: "info", text: `Snapshot ${backend.snapshot.revision}` }], droppedLogLines: 0,
  };
};

declare global {
  interface Window {
    globalAppsFixture: {
      readonly calls: typeof calls;
      counts: () => { opened: number; closed: number; active: number };
      call: (id: string, input: Record<string, unknown>) => Promise<unknown>;
      subscribe: (id: string, message: (snapshot: GlobalAppsSnapshot) => void, error: (problem: string) => void) => () => void;
      update: (description: string) => void;
      fail: (problem: string) => void;
    };
  }
}

window.globalAppsFixture = {
  calls,
  counts: () => ({ opened: backend.opened, closed: backend.closed, active: listeners.size }),
  call: async (id, input) => {
    calls.push({ id, input });
    switch (id) {
      case "ragents.actor-programs.status": return status(input.actorId);
      case "ragents.actor-programs.trigger": return { accepted: true };
      case "ragents.actor-programs.pause":
        publish({ ...backend.snapshot, revision: backend.snapshot.revision + 1, apps: backend.snapshot.apps.map((entry) => entry.actorId === input.actorId
          ? { ...entry, paused: input.paused === true, status: input.paused ? "paused" : "ready" } : entry) });
        return { nextRunAt: input.paused ? null : app.nextRunAt };
      case "ragents.global-apps.remove":
        publish({ ...backend.snapshot, revision: backend.snapshot.revision + 1,
          apps: backend.snapshot.apps.filter((entry) => entry.name !== input.name), errors: backend.snapshot.errors.filter((entry) => entry.name !== input.name) });
        return { removed: true };
      default: throw new Error(`Unexpected fixture method: ${id}`);
    }
  },
  subscribe: (id, message, error) => {
    if (id !== "ragents.global-apps.changed") throw new Error(`Unexpected fixture channel: ${id}`);
    const listener = { message, error };
    backend.opened += 1;
    listeners.add(listener);
    queueMicrotask(() => { if (listeners.has(listener)) message(backend.snapshot); });
    return () => { if (listeners.delete(listener)) backend.closed += 1; };
  },
  update: (description) => publish({ ...backend.snapshot, revision: backend.snapshot.revision + 1,
    apps: backend.snapshot.apps.map((entry) => entry.name === app.name ? { ...entry, description,
      lastResult: { outcome: "completed", at: "2026-10-20T09:00:00Z", summary: "The summary was updated." } } : entry) }),
  fail: (problem) => { for (const listener of listeners) listener.error(problem); },
};

const query = new URLSearchParams(location.search);
const rights = ["ragents.global-apps.read", "runs.read", ...(query.get("rights") ?? "ragents.global-apps.write,runs.write").split(",").filter(Boolean)];
const access = { ...createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } }), logout: async () => {} };

function Fixture() {
  const [open, setOpen] = useState(true);
  return <AccessContext.Provider value={access}>
    <div className="grid min-w-0 gap-4 p-4">
      <nav><Button onClick={() => setOpen(!open)} variant="outline">{open ? "Leave apps" : "Open apps"}</Button></nav>
      <main className="@container/panel min-w-0">{open ? <GlobalAppsPage /> : <p>Apps closed.</p>}</main>
    </div>
  </AccessContext.Provider>;
}

initializeTheme(window);
initializeAppearance(window);
createRoot(document.getElementById("root")!).render(<Fixture />);
