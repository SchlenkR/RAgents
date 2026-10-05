import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  listedUsers, SHARE_ACCESS_LABELS, sharingChanged, sharingOf, withEveryone, withoutUser, withUser,
  type RunShareAccess, type RunSharing, type SharingStore,
} from "../run-sharing";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, ToggleGroup, ToggleGroupItem } from "../ui";
import type { PanelSharing } from "./contract";

const OFF = "off";
const ACCESS_CHOICES = [{ value: OFF, label: "Off" }, { value: "read", label: SHARE_ACCESS_LABELS.read }, { value: "write", label: SHARE_ACCESS_LABELS.write }];
const noteClass = "type-meta text-muted-foreground";
const errorClass = "type-body text-destructive [overflow-wrap:anywhere]";

const accessOf = (value: string | null): RunShareAccess | null => value === "read" || value === "write" ? value : null;

/** A React host's share dialog state: the flow reads the latest value, the component renders the current one. */
export function useSharingStore(): readonly [PanelSharing | undefined, SharingStore] {
  const [sharing, setSharing] = useState<PanelSharing>();
  const latest = useRef<PanelSharing>(undefined);
  const store = useMemo<SharingStore>(() => ({
    get: () => latest.current,
    set: (next) => {
      latest.current = next;
      setSharing(next);
    },
  }), []);
  return [sharing, store];
}

/** "Share run": a list of everyone and every user, each Off, Can view, or Can operate; the host loads, saves, and closes. */
export function ShareDialog({ runTitle, sharing, onSave, onClose }: {
  runTitle?: string;
  sharing: Pick<PanelSharing, "result" | "pending" | "error">;
  onSave: (sharing: RunSharing) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RunSharing>();
  const result = sharing.result;
  const current = draft ?? (result && sharingOf(result));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (current) onSave(current);
  };
  const cancel = <Button onClick={onClose} size="sm" type="button" variant="ghost">Cancel</Button>;
  return <Dialog onOpenChange={(next) => { if (!next) onClose(); }} open>
    <DialogContent className="gap-3" scope="page" size="small">
      <DialogHeader>
        <DialogTitle>Share run</DialogTitle>
        {runTitle && <DialogDescription className="truncate" title={runTitle}>{runTitle}</DialogDescription>}
      </DialogHeader>
      {result === undefined || current === undefined
        ? <>
          {sharing.pending && <p className="type-body text-muted-foreground" role="status">Loading ...</p>}
          {sharing.error && <p className={errorClass} role="alert">{sharing.error}</p>}
          <div className="mt-1 flex flex-wrap justify-end gap-2">{cancel}</div>
        </>
        : <form className="grid gap-3" onSubmit={submit}>
          <ul aria-label="Shared with" className="grid max-h-[50vh] overflow-y-auto rounded-lg border border-border-soft">
            <AccessRow access={current.everyone} disabled={sharing.pending === true} label="Everyone" onChange={(access) => setDraft(withEveryone(current, access))} strong />
            {listedUsers(result).map((user) => <AccessRow
              access={current.users.find((entry) => entry.userId === user.id)?.access ?? null}
              disabled={sharing.pending === true}
              key={user.id}
              label={user.label}
              onChange={(access) => setDraft(access ? withUser(current, user.id, access) : withoutUser(current, user.id))}
              title={user.label === user.id ? user.label : `${user.label} (${user.id})`}
            />)}
          </ul>
          {result.users.length === 0 && <p className={noteClass}>This profile has no other users to share with.</p>}
          <p className={noteClass}>Can view sees the run. Can operate also works in it, within the user's own permissions.</p>
          {sharing.error && <p className={errorClass} role="alert">{sharing.error}</p>}
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            {cancel}
            <Button disabled={sharing.pending || !sharingChanged(result, current)} size="sm" type="submit">{sharing.pending ? "Saving ..." : "Save"}</Button>
          </div>
        </form>}
    </DialogContent>
  </Dialog>;
}

/** One row of the list: a name and its access as Off, Can view, or Can operate. */
function AccessRow({ label, title, access, strong, disabled, onChange }: {
  label: string;
  title?: string;
  access: RunShareAccess | null;
  strong?: boolean;
  disabled: boolean;
  onChange: (access: RunShareAccess | null) => void;
}) {
  return <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border-soft px-3 py-2 last:border-b-0">
    <span className={`min-w-0 flex-[1_1_8rem] truncate ${strong ? "type-item" : "type-body"}`} title={title ?? label}>{label}</span>
    <ToggleGroup aria-label={`Access for ${label}`} disabled={disabled} size="sm" spacing={0} value={[access ?? OFF]} variant="outline"
      onValueChange={([value]) => { if (value) onChange(accessOf(value)); }}>
      {ACCESS_CHOICES.map((choice) => <ToggleGroupItem key={choice.value} value={choice.value}>{choice.label}</ToggleGroupItem>)}
    </ToggleGroup>
  </li>;
}
