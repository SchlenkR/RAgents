import { useId, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { AttentionState, PluginRegistry, SessionContext, SessionNavigation } from "../PluginRegistry";
import { StartOptionBadges } from "../StartOptions";
import { Popover, PopoverContent } from "../ui";

const titleClass = "flex h-[30px] min-w-0 flex-1 cursor-pointer items-center gap-2 self-center rounded-md px-1.5 text-left hover:bg-accent aria-expanded:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2";

/** Die Kopfzeile des Panels: eine Zeile mit Titel und Zustand, die Kopfzeilenbeiträge der Plugins hinter dem Titel als Popover. */
export function RunPanelHeader({ attention, contributions, navigation, registry, runError, session, working }: {
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
  const title = session.session.title || "Neuer Run";
  const pressedAnchor = (details: { reason: string; event: Event }) =>
    details.reason === "outside-press" && details.event.target instanceof Node && buttonRef.current?.contains(details.event.target) === true;
  return <div className="flex min-w-0 flex-1 items-stretch">
    <button aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={titleClass} onClick={() => setOpen((value) => !value)} ref={buttonRef} title={`${title}. Klick zeigt die Run-Details`} type="button">
      <strong className="min-w-0 truncate text-[0.82rem] font-semibold">{title}</strong>
      {working && <span aria-label="Bearbeitung läuft" className="size-1.5 flex-none rounded-full bg-primary animate-fade-pulse motion-reduce:animate-none" role="status" />}
      {runError && <span className="flex-none text-[0.68rem] font-medium text-destructive" title={runError}>Run nicht erreichbar</span>}
      {attention && <span className="flex-none truncate rounded-full bg-primary/10 px-2 py-0.5 text-[0.66rem] font-semibold text-primary" role="status">{attention.label}</span>}
      <ChevronDownIcon aria-hidden className="size-3.5 flex-none text-muted-foreground" />
    </button>
    <Popover onOpenChange={(next, details) => { if (!next && pressedAnchor(details)) return; setOpen(next); }} open={open}>
      <PopoverContent align="start" anchor={buttonRef} aria-label="Run-Details" className="max-h-[70vh] w-[calc(100vw-16px)] gap-0 overflow-auto rounded-md p-0 text-[0.76rem]" collisionPadding={8} dim id={panelId} role="dialog" side="bottom" sideOffset={4}>
        <div className="flex flex-wrap items-stretch [&>*]:border-b [&>*]:border-border-soft">
          {registry.sessionMetadata.map(({ id, Metadata }) => <Metadata key={id} placement="header" session={session.session} />)}
          <StartOptionBadges registry={registry} session={session} />
          {contributions.map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
