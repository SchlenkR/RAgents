import { useId, useRef, useState, type Ref } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { AttentionState, PluginRegistry, SessionContext, SessionNavigation } from "../PluginRegistry";
import { sharedWithYouLabel } from "../run-sharing";
import { StartOptionBadges } from "../StartOptions";
import { Badge, Popover, PopoverContent } from "../ui";
import { RunScriptMenu } from "./RunScriptMenu";
import { RunShareButton } from "./RunShareButton";

const titleClass = "flex h-[30px] min-w-0 flex-1 cursor-pointer items-center gap-2 self-center rounded-md px-1.5 text-left hover:bg-accent aria-expanded:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2";

/** The panel header: one line with title and state, the plugins' header contributions behind the title as a popover or, placed there, in the bar. */
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
  return <div className="@container/run-header flex min-w-0 flex-1 items-stretch">
    <button aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={titleClass} onClick={() => setOpen((value) => !value)} ref={buttonRef} title={`${title}. Click to show the run details`} type="button">
      <strong className="min-w-0 truncate type-item">{title}</strong>
      {working && <span aria-label="Processing" className="size-1.5 flex-none rounded-full bg-primary animate-fade-pulse motion-reduce:animate-none" role="status" />}
      {runError && <span className="flex-none type-meta font-medium text-destructive" title={runError}>Run unreachable</span>}
      {attention && <span className="flex-none truncate rounded-full bg-primary/10 px-2 py-0.5 type-meta font-semibold text-primary" role="status">{attention.label}</span>}
      {sharedAccess && <Badge className="flex-none" title={sharedWithYouLabel(sharedAccess)} variant="secondary">{sharedAccess === "read" ? "View only" : "Shared"}</Badge>}
      <ChevronDownIcon aria-hidden className="size-3.5 flex-none text-muted-foreground" />
    </button>
    <div className="flex min-w-20 max-w-1/2 shrink items-center justify-end empty:hidden" ref={actionsRef} />
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
