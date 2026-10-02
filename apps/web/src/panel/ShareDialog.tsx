import { XIcon } from "lucide-react";
import { Fragment, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  addableUsers, SHARE_ACCESS_LABELS, sharedUserLabel, sharingChanged, sharingOf, withEveryone, withoutUser, withUser,
  type RunShareAccess, type RunSharing, type SharingStore,
} from "../run-sharing";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui";
import type { PanelSharing } from "./contract";

const OFF = "off";
const ACCESS_CHOICES = [{ value: "read", label: SHARE_ACCESS_LABELS.read }, { value: "write", label: SHARE_ACCESS_LABELS.write }];
const EVERYONE_CHOICES = [{ value: OFF, label: "Off" }, ...ACCESS_CHOICES];
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

/** "Share run": everyone and individual users, each with Can view or Can operate; the host loads, saves, and closes. */
export function ShareDialog({ runTitle, sharing, onSave, onClose }: {
  runTitle?: string;
  sharing: Pick<PanelSharing, "result" | "pending" | "error">;
  onSave: (sharing: RunSharing) => void;
  onClose: () => void;
}) {
  const everyoneId = useId();
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
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1.5">
            <span className="type-item" id={everyoneId}>Everyone</span>
            <Select disabled={sharing.pending} items={EVERYONE_CHOICES} onValueChange={(value) => setDraft(withEveryone(current, accessOf(value)))} value={current.everyone ?? OFF}>
              <SelectTrigger aria-labelledby={everyoneId} className="w-32" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>{EVERYONE_CHOICES.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
            </Select>
            <span aria-hidden className="size-7" />
            {current.users.map((user) => {
              const label = sharedUserLabel(result, user.userId);
              return <Fragment key={user.userId}>
                <span className="min-w-0 truncate type-body" title={label === user.userId ? label : `${label} (${user.userId})`}>{label}</span>
                <Select disabled={sharing.pending} items={ACCESS_CHOICES} onValueChange={(value) => {
                  const access = accessOf(value);
                  if (access) setDraft(withUser(current, user.userId, access));
                }} value={user.access}>
                  <SelectTrigger aria-label={`Access for ${label}`} className="w-32" size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCESS_CHOICES.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button aria-label={`Remove ${label}`} disabled={sharing.pending} onClick={() => setDraft(withoutUser(current, user.userId))} size="icon-sm" title={`Remove ${label}`} type="button" variant="ghost"><XIcon /></Button>
              </Fragment>;
            })}
          </div>
          <AddUser disabled={sharing.pending === true} onAdd={(userId) => setDraft(withUser(current, userId, "read"))} users={addableUsers(result, current)} />
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

/** The picker for one more user; a new user starts with Can view. */
function AddUser({ users, disabled, onAdd }: { users: readonly { id: string; label: string }[]; disabled: boolean; onAdd: (userId: string) => void }) {
  if (users.length === 0) return null;
  const choices = users.map((user) => ({ value: user.id, label: user.label }));
  return <Select disabled={disabled} items={choices} onValueChange={(value) => { if (typeof value === "string") onAdd(value); }} value={null}>
    <SelectTrigger aria-label="Add user" className="w-full" size="sm"><SelectValue placeholder="Add user" /></SelectTrigger>
    <SelectContent>{choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
  </Select>;
}
