import { useAccess } from "@ragents/web/AccessContext";
import { useCallback, useId, useRef, useState } from "react";
import { useCanvasController, type SessionContext } from "@ragents/web/PluginRegistry";
import { CodeIcon, UsersIcon } from "lucide-react";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@ragents/web/Toolbar";
import { cn } from "@ragents/web/ui";
import { FlowInspector, type FlowSelection } from "./FlowInspector";
import { ActorPopout } from "./ActorPopout";
import { actorSurface, type RunActor, type RunView } from "@ragents/web/run-view";
import { useStageEntities } from "./canvas-stage";
import { CANVAS_TILE_DRAG_TYPE } from "./tile-docking";

const shortcutIconClass = "grid size-[30px] flex-none place-items-center rounded-lg border border-foreground/15 text-foreground";

const shortcutFillClass: Readonly<Record<string, string>> = {
  agent: "bg-glass-agent",
  primary: "bg-glass-primary",
  script: "bg-glass-script",
  app: "bg-glass-app",
};

export function ActorShortcut({ actor, view, session, open, onToggle, onClose, visible }: {
  actor: RunActor;
  view: RunView;
  session: SessionContext;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  visible: boolean;
}) {
  const staged = useStageEntities(session.session.id).has(`@${actor.handle}`);
  const technical = useAccess().can("runs.inspect");
  const [visited, setVisited] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const canvas = useCanvasController();
  const close = useCallback((restoreFocus = false) => {
    onClose();
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, [onClose]);

  const inspect = (selection: FlowSelection) => {
    if (!canvas) throw new Error("Der Actor-Zugang benötigt den Canvas-Controller.");
    canvas.acceptSelection(selection);
    close();
  };
  const surface = actorSurface(view, actor);
  const label = actor.kind === "agent" ? `Chat mit @${actor.handle}` : `Actor-Ansicht von @${actor.handle}`;
  const type = !technical ? "Agent" : actor.kind === "agent" ? "LLM-Agent" : "TypeScript-Actor";

  return <div className="flex items-stretch [&[hidden]]:hidden" hidden={!visible}>
    <ToolbarItem as="button" aria-controls={visited ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog"
      aria-label={`${actor.displayName || actor.handle}. ${type}: ${label} öffnen`} className="font-bold"
      data-surface={surface} data-staged={staged || undefined} onClick={() => { setVisited(true); onToggle(); }}
      draggable={technical} onDragStart={(event) => {
        if (!technical) { event.preventDefault(); return; }
        event.dataTransfer.setData(CANVAS_TILE_DRAG_TYPE, `@${actor.handle}`);
        event.dataTransfer.effectAllowed = "move";
        close();
      }}
      ref={buttonRef} title={`${type}: ${label} öffnen${technical ? ". Zum Andocken auf eine Kachel ziehen." : ""}`} type="button">
      <span className={cn(shortcutIconClass, staged && shortcutFillClass[surface])}>{actor.kind === "agent" ? <UsersIcon size={20} /> : <CodeIcon size={20} />}</span>
      <ToolbarCopy><ToolbarLabel>@{actor.handle}</ToolbarLabel><ToolbarText>{actor.displayName && actor.displayName !== actor.handle ? actor.displayName : type}</ToolbarText></ToolbarCopy>
    </ToolbarItem>
    {visited && <ActorPopout open={open} id={panelId} label={label} closeLabel={`${label} schließen`}
      buttonRef={buttonRef} keepMounted onClose={close} width={actor.kind === "agent" ? 784 : 560} height={640} role="dialog">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
        <FlowInspector actorConversations={session.actorConversations} canGoBack={false} chatSurface="popout" composerVisible
          conversationError={session.conversationError} onBack={() => {}} onNavigate={inspect}
          primaryMessages={session.messages} primaryRunning={session.running} selection={{ type: "actor", id: actor.id }} view={view} />
      </div>
    </ActorPopout>}
  </div>;
}
