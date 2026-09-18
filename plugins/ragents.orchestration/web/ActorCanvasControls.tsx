import { useAccess } from "@aicontainer/web/AccessContext";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useCanvasController, type SessionContext, type SessionHeaderContext } from "@aicontainer/web/PluginRegistry";
import { UsersIcon } from "lucide-react";
import { Button, Input } from "@aicontainer/web/ui";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@aicontainer/web/Toolbar";
import { statusControlClass } from "./constants";
import { actorVisibleOnCanvas, DEFAULT_CANVAS_VIEW_PREFERENCES, type CanvasViewPreferences } from "./canvas-view-settings";
import { runViewFrom, type RunActor } from "./run-view";
import { ActorPopout } from "./ActorPopout";
import { ActorShortcut } from "./ActorShortcut";
import { ACTOR_HEADER_MODES, ACTOR_HEADER_MODE_LABELS, actorOnStage, actorVisibleInHeader, saveActorHeaderMode, useActorHeaderMode, type ActorHeaderMode } from "./actor-header-settings";
import { useStageEntities } from "./canvas-stage";

export interface ActorCanvasControlsProps {
  control: "actors" | "view";
  session: SessionContext;
  appActorIds: ReadonlySet<string>;
  preferences: CanvasViewPreferences;
  onPreferencesChange: (preferences: CanvasViewPreferences) => void;
}

const nameClass = "min-w-0 max-w-full text-left font-semibold [overflow-wrap:anywhere]";

const actorType = (actor: RunActor) => actor.kind === "human" ? "Benutzer" : actor.kind === "agent" ? "LLM-Agent" : "TypeScript-Actor";
const actorStatus = (actor: RunActor) => actor.lifecycle?.kind === "running" ? "Arbeitet" : actor.lifecycle?.kind === "stopped" ? "Gestoppt" : actor.lifecycle?.kind === "idle" ? "Bereit" : "";

export function filterCanvasActors(actors: readonly RunActor[], appActorIds: ReadonlySet<string>, query: string): readonly RunActor[] {
  const words = query.trim().toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
  return actors.filter((actor) => {
    const text = [`@${actor.handle}`, actor.displayName, actor.kind, actorType(actor), actor.lifecycle?.kind, actorStatus(actor), appActorIds.has(actor.id) ? "Mini-App" : ""].join(" ").toLocaleLowerCase("de-DE");
    return words.every((word) => text.includes(word));
  });
}

export function withAppActorVisibility(preferences: CanvasViewPreferences, appActorIds: ReadonlySet<string>, visible: boolean): CanvasViewPreferences {
  return { ...preferences, showAppActors: visible, actorVisibility: Object.fromEntries(Object.entries(preferences.actorVisibility).filter(([id]) => !appActorIds.has(id))) };
}

export function ActorShortcuts({ session }: SessionHeaderContext) {
  const inspect = useAccess().can("runs.inspect");
  const [openKey, setOpenKey] = useState<string>();
  const close = useCallback(() => setOpenKey(undefined), []);
  const mode = useActorHeaderMode(session.session.id);
  const stage = useStageEntities(session.session.id);
  const view = runViewFrom(session.runView);
  const actors = useMemo(() => view?.actors.filter((actor) => actor.kind !== "human" && (inspect || actor.kind === "agent")) ?? [], [inspect, view]);
  const shown = useCallback((actor: RunActor) => actorVisibleInHeader(actor, mode, actorOnStage(actor, view?.primaryActorId, stage)), [mode, stage, view?.primaryActorId]);
  useEffect(() => {
    if (openKey && !actors.some((actor) => `${session.session.id}:${actor.id}` === openKey && shown(actor))) close();
  }, [actors, close, openKey, session.session.id, shown]);
  if (!view || actors.length === 0) return null;

  return <nav aria-label="Actors des Runs" className="flex min-w-0 flex-none items-stretch">
    {actors.map((actor) => {
      const key = `${session.session.id}:${actor.id}`;
      return <ActorShortcut actor={actor} key={key} onClose={close}
        onToggle={() => setOpenKey((current) => current === key ? undefined : key)}
        open={openKey === key} session={session} view={view} visible={shown(actor)} />;
    })}
  </nav>;
}

