import { useState, type Ref } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { AttentionState, PluginRegistry, SessionContext, SessionNavigation } from "../PluginRegistry";
import { sharedWithYouLabel } from "../run-sharing";
import { StartOptionBadges } from "../StartOptions";
import { Badge, HeaderDropdown, InteractiveItem } from "../ui";
import { RunScriptMenu } from "./RunScriptMenu";
import { RunShareButton } from "./RunShareButton";

const titleClass = "flex h-[30px] min-w-0 max-w-full flex-1 basis-40 cursor-pointer items-center gap-2 self-center rounded-md px-1.5 text-left";
const detailsClass = "grid grid-cols-1 gap-2 @[480px]/header-dropdown:grid-cols-2 @[800px]/header-dropdown:grid-cols-3 @[1100px]/header-dropdown:grid-cols-4 [&>*]:min-w-0 [&>*]:max-w-full [&>*]:items-start [&>*]:rounded-[12px] [&>*]:border [&>*]:border-border [&>*]:bg-card [&>*]:p-3 [&_*]:max-w-full [&_*]:whitespace-normal [&_*]:[overflow-wrap:anywhere] [&_span]:[-webkit-line-clamp:unset]";

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
  const [open, setOpen] = useState(false);
  const title = session.session.title || "New run";
  const sharedAccess = session.session.sharedAccess;
  return <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
    <HeaderDropdown label="Run details" onOpenChange={setOpen} open={open} trigger={<InteractiveItem className={titleClass} title={`${title}. Click to show the run details`} type="button">
      <strong className="min-w-0 truncate type-item">{title}</strong>
      {working && <span aria-label="Processing" className="size-1.5 flex-none rounded-full bg-active animate-fade-pulse motion-reduce:animate-none" role="status" />}
      {runError && <span className="flex-none type-meta font-medium text-destructive" title={runError}>Run unreachable</span>}
      {attention && <Badge className="flex-none truncate" role="status" tone="warning">{attention.label}</Badge>}
      {sharedAccess && <Badge className="flex-none" title={sharedWithYouLabel(sharedAccess)} variant="secondary">{sharedAccess === "read" ? "View only" : "Shared"}</Badge>}
      <ChevronDownIcon aria-hidden className="size-3.5 flex-none text-muted-foreground" />
    </InteractiveItem>}>
      <div className={detailsClass}>
        {registry.sessionMetadata.map(({ id, Metadata }) => <Metadata key={id} session={session.session} />)}
        <StartOptionBadges covered={new Set(registry.sessionMetadata.map(({ id }) => id))} registry={registry} session={session} />
        {contributions.filter((entry) => entry.placement !== "bar").map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
      </div>
    </HeaderDropdown>
    <div className="flex min-w-0 max-w-full flex-auto items-center justify-end empty:hidden" ref={actionsRef} />
    {contributions.filter((entry) => entry.placement === "bar").map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
    {session.session.canShare && <RunShareButton runId={session.session.id} shared={session.session.shared === true} title={title} />}
    <RunScriptMenu runId={session.session.id} />
  </div>;
}
