import { useMemo, useRef, useState, type ComponentProps, type ReactElement } from "react";
import {
  listedUsers, SHARE_ACCESS_LABELS, sharingOf, withEveryone, withoutUser, withUser,
  type RunShareAccess, type RunSharing, type SharingStore,
} from "../run-sharing";
import { HeaderDropdown, ToggleGroup, ToggleGroupItem } from "../ui";
import type { PanelSharing } from "./contract";

const OFF = "off";
const ACCESS_CHOICES = [
  { value: OFF, label: "Off", title: "Does not share the run" },
  { value: "read", label: SHARE_ACCESS_LABELS.read, title: "Sees the run" },
  { value: "write", label: SHARE_ACCESS_LABELS.write, title: "Also works in it, within the user's own permissions" },
];
const noteClass = "type-meta text-muted-foreground";
const errorClass = "type-body text-destructive [overflow-wrap:anywhere]";

const accessOf = (value: string | null): RunShareAccess | null => value === "read" || value === "write" ? value : null;

/** The sharing flow reads the latest value while the component renders the current one. */
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

export function SharePanel({ runTitle, sharing, onSave, onOpenChange, trigger, anchor, id }: {
  runTitle?: string;
  sharing: PanelSharing | undefined;
  onSave: (sharing: RunSharing) => void;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
  anchor?: ComponentProps<typeof HeaderDropdown>["anchor"];
  id?: string;
}) {
  return <HeaderDropdown anchor={anchor} id={id} label="Share run" onOpenChange={onOpenChange} open={sharing !== undefined} trigger={trigger}>
    {sharing && <ShareContent onSave={onSave} runTitle={runTitle} sharing={sharing} />}
  </HeaderDropdown>;
}

export function ShareContent({ runTitle, sharing, onSave }: {
  runTitle?: string;
  sharing: Pick<PanelSharing, "result" | "pending" | "error">;
  onSave: (sharing: RunSharing) => void;
}) {
  const result = sharing.result;
  const current = result && sharingOf(result);
  return <>
    {runTitle && <p className="type-body text-muted-foreground">{runTitle}</p>}
    {result === undefined || current === undefined
      ? <>
        {sharing.pending && <p className="type-body text-muted-foreground" role="status">Loading ...</p>}
        {sharing.error && <p className={errorClass} role="alert">{sharing.error}</p>}
      </>
      : <div aria-busy={sharing.pending === true} className="grid gap-3">
        <ul aria-label="Shared with" className="grid grid-cols-[minmax(0,1fr)_max-content] gap-x-3 rounded-lg border border-border bg-card">
          <AccessRow access={current.everyone} disabled={sharing.pending === true} label="Everyone" onChange={(access) => onSave(withEveryone(current, access))} strong />
          {listedUsers(result).map((user) => <AccessRow
            access={current.users.find((entry) => entry.userId === user.id)?.access ?? null}
            disabled={sharing.pending === true}
            key={user.id}
            label={user.label}
            onChange={(access) => onSave(access ? withUser(current, user.id, access) : withoutUser(current, user.id))}
            title={user.label === user.id ? user.label : `${user.label} (${user.id})`}
          />)}
        </ul>
        {result.users.length === 0 && <p className={noteClass}>This profile has no other users to share with.</p>}
        {sharing.error && <p className={errorClass} role="alert">{sharing.error}</p>}
      </div>}
  </>;
}

function AccessRow({ label, title, access, strong, disabled, onChange }: {
  label: string;
  title?: string;
  access: RunShareAccess | null;
  strong?: boolean;
  disabled: boolean;
  onChange: (access: RunShareAccess | null) => void;
}) {
  return <li className="col-span-2 grid grid-cols-subgrid items-center border-b border-border px-3 py-2 last:border-b-0">
    <span className={`min-w-0 truncate ${strong ? "type-item" : "type-body"}`} title={title ?? label}>{label}</span>
    <ToggleGroup aria-label={`Access for ${label}`} disabled={disabled} size="sm" value={[access ?? OFF]}
      onValueChange={([value]) => { if (value) onChange(accessOf(value)); }}>
      {ACCESS_CHOICES.map((choice) => <ToggleGroupItem key={choice.value} title={choice.title} value={choice.value}>{choice.label}</ToggleGroupItem>)}
    </ToggleGroup>
  </li>;
}
