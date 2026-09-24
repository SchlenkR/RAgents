import { useAccess } from "@ragents/web/AccessContext";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SessionContext, SessionHeaderContext } from "@ragents/web/PluginRegistry";
import { UsersIcon } from "lucide-react";
import { Input } from "@ragents/web/ui";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@ragents/web/Toolbar";
import { actorVisibleOnSurface, type SurfaceViewPreferences } from "./surface-view-settings";
import { chatPrimaryId, runViewFrom, type RunActor } from "@ragents/web/run-view";
import { ActorPopout } from "./ActorPopout";
import { ActorShortcut } from "./ActorShortcut";
import { ACTOR_HEADER_MODES, ACTOR_HEADER_MODE_LABELS, actorOnStage, actorVisibleInHeader, saveActorHeaderMode, useActorHeaderMode, type ActorHeaderMode } from "./actor-header-settings";
import { useSurfaceEntities } from "./surface-entities";

export interface ActorSurfaceControlsProps {
  session: SessionContext;
  appActorIds: ReadonlySet<string>;
  preferences: SurfaceViewPreferences;
  onPreferencesChange: (preferences: SurfaceViewPreferences) => void;
}

const nameClass = "min-w-0 max-w-full text-left font-semibold [overflow-wrap:anywhere]";

const actorType = (actor: RunActor) => actor.kind === "human" ? "Benutzer" : actor.kind === "agent" ? "LLM-Agent" : "TypeScript-Actor";
const actorStatus = (actor: RunActor) => actor.lifecycle?.kind === "running" ? "Arbeitet" : actor.lifecycle?.kind === "stopped" ? "Gestoppt" : actor.lifecycle?.kind === "idle" ? "Bereit" : "";

export function filterSurfaceActors(actors: readonly RunActor[], appActorIds: ReadonlySet<string>, query: string): readonly RunActor[] {
  const words = query.trim().toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
  return actors.filter((actor) => {
    const text = [`@${actor.handle}`, actor.displayName, actor.kind, actorType(actor), actor.lifecycle?.kind, actorStatus(actor), appActorIds.has(actor.id) ? "Mini-App" : ""].join(" ").toLocaleLowerCase("de-DE");
    return words.every((word) => text.includes(word));
  });
}

export function ActorShortcuts({ session }: SessionHeaderContext) {
  const inspect = useAccess().can("runs.inspect");
  const [openKey, setOpenKey] = useState<string>();
  const close = useCallback(() => setOpenKey(undefined), []);
  const mode = useActorHeaderMode(session.session.id);
  const stage = useSurfaceEntities(session.session.id);
  const view = runViewFrom(session.runView);
  const actors = useMemo(() => view?.actors.filter((actor) => actor.kind !== "human" && (inspect || actor.kind === "agent")) ?? [], [inspect, view]);
  const primaryId = view ? chatPrimaryId(view) : undefined;
  const shown = useCallback((actor: RunActor) => actorVisibleInHeader(actor, mode, actorOnStage(actor, primaryId, stage)), [mode, stage, primaryId]);
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

export function ActorSurfaceControls({ session, appActorIds, preferences, onPreferencesChange }: ActorSurfaceControlsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const runView = runViewFrom(session.runView);
  const actors = runView?.actors;
  const filtered = useMemo(() => filterSurfaceActors(actors ?? [], appActorIds, query), [actors, appActorIds, query]);
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => { close(); setQuery(""); }, [session.session.id, close]);

  const label = `Actors \u00b7 ${actors?.length ?? 0}`;
  return <div className="flex h-full min-w-0 flex-none items-stretch">
    <ToolbarItem as="button" ref={buttonRef} aria-controls={open ? panelId : undefined} aria-expanded={open}
      aria-label={label} title={label} onClick={() => setOpen((value) => !value)} type="button">
      <UsersIcon size={20} /><ToolbarText>Actors</ToolbarText>
    </ToolbarItem>
    {open && <ActorPopout open id={panelId} label="Actors des Runs" closeLabel="Actorliste schließen"
      buttonRef={buttonRef} onClose={close} width={460} height={460}
      placement="bottom" focusInput role="region">
      <div className="flex flex-none items-center gap-2.5 p-2.5">
        <Input className="flex-1" aria-label="Actors durchsuchen" onChange={(event) => setQuery(event.target.value)} placeholder="Handle, Typ oder Status suchen ..." type="search" value={query} />
        <span className="flex-none whitespace-nowrap text-[0.68rem] text-muted-foreground" role="status">{filtered.length} von {actors?.length ?? 0}</span>
      </div>
      <ActorSurfaceList actors={filtered} appActorIds={appActorIds} primaryActorId={runView?.primaryActorId} onPreferencesChange={onPreferencesChange} preferences={preferences} />
      <p className="flex-none border-t border-border-soft px-2.5 py-2.5 text-[0.68rem] text-muted-foreground">Persönliche Ansicht dieses Runs</p>
    </ActorPopout>}
  </div>;
}

export function ActorSurfaceList({ actors, appActorIds, primaryActorId, onPreferencesChange, preferences }: {
  actors: readonly RunActor[];
  appActorIds: ReadonlySet<string>;
  primaryActorId?: string | null;
  onPreferencesChange: (preferences: SurfaceViewPreferences) => void;
  preferences: SurfaceViewPreferences;
}) {
  return <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-2.5">
    {actors.length === 0 ? <p className="text-muted-foreground">Keine passenden Actors.</p> : <ul className="list-none">{actors.map((actor) => <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border-soft py-1.5" key={actor.id}>
      <div className="grid min-w-0 gap-0.5 leading-[1.3]">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={nameClass}>@{actor.handle}</span>
          {actor.displayName !== actor.handle && <span className="min-w-0 max-w-full text-[0.7rem] [overflow-wrap:anywhere]">{actor.displayName}</span>}
        </div>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.66rem] text-muted-foreground">
          <span>{actorType(actor)}</span>{actorStatus(actor) && <span>{actorStatus(actor)}</span>}{appActorIds.has(actor.id) && <span className="text-primary">Mini-App</span>}
        </span>
      </div>
      {actor.kind !== "human" && <label className="flex cursor-pointer items-center gap-[5px] whitespace-nowrap text-[0.68rem]">
        <input aria-label={`@${actor.handle} auf der Fläche anzeigen`} checked={actorVisibleOnSurface(actor, appActorIds, preferences, primaryActorId)} onChange={(event) => onPreferencesChange({ ...preferences, actorVisibility: { ...preferences.actorVisibility, [actor.id]: event.target.checked } })} type="checkbox" />
        <span>Fläche</span>
      </label>}
    </li>)}</ul>}
  </div>;
}
