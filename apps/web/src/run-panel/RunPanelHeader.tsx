import { useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "lucide-react";
import type { AttentionState, PluginRegistry, SessionContext, SessionNavigation } from "../PluginRegistry";
import { sharedWithYouLabel } from "../run-sharing";
import { StartOptionBadges } from "../StartOptions";
import { Badge, DetailRow, HeaderDropdown, InteractiveItem } from "../ui";
import { RunScriptMenu } from "./RunScriptMenu";
import { RunShareButton } from "./RunShareButton";
import { useRunHeader } from "./RunHeader";

const titleClass = "flex h-[30px] min-w-0 max-w-full flex-1 cursor-pointer items-center gap-2 self-center rounded-md px-2 text-left";

/** The wrapping panel header keeps bar actions direct and run details behind the title. */
export function RunPanelHeader({ actionsRef, attention, contributions, navigation, registry, runError, session, working }: {
  actionsRef?: Ref<HTMLDivElement>;
  attention: AttentionState | undefined;
  contributions: PluginRegistry["sessionHeaders"];
  navigation: SessionNavigation;
  registry: PluginRegistry;
  runError: string | undefined;
  session: SessionContext;
  working: boolean;
}) {
  const header = useRunHeader();
  const [open, setOpen] = useState(false);
  const title = session.session.title || "New run";
  const sharedAccess = session.session.sharedAccess;
  const details = [
    ...registry.sessionMetadata.map(({ id, order, Metadata }) => ({ id, order, content: <Metadata session={session.session} /> })),
    ...contributions.filter((entry) => (entry.placement ?? "details") === "details").map(({ id, order, label, explanation, Header }) => ({
      id, order, content: label
        ? <DetailRow explanation={explanation} label={label}><Header navigation={navigation} session={session} /></DetailRow>
        : <Header navigation={navigation} session={session} />,
    })),
  ].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const actions = contributions.filter((entry) => entry.placement === "actions");
  const controls = <>
    {contributions.filter((entry) => entry.placement === "bar").map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
    {session.session.canShare && <RunShareButton runId={session.session.id} shared={session.session.shared === true} title={title} />}
    <RunScriptMenu runId={session.session.id} />
  </>;
  const windows = <div className="min-w-0 max-w-full empty:hidden" ref={actionsRef} />;
  return <div className={header ? "flex min-w-0 max-w-full items-center" : "flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1"}>
    <HeaderDropdown label="Run details" onOpenChange={setOpen} open={open} trigger={<InteractiveItem aria-description="Show run details" aria-label={title} className={titleClass} type="button">
      <strong className="min-w-0 truncate type-item">{title}</strong>
      {working && <span aria-label="Processing" className="size-1.5 flex-none rounded-full bg-active animate-fade-pulse motion-reduce:animate-none" role="status" />}
      {runError && <span className="flex-none type-meta font-medium text-destructive">Run unreachable</span>}
      {attention && <Badge className="flex-none truncate" role="status" tone="warning">{attention.label}</Badge>}
      {sharedAccess && <Badge aria-label={sharedWithYouLabel(sharedAccess)} className="flex-none" variant="secondary">{sharedAccess === "read" ? "View only" : "Shared"}</Badge>}
      <ChevronDownIcon aria-hidden className="size-3.5 flex-none text-muted-foreground" />
    </InteractiveItem>}>
      <div className="min-w-0" data-slot="run-details-sheet">
        {details.map(({ id, content }) => <div className="min-w-0 empty:hidden" key={id}>{content}</div>)}
        <DetailRow label="Run">{title}</DetailRow>
        {runError && <DetailRow label="Connection"><span className="text-destructive" role="alert">{runError}</span></DetailRow>}
        {sharedAccess && <DetailRow label="Access">{sharedWithYouLabel(sharedAccess)}</DetailRow>}
        {attention && <DetailRow label="Attention">{attention.label}</DetailRow>}
        <StartOptionBadges covered={new Set(registry.sessionMetadata.map(({ id }) => id))} registry={registry} session={session} />
      </div>
      {actions.length > 0 && <footer className="flex min-w-0 flex-wrap items-center gap-3 border-t border-border pt-3 empty:hidden" data-slot="run-details-footer">
        {actions.map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
      </footer>}
    </HeaderDropdown>
    {header ? <>
      {header.windows && createPortal(windows, header.windows)}
      {header.controls && createPortal(controls, header.controls)}
    </> : <>{windows}{controls}</>}
  </div>;
}
