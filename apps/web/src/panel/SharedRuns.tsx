import { UserRoundXIcon } from "lucide-react";
import { SHARE_ACCESS_LABELS, type RunShareTarget } from "../run-sharing";
import { Button, Spinner } from "../ui";
import type { ConnectionRun, PanelSharing } from "./contract";

export function SharedRuns({ runs, revoking, onOpen, onRevoke }: {
  runs: readonly ConnectionRun[];
  revoking: PanelSharing | undefined;
  onOpen: (runId: string) => void;
  onRevoke: (runId: string, target: RunShareTarget) => void;
}) {
  return <ul aria-label="Runs shared by me" className="grid min-w-0 gap-3">
    {runs.map((run) => {
      const sharing = run.sharing!;
      const disabled = !run.canShare || revoking?.pending === true;
      const pending = revoking?.runId === run.id && revoking.pending;
      return <li className="min-w-0 rounded-panel border border-border bg-card p-4" key={run.id}>
        <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <Button className="type-item h-auto min-w-0 justify-start whitespace-normal p-0 text-left [overflow-wrap:anywhere]" disabled={run.locked !== undefined}
            onClick={() => onOpen(run.id)} variant="link">{run.title}</Button>
          <Button aria-label={`Revoke all sharing for ${run.title}`} disabled={disabled} onClick={() => onRevoke(run.id, { kind: "all" })} size="sm" variant="outline">
            {pending ? <Spinner /> : <UserRoundXIcon data-icon="inline-start" />}Revoke all
          </Button>
        </div>
        <ul aria-label={`Recipients of ${run.title}`} className="grid gap-2">
          {[
            ...(sharing.everyone ? [{ id: "everyone", label: "Everyone", access: sharing.everyone, target: { kind: "everyone" } as const }] : []),
            ...sharing.users.map((user) => ({ id: `user:${user.userId}`, label: user.label, access: user.access, target: { kind: "user", userId: user.userId } as const })),
          ].map((recipient) => <li className="flex min-w-0 flex-wrap items-center gap-3" key={recipient.id}>
            <span className="type-body min-w-0 flex-1 [overflow-wrap:anywhere]">{recipient.label}</span>
            <span className="type-meta text-muted-foreground">{SHARE_ACCESS_LABELS[recipient.access]}</span>
            <Button aria-label={`Revoke ${recipient.target.kind === "everyone" ? "sharing with everyone" : `individual share with ${recipient.label}`} for ${run.title}`}
              disabled={disabled} onClick={() => onRevoke(run.id, recipient.target)} size="xs" variant="ghost">Revoke</Button>
          </li>)}
        </ul>
        {sharing.everyone && sharing.users.length > 0 && <p className="type-meta mt-3 text-muted-foreground">Revoking an individual share keeps the access granted to everyone.</p>}
        {revoking?.runId === run.id && revoking.error && <p className="type-body mt-3 text-destructive [overflow-wrap:anywhere]" role="alert">{revoking.error}</p>}
      </li>;
    })}
  </ul>;
}
