import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AccessBadge, AccessControl } from "../../../plugins/ragents.workspace/web/AccessOption";
import { WORKSPACE_ACCESS_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import type { SessionContext, StartOptionState } from "../src/PluginRegistry";
import { initializeTheme } from "../src/theme";
import { initializeAppearance } from "../src/appearance";
import "../src/ui/tailwind.css";

const query = new URLSearchParams(location.search);
const changes: unknown[] = [];
const machine = query.has("workstation") ? "workstation" : "server";
const reason = query.has("disabled") ? "Full access on the server requires an administrator." : null;
const session = {} as SessionContext;

declare global {
  interface Window {
    workspaceAccessFixture: { readonly changes: readonly unknown[] };
  }
}

window.workspaceAccessFixture = { changes };

function Fixture() {
  const [value, setValue] = useState<"isolated" | "full">(query.has("full") ? "full" : "isolated");
  const option: StartOptionState = {
    id: WORKSPACE_ACCESS_OPTION_ID, owner: "ragents.workspace", value,
    presentation: { kind: "workspace-access", machine, commandIsolation: query.has("windows") ? "unsupported" : query.has("disconnected") ? "unknown" : "isolated", fullAccessDisabledReason: reason }, selectable: true, locked: false,
  };
  return <main className="flex min-h-screen flex-col gap-4 bg-background p-4 text-foreground">
    <div className="mt-auto flex items-center gap-2" aria-label="Composer toolbar">
      <AccessControl disabled={query.has("locked")} error={undefined} machines="all" option={option} setValue={async (next) => {
        changes.push(next);
        if (next === "isolated" || next === "full") setValue(next);
      }} />
    </div>
    <dl><AccessBadge option={option} session={session} /></dl>
  </main>;
}

initializeTheme(window);
initializeAppearance(window);
createRoot(document.getElementById("root")!).render(<Fixture />);
