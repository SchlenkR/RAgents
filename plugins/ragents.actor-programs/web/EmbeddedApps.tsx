import { useAccess } from "@ragents/web/AccessContext";
import { cn, Spinner } from "@ragents/web/ui";
import { isRecord } from "@ragents/web/lib/guards";
import { runActorFrom } from "@ragents/web/run-view";
import type {
  SurfaceElementContext,
  SurfaceElementDefinition,
  CardSectionContext,
  SessionContext,
} from "@ragents/web/PluginRegistry";
import { HostConfirmation, pendingConfirmationFor, actorProgramApps, useActorPrograms } from "./AppsPanel";
import { ActorViewFrame } from "./ActorViewFrame";
import { FunctionForm } from "./FunctionForm";

const cardClass = "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-glass-edge bg-glass-app shadow-card backdrop-blur-[8px] in-data-[tone=material]:rounded-[inherit] in-data-[tone=material]:border-0 in-data-[tone=material]:bg-transparent in-data-[tone=material]:shadow-none in-data-[tone=material]:backdrop-filter-none";

export function ActorProgramToolCardSection({ actor, session }: CardSectionContext) {
  const inspect = useAccess().can("runs.inspect");
  const { listing } = useActorPrograms();
  const owner = runActorFrom(actor);
  if (!inspect || owner.lifecycle?.kind === "stopped") return null;
  const tools = listing?.tools.filter((tool) => tool.card && tool.actorId === owner.id) ?? [];
  if (tools.length === 0) return null;
  return (
    <section className="grid min-w-0 gap-[9px]">
      {tools.map((tool) => (
        <article aria-label={tool.name} className="min-w-0" key={`${session.session.id}:${tool.actorId}:${tool.functionId}:${tool.revision}`}>
          <strong>{tool.name}</strong>
          <FunctionForm session={session} tool={tool} />
        </article>
      ))}
    </section>
  );
}

export const actorProgramSurfaceElements = (session: SessionContext): readonly SurfaceElementDefinition[] =>
  actorProgramApps(session).flatMap((module): SurfaceElementDefinition[] => {
    const rawPlacements = module.app.placements;
    const placement = Array.isArray(rawPlacements) ? rawPlacements.find((entry) => isRecord(entry) && entry.kind === "canvas") : undefined;
    const surface = isRecord(placement) ? placement : undefined;
    if (surface && typeof surface.anchorActorId !== "string") {
      throw new Error(`Die Flächenplatzierung der Actor-Ansicht ${module.title} ist ungültig`);
    }
    if (surface && surface.anchorActorId !== module.actorId) throw new Error(`Die Ansicht ${module.title} gehört zu @${module.actorHandle}.`);
    return [{
      id: module.id,
      title: module.title,
      visible: module.app.visible !== false,
      anchorActorId: module.actorId,
      data: { actorId: module.actorId, actorHandle: module.actorHandle },
      entity: { type: "run-app", id: module.id },
    }];
  });

export function ActorProgramSurfaceElement({ definition, session }: SurfaceElementContext) {
  const { api, invoke, listing, runId } = useActorPrograms();
  const app = listing?.apps.find((candidate) => candidate.id === definition.id);
  const confirmation = app ? pendingConfirmationFor(session, app) : undefined;
  const title = definition.title ?? definition.id;
  const frame = app ? (
    <ActorViewFrame
      api={api}
      app={app}
      invoke={invoke}
      pendingConfirmationInvocationId={confirmation?.parameters.invocationId}
      presentation="tiled"
      runId={runId}
      session={session}
    />
  ) : (
    <div className="flex flex-1 items-center justify-center gap-2 text-[0.7rem] text-muted-foreground">
      <Spinner aria-hidden aria-label={undefined} role={undefined} />
      <span>Actor-Ansicht wird geladen</span>
    </div>
  );
  return (
    <article aria-label={title} className={cn(cardClass, "w-full rounded-none border-0 bg-transparent shadow-none backdrop-filter-none")}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>[data-slot=host-confirmation]]:max-h-[65%] [&>[data-slot=host-confirmation]]:flex-[0_1_auto] [&>[data-slot=host-confirmation]]:overflow-auto">
        {confirmation && <HostConfirmation action={confirmation} key={confirmation.id} session={session} />}
        {frame}
      </div>
    </article>
  );
}
