import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ActionViewContext, SessionContext } from "../src/PluginRegistry";
import { AccessRequestView } from "../../../plugins/ragents.workspace/web/AccessRequest";
import { WorkspaceGrants } from "../../../plugins/ragents.workspace/web/WorkspaceGrants";
import { WORKSPACE_GRANTS_STATE_ID, WORKSPACE_PLUGIN_ID } from "../../../plugins/ragents.workspace/contract";
import { initializeTheme } from "../src/theme";
import { initializeAppearance } from "../src/appearance";
import "../src/ui/tailwind.css";

const query = new URLSearchParams(location.search);
const calls: { method: string; input: unknown }[] = [];
const requestedPath = "/home/user/reference/documentation/technical-guidance-for-the-example-project-and-its-extensions.md";
let answerError: string | undefined;
let resolveAnswer: ((decision: string) => void) | undefined;

declare global {
  interface Window {
    workspaceGrantsFixture: {
      readonly calls: readonly { method: string; input: unknown }[];
      call: (method: string, input: unknown) => Promise<unknown>;
      setAnswerError: (value: string | undefined) => void;
    };
  }
}
window.workspaceGrantsFixture = {
  calls,
  call: async (method, input) => {
    calls.push({ method, input });
    if (method === "ragents.workspace.accessRequest.availability") return { disabledReason: query.has("shared")
      ? "Only the run's owner may answer access requests." : query.has("restricted") ? "The server requires isolated access (PROCESS_SANDBOX=on)." : null };
    if (method === "ragents.workspace.accessRequest.answer") {
      if (answerError) throw new Error(answerError);
      resolveAnswer?.((input as { decision: string }).decision);
      return null;
    }
    throw new Error(`Unexpected fixture method: ${method}`);
  },
  setAnswerError: (value) => { answerError = value; },
};

function Fixture() {
  const [decision, setDecision] = useState<string>();
  resolveAnswer = setDecision;
  const path = decision === "allow-folder" ? "/home/user/reference/documentation" : requestedPath;
  const access = query.has("write") ? "write" : "read";
  const grants = decision === "allow" || decision === "allow-folder" ? [{ path, access }] : [];
  const session = {
    connected: !query.has("offline"), session: { id: "example-run", title: "Example", updatedAt: 0 },
    runView: {
      id: "example-run", ownerId: "owner", primaryActorId: null,
      actors: [], inputs: [], turns: [], subscriptions: [], actions: [], artifacts: [],
      pluginStates: [{ pluginId: WORKSPACE_GRANTS_STATE_ID, scope: { kind: "run" }, state: grants }],
    },
  } as SessionContext;
  const context: ActionViewContext = {
    session, text: "Access request",
    action: {
      actionId: "example-action", owner: WORKSPACE_PLUGIN_ID,
      payload: { kind: "access-request", path: requestedPath, access, reason: "Use the shared reference to answer the user's question.", file: !query.has("directory") },
      ...(decision ? { status: decision === "deny" ? "dismissed" : "approved", result: { decision, path, access } } : {}),
    },
  };
  return <main className="flex min-h-screen min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
    <AccessRequestView {...context} />
    <section aria-label="Run details"><WorkspaceGrants session={session} /></section>
  </main>;
}

initializeTheme(window);
initializeAppearance(window);
createRoot(document.getElementById("root")!).render(<Fixture />);