const PUBLIC_ACTOR_HEADER_MODES: readonly ActorHeaderMode[] = ["active", "visible", "all"];

export function ActorHeaderModeControl({ runId }: { runId: string }) {
  const inspect = useAccess().can("runs.inspect");
  const mode = useActorHeaderMode(runId);
  const modes = inspect ? ACTOR_HEADER_MODES : PUBLIC_ACTOR_HEADER_MODES;
  const next = modes[(modes.indexOf(mode) + 1) % modes.length];
  const label = `Actor-Anzeige: ${ACTOR_HEADER_MODE_LABELS[mode]}. Wechseln zu ${ACTOR_HEADER_MODE_LABELS[next]}`;
  return <ToolbarItem as="button" aria-label={label} className="w-[120px] max-w-[120px] min-w-[120px] flex-[0_0_120px]" onClick={() => saveActorHeaderMode(runId, next)} title={label} type="button">
    <ToolbarCopy><ToolbarLabel>Anzeige</ToolbarLabel><ToolbarText>{ACTOR_HEADER_MODE_LABELS[mode]}</ToolbarText></ToolbarCopy>
  </ToolbarItem>;
}

export function ActorCanvasControls({ control, session, appActorIds, preferences, onPreferencesChange }: ActorCanvasControlsProps) {
  const [open, setOpen] = useState<"actors" | "view">();
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const canvas = useCanvasController();
  const runView = runViewFrom(session.runView);
  const actors = runView?.actors;
  const filtered = useMemo(() => filterCanvasActors(actors ?? [], appActorIds, query), [actors, appActorIds, query]);
  const close = useCallback((restoreFocus = false) => {
    setOpen(undefined);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => { close(); setQuery(""); }, [session.session.id, close]);

  const trigger = {
    ref: buttonRef,
    "aria-controls": open ? panelId : undefined,
    "aria-expanded": open !== undefined,
    "aria-label": control === "actors" ? `Actors \u00b7 ${actors?.length ?? 0}` : "Ansicht",
    title: control === "actors" ? `Actors \u00b7 ${actors?.length ?? 0}` : "Canvas-Ansicht",
    onClick: () => setOpen((value) => value === control ? undefined : control),
    type: "button" as const,
  };
  return <div className={control === "actors" ? "flex h-full min-w-0 flex-none items-stretch" : "flex h-full min-w-0 items-stretch"}>
    {control === "actors"
      ? <ToolbarItem as="button" {...trigger}><UsersIcon size={20} /><ToolbarText>Actors</ToolbarText></ToolbarItem>
      : <button className={statusControlClass} {...trigger}>Ansicht</button>}
    {open && <ActorPopout open id={panelId} label={open === "actors" ? "Actors des Runs" : "Canvas-Ansicht"}
      closeLabel={open === "actors" ? "Actorliste schließen" : "Canvas-Ansicht schließen"}
      buttonRef={buttonRef} onClose={close} width={open === "actors" ? 460 : 360} height={open === "actors" ? 460 : 260}
      placement={control === "actors" ? "bottom" : "top"} focusInput role="region">
      {open === "actors" ? <>
        <div className="flex flex-none items-center gap-2.5 p-2.5">
          <Input className="flex-1" aria-label="Actors durchsuchen" onChange={(event) => setQuery(event.target.value)} placeholder="Handle, Typ oder Status suchen ..." type="search" value={query} />
          <span className="flex-none whitespace-nowrap text-[0.68rem] text-muted-foreground" role="status">{filtered.length} von {actors?.length ?? 0}</span>
        </div>
        <ActorCanvasList actors={filtered} appActorIds={appActorIds} primaryActorId={runView?.primaryActorId} onInspect={(id) => {
          if (!canvas) throw new Error("Die Actorliste benötigt den Canvas-Controller.");
          canvas.acceptSelection({ type: "actor", id });
          close(true);
        }} onPreferencesChange={onPreferencesChange} preferences={preferences} />
      </> : <CanvasViewOptions appActorIds={appActorIds} onPreferencesChange={onPreferencesChange} preferences={preferences} />}
      <p className="flex-none border-t border-border-soft px-2.5 py-2.5 text-[0.68rem] text-muted-foreground">Persönliche Ansicht dieses Runs</p>
    </ActorPopout>}
  </div>;
}

export function ActorCanvasList({ actors, appActorIds, primaryActorId, onInspect, onPreferencesChange, preferences }: {
  actors: readonly RunActor[];
  appActorIds: ReadonlySet<string>;
  primaryActorId?: string | null;
  onInspect: (id: string) => void;
  onPreferencesChange: (preferences: CanvasViewPreferences) => void;
  preferences: CanvasViewPreferences;
}) {
  return <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-2.5">
    {actors.length === 0 ? <p className="text-muted-foreground">Keine passenden Actors.</p> : <ul className="list-none">{actors.map((actor) => <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border-soft py-1.5" key={actor.id}>
      <div className="grid min-w-0 gap-0.5 leading-[1.3]">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {actor.kind === "human" ? <span className={nameClass}>@{actor.handle}</span> : <button className={`${nameClass} cursor-pointer rounded-[2px] hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[3px]`} onClick={() => onInspect(actor.id)} title={`@${actor.handle} im Inspector öffnen`} type="button">@{actor.handle}</button>}
          {actor.displayName !== actor.handle && <span className="min-w-0 max-w-full text-[0.7rem] [overflow-wrap:anywhere]">{actor.displayName}</span>}
        </div>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.66rem] text-muted-foreground">
          <span>{actorType(actor)}</span>{actorStatus(actor) && <span>{actorStatus(actor)}</span>}{appActorIds.has(actor.id) && <span className="text-primary">Mini-App</span>}
        </span>
      </div>
      {actor.kind !== "human" && <label className="flex cursor-pointer items-center gap-[5px] whitespace-nowrap text-[0.68rem]">
        <input aria-label={`@${actor.handle} im Canvas anzeigen`} checked={actorVisibleOnCanvas(actor, appActorIds, preferences, primaryActorId)} onChange={(event) => onPreferencesChange({ ...preferences, actorVisibility: { ...preferences.actorVisibility, [actor.id]: event.target.checked } })} type="checkbox" />
        <span>Canvas</span>
      </label>}
    </li>)}</ul>}
  </div>;
}

export function CanvasViewOptions({ appActorIds, preferences, onPreferencesChange }: Pick<ActorCanvasControlsProps, "appActorIds" | "preferences" | "onPreferencesChange">) {
  return <div className="flex min-h-0 flex-1 flex-col items-start gap-4.5 overflow-auto overscroll-contain px-3 py-4 [&>label]:flex [&>label]:cursor-pointer [&>label]:items-center [&>label]:gap-2">
    <label><input checked={preferences.showAppActors} onChange={(event) => onPreferencesChange(withAppActorVisibility(preferences, appActorIds, event.target.checked))} type="checkbox" /><span>Actors mit Mini-App anzeigen</span></label>
    <label><input checked={preferences.showConnections} onChange={(event) => onPreferencesChange({ ...preferences, showConnections: event.target.checked })} type="checkbox" /><span>Verbindungen anzeigen</span></label>
    <Button onClick={() => onPreferencesChange(DEFAULT_CANVAS_VIEW_PREFERENCES)} size="sm" variant="ghost">Ansicht zurücksetzen</Button>
  </div>;
}
