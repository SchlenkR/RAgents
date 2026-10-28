import type { SessionContext, SessionHeaderContext } from "@ragents/web/PluginRegistry";
import { runViewFrom } from "@ragents/web/run-view";
import { DetailRow } from "@ragents/web/ui";
import { WORKSPACE_GRANTS_STATE_ID, type WorkspaceGrant } from "../contract";

export const workspaceGrantsFrom = (value: unknown): readonly WorkspaceGrant[] => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "object" && entry !== null
    && typeof entry.path === "string" && entry.path.length > 0 && (entry.access === "read" || entry.access === "write"))) {
    throw new Error("The stored workspace grants are invalid.");
  }
  return value;
};

export const workspaceGrantsOf = (session: SessionContext): readonly WorkspaceGrant[] => {
  const stored = runViewFrom(session.runView)?.pluginStates.find((entry) => entry.pluginId === WORKSPACE_GRANTS_STATE_ID && entry.scope.kind === "run");
  return stored ? workspaceGrantsFrom(stored.state) : [];
};

export function WorkspaceGrants({ session }: Pick<SessionHeaderContext, "session">) {
  const parsed = (() => {
    try { return { grants: workspaceGrantsOf(session) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) }; }
  })();
  if ("error" in parsed) return <DetailRow label="Grants"><span className="text-destructive" role="alert">{parsed.error}</span></DetailRow>;
  const { grants } = parsed;
  if (grants.length === 0) return null;
  return <DetailRow label="Grants">
    <ul aria-label="Granted paths" className="flex min-w-0 flex-col gap-2">
      {grants.map((grant) => <li className="flex min-w-0 flex-col gap-1" key={`${grant.access}:${grant.path}`}>
        <span className="font-mono text-sm">{grant.path}</span>
        <span className="text-sm text-muted-foreground">{grant.access === "write" ? "Read and write" : "Read only"}</span>
      </li>)}
    </ul>
  </DetailRow>;
}
