import { useId, useRef, useState, type Ref } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { AttentionState, PluginRegistry, SessionContext, SessionNavigation } from "../PluginRegistry";
import { sharedWithYouLabel } from "../run-sharing";
import { StartOptionBadges } from "../StartOptions";
import { Badge, InteractiveItem, Popover, PopoverContent } from "../ui";
import { RunScriptMenu } from "./RunScriptMenu";
import { RunShareButton } from "./RunShareButton";

const titleClass = "flex h-[30px] min-w-0 max-w-full flex-1 basis-40 cursor-pointer items-center gap-2 self-center rounded-md px-1.5 text-left";

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const title = session.session.title || "New run";
  const sharedAccess = session.session.sharedAccess;
  const pressedAnchor = (details: { reason: string; event: Event }) =>
    details.reason === "outside-press" && details.event.target instanceof Node && buttonRef.current?.contains(details.event.target) === true;
  return <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
    <InteractiveItem aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={titleClass} onClick={() => setOpen((value) => !value)} ref={buttonRef} title={`${title}. Click to show the run details`} type="button">
      <strong className="min-w-0 truncate type-item">{title}</strong>
      {working && <span aria-label="Processing" className="size-1.5 flex-none rounded-full bg-active animate-fade-pulse motion-reduce:animate-none" role="status" />}
      {runError && <span className="flex-none type-meta font-medium text-destructive" title={runError}>Run unreachable</span>}
      {attention && <Badge className="flex-none truncate" role="status" tone="warning">{attention.label}</Badge>}
      {sharedAccess && <Badge className="flex-none" title={sharedWithYouLabel(sharedAccess)} variant="secondary">{sharedAccess === "read" ? "View only" : "Shared"}</Badge>}
      <ChevronDownIcon aria-hidden className="size-3.5 flex-none text-muted-foreground" />
    </InteractiveItem>
    <div className="flex min-w-0 max-w-full flex-auto items-center justify-end empty:hidden" ref={actionsRef} />
    {contributions.filter((entry) => entry.placement === "bar").map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
    {session.session.canShare && <RunShareButton runId={session.session.id} shared={session.session.shared === true} title={title} />}
    <RunScriptMenu runId={session.session.id} />
    <Popover onOpenChange={(next, details) => { if (!next && pressedAnchor(details)) return; setOpen(next); }} open={open}>
      <PopoverContent align="start" anchor={buttonRef} aria-label="Run details" className="max-h-[70vh] w-[calc(100vw-16px)] gap-0 overflow-auto rounded-md p-0" collisionPadding={8} dim id={panelId} role="dialog" side="bottom">
        <div className="flex flex-wrap items-stretch [&>*]:border-b [&>*]:border-border-soft">
          {registry.sessionMetadata.map(({ id, Metadata }) => <Metadata key={id} session={session.session} />)}
          <StartOptionBadges registry={registry} session={session} />
          {contributions.filter((entry) => entry.placement !== "bar").map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
