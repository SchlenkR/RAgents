import { useEffect, useState } from "react";
import type { ActionViewContext } from "@ragents/web/PluginRegistry";
import { rpc } from "@ragents/web/rpc";
import { Alert, AlertDescription, Button, Card } from "@ragents/web/ui";
import { isWorkspaceAccessRequest, workspaceContracts, type WorkspaceAccessRequest, type WorkspaceGrant } from "../contract";
import { workspaceGrantsOf } from "./WorkspaceGrants";

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const comparablePath = (value: string): string => /^[a-z]:[\\/]/i.test(value) || /^[\\/]{2}[^\\/]/.test(value)
  ? value.replaceAll("\\", "/").toLowerCase() : value;

const containingFolder = (value: string): string | undefined => {
  const canonical = comparablePath(value);
  const folder = canonical.slice(0, canonical.lastIndexOf("/"));
  return folder === "" || /^[a-z]:$/i.test(folder) || /^\/\/[^/]+\/[^/]+$/.test(folder) ? undefined : folder;
};

export const accessRequestOutcome = (request: WorkspaceAccessRequest, result: unknown, grants: readonly WorkspaceGrant[] = []): string => {
  if (typeof result !== "object" || result === null) return "Closed without granting access.";
  const value = result as Record<string, unknown>;
  if (value.withdrawn === true) return "Access request withdrawn.";
  if (value.superseded === true || typeof value.supersededBy === "string") return "Access request closed by a new message.";
  if (value.decision === "deny") return "Access denied.";
  const expected = value.decision === "allow" ? request.path
    : value.decision === "allow-folder" && request.file ? containingFolder(request.path) : undefined;
  const granted = expected !== undefined && value.access === request.access && typeof value.path === "string"
    && comparablePath(value.path) === comparablePath(expected)
    && grants.some((grant) => comparablePath(grant.path) === comparablePath(expected) && (grant.access === "write" || grant.access === request.access));
  if (granted && value.decision === "allow") return "Access allowed.";
  if (granted && value.decision === "allow-folder") return "Folder access allowed.";
  return "Closed without granting access.";
};

export function AccessRequestView({ action, session }: ActionViewContext) {
  const [availability, setAvailability] = useState<{ runId: string; disabledReason: string | null }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const open = action.status === undefined;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void rpc.call(workspaceContracts.accessRequestAvailability, { runId: session.session.id })
      .then(({ disabledReason }) => { if (active) setAvailability({ runId: session.session.id, disabledReason }); })
      .catch((cause: unknown) => { if (active) setAvailability({ runId: session.session.id, disabledReason: messageOf(cause) }); });
    return () => { active = false; };
  }, [open, session.connected, session.session.id]);
  if (!isWorkspaceAccessRequest(action.payload)) {
    return <Alert variant="destructive"><AlertDescription>The access request has an invalid payload.</AlertDescription></Alert>;
  }
  const request = action.payload;
  const outcome = (() => {
    try { return accessRequestOutcome(request, action.result, workspaceGrantsOf(session)); }
    catch { return "Closed without granting access."; }
  })();
  const disabledReason = availability?.runId === session.session.id ? availability.disabledReason : "Checking who may answer ...";
  const disabled = pending || !session.connected || disabledReason !== null;
  const answer = async (decision: "allow" | "allow-folder" | "deny") => {
    if (disabled) return;
    setPending(true);
    setError(undefined);
    try {
      await rpc.call(workspaceContracts.answerAccess, { runId: session.session.id, actionId: action.actionId, decision });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  };
  return <Card aria-label="Access request" className="min-w-0 gap-3 bg-background px-4 text-base [overflow-wrap:anywhere]" role="group" size="sm">
    <strong>Access request</strong>
    <p>{request.reason}</p>
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
      <dt className="text-muted-foreground">Path</dt><dd className="min-w-0 font-mono text-sm">{request.path}</dd>
      <dt className="text-muted-foreground">Access</dt><dd>{request.access === "write" ? "Read and write" : "Read only"}</dd>
    </dl>
    {open ? <>
      <div aria-label="Access decision" className="flex flex-wrap gap-2" role="group">
        <Button disabled={disabled} onClick={() => { void answer("allow"); }} size="sm">Allow</Button>
        {request.file && <Button disabled={disabled} onClick={() => { void answer("allow-folder"); }} size="sm" variant="outline">Allow folder</Button>}
        <Button disabled={disabled} onClick={() => { void answer("deny"); }} size="sm" variant="outline">Deny</Button>
      </div>
      {disabledReason && <p className="text-sm text-muted-foreground">{disabledReason}</p>}
      {!session.connected && <p className="text-sm text-muted-foreground">Reconnect to answer this request.</p>}
    </> : <p className="text-muted-foreground" role="status">{outcome}</p>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </Card>;
}
