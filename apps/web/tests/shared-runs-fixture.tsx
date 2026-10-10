import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelPage } from "../src/panel/PanelPage";
import type { ConnectionRun, PanelAction, PanelSharing, PanelState } from "../src/panel/contract";
import { revokeSharing, type RunShareTarget, type RunSharingResult } from "../src/run-sharing";
import "../src/ui/tailwind.css";

const runs: ConnectionRun[] = [
  {
    id: "review", title: "Design review", state: "idle", pendingActions: 0, updatedAt: 30, owner: "Alice", canShare: true, shared: true,
    sharing: { everyone: "read", users: [{ userId: "bob", label: "Bob", access: "read" }, { userId: "carol", label: "Carol", access: "write" }] },
  },
  {
    id: "release", title: "Release checklist", state: "ended", pendingActions: 0, updatedAt: 29, owner: "Alice", canShare: true, shared: true,
    sharing: { everyone: null, users: [{ userId: "carol", label: "Carol", access: "write" }] },
  },
  {
    id: "readonly", title: "Read-only draft", state: "idle", pendingActions: 0, updatedAt: 28, owner: "Alice",
    sharing: { everyone: "read", users: [] },
  },
  { id: "private", title: "Private draft", state: "idle", pendingActions: 0, updatedAt: 27, owner: "Alice", canShare: true },
  { id: "administrative", title: "Admin-visible run", state: "idle", pendingActions: 0, updatedAt: 26, owner: "Dave", canShare: true, shared: true },
  { id: "received", title: "Received review", state: "idle", pendingActions: 0, updatedAt: 25, owner: "Dave", sharedAccess: "write" },
  ...Array.from({ length: 17 }, (_, index): ConnectionRun => ({ id: `history-${index}`, title: `History ${index}`, state: "idle", pendingActions: 0, updatedAt: index })),
];

const initial: PanelState = {
  theme: "dark", page: "start", profileSuggestions: [],
  connections: [{
    name: "workshop", kind: "server", address: "http://localhost:4710", route: { kind: "server", host: "localhost:4710", localHost: false },
    state: { kind: "connected" }, runs, entries: [], canCreate: false, canDelete: true, user: "Alice",
  }],
};

interface SharedRunsFixture {
  readonly actions: PanelAction[];
  holdRevoke: boolean;
  failRevoke: boolean;
  finishRevoke: () => void;
  share: (runId: string, sharing: NonNullable<ConnectionRun["sharing"]>) => void;
}

declare global { interface Window { sharedRunsFixture: SharedRunsFixture } }

const actions: PanelAction[] = [];
window.sharedRunsFixture = { actions, holdRevoke: false, failRevoke: false, finishRevoke: () => {}, share: () => {} };
document.documentElement.dataset.host = new URLSearchParams(location.search).get("host") ?? "browser";
document.documentElement.dataset.theme = "dark";

function Fixture() {
  const [state, setState] = useState(initial);
  const [revoking, setRevoking] = useState<PanelSharing>();
  const [opened, setOpened] = useState<string>();
  let current = revoking;
  const updateRun = (runId: string, sharing: NonNullable<ConnectionRun["sharing"]>) => setState((previous) => ({
    ...previous, connections: previous.connections.map((connection) => ({
      ...connection, runs: connection.runs.map((run) => run.id === runId ? { ...run, sharing } : run),
    })),
  }));
  window.sharedRunsFixture.share = updateRun;
  const revoke = async (runId: string, target: RunShareTarget): Promise<RunSharingResult> => {
    if (window.sharedRunsFixture.holdRevoke) await new Promise<void>((resolve) => { window.sharedRunsFixture.finishRevoke = resolve; });
    if (window.sharedRunsFixture.failRevoke) throw new Error("Sharing could not be revoked. Try again.");
    const previous = state.connections[0]!.runs.find((run) => run.id === runId)!.sharing!;
    const sharing = {
      everyone: target.kind === "all" || target.kind === "everyone" ? null : previous.everyone,
      users: target.kind === "all" ? [] : previous.users.filter((user) => target.kind !== "user" || user.userId !== target.userId),
    };
    updateRun(runId, sharing);
    return { sharing, users: [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }] };
  };
  const send = (action: PanelAction) => {
    actions.push(action);
    switch (action.action) {
      case "page": setState((previous) => ({ ...previous, page: action.page })); break;
      case "openRun": setOpened(action.runId); break;
      case "revokeShare": void revokeSharing(action.name, action.runId, action.target, revoke, {
        get: () => current,
        set: (next) => { current = next; setRevoking(next); },
      }); break;
    }
  };
  return <>
    <PanelPage preferences={{ read: async () => null, write: async () => {} }} state={{ ...state, revoking }} send={send} />
    {opened && <output aria-label="Opened run">{opened}</output>}
  </>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
