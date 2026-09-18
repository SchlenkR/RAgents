import { ACTOR_CARD_SIZE_LIMITS, DEFAULT_ACTOR_CARD_SIZE } from "@aicontainer/plugins/ragents.orchestration/web/card-size-settings";
import { useAccess } from "@aicontainer/web/AccessContext";
import { ChevronDownIcon, LayoutGridIcon } from "lucide-react";
import { Button, cn, Spinner } from "@aicontainer/web/ui";
import { isRecord } from "@aicontainer/web/lib/guards";
import { runActorFrom } from "@aicontainer/plugins/ragents.orchestration/web/contract";
import type {
  CanvasElementContext,
  CanvasElementDefinition,
  CardSectionContext,
  SessionContext,
} from "@aicontainer/web/PluginRegistry";
import { HostConfirmation, pendingConfirmationFor, actorProgramApps, useActorPrograms } from "./AppsPanel";
import { ActorViewFrame } from "./ActorViewFrame";
import { ExpandIcon } from "./ExpandIcon";
import { FunctionForm } from "./FunctionForm";

const materialIconClass = "in-data-[surface=material]:grid in-data-[surface=material]:size-8 in-data-[surface=material]:place-items-center in-data-[surface=material]:rounded-[11px] in-data-[surface=material]:border in-data-[surface=material]:border-glass-edge/55 in-data-[surface=material]:bg-white/9 in-data-[surface=material]:text-foreground in-data-[surface=material]:shadow-glass-icon in-data-[surface=material]:[&>svg]:size-5";
const cardClass = "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-glass-edge bg-glass-app shadow-card backdrop-blur-[8px] in-data-[surface=material]:rounded-[inherit] in-data-[surface=material]:border-0 in-data-[surface=material]:bg-transparent in-data-[surface=material]:shadow-none in-data-[surface=material]:backdrop-filter-none";
const headClass = "flex flex-[0_0_32px] items-center gap-[3px] border-b border-glass-edge bg-glass-head pr-1 pl-2.5 in-data-[surface=material]:basis-[49px] in-data-[surface=material]:rounded-t-[15.5px] in-data-[surface=material]:border-glass-edge/22 in-data-[surface=material]:bg-[color-mix(in_srgb,var(--material-face)_96%,black)] in-data-[surface=material]:px-3 in-data-[surface=material]:py-2 [[data-surface=material][data-resizable=true]_&]:mr-0 [[data-surface=material][data-resizable=true]_&]:pr-[34px]";
const headTitleClass = "min-w-0 flex-1 truncate text-[0.72rem] font-semibold in-data-[surface=material]:p-0 in-data-[surface=material]:text-[17px]/[1.3] in-data-[surface=material]:font-[730] in-data-[surface=material]:tracking-[-0.5px]";

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

const boundedInteger = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;

export const actorProgramCanvasElements = (session: SessionContext): readonly CanvasElementDefinition[] =>
  actorProgramApps(session).flatMap((module): CanvasElementDefinition[] => {
    const rawPlacements = module.app.placements;
    const placement = Array.isArray(rawPlacements) ? rawPlacements.find((entry) => isRecord(entry) && entry.kind === "canvas") : undefined;
    const canvas = isRecord(placement) ? placement : undefined;
    if (canvas && (typeof canvas.anchorActorId !== "string"
      || !boundedInteger(canvas.width, 280, 960) || !boundedInteger(canvas.height, 180, 720))) {
      throw new Error(`Die Canvas-Platzierung der Actor-Ansicht ${module.title} ist ungültig`);
    }
    if (canvas && canvas.anchorActorId !== module.actorId) throw new Error(`Die Ansicht ${module.title} gehört zu @${module.actorHandle}.`);
    return [{
      id: module.id,
      title: module.title,
      visible: module.app.visible !== false,
      width: DEFAULT_ACTOR_CARD_SIZE.width,
      height: DEFAULT_ACTOR_CARD_SIZE.height,
      collapsedHeight: 52,
      anchorActorId: module.actorId,
      data: { actorId: module.actorId, actorHandle: module.actorHandle },
      entity: { type: "run-app", id: module.id },
      resizable: {
        minWidth: 280,
        maxWidth: ACTOR_CARD_SIZE_LIMITS.maxWidth,
        minHeight: 180,
        maxHeight: ACTOR_CARD_SIZE_LIMITS.maxHeight,
      },
    }];
  });

export function ActorProgramCanvasElement({ collapsed = false, definition, onCollapsedChange, presentation = "canvas", session }: CanvasElementContext) {
  const { api, invoke, listing, openFullscreen, runId } = useActorPrograms();
  const app = listing?.apps.find((candidate) => candidate.id === definition.id);
  const confirmation = app ? pendingConfirmationFor(session, app) : undefined;
  const title = definition.title ?? definition.id;
  const frame = app ? (
    <ActorViewFrame
      api={api}
      app={app}
      invoke={invoke}
      pendingConfirmationInvocationId={confirmation?.parameters.invocationId}
      presentation={presentation === "tiled" ? "tiled" : "embedded"}
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
    <article aria-label={title} className={cn(cardClass, presentation === "tiled" && "w-full rounded-none border-0 bg-transparent shadow-none backdrop-filter-none")}>
      {presentation !== "tiled" && <header className={headClass}>
        <span className={materialIconClass}><LayoutGridIcon size={20} /></span>
        <strong className={headTitleClass} title={title}>{title}</strong>
        {isRecord(definition.data) && typeof definition.data.actorHandle === "string" && <small className="mr-1 text-[0.65rem] text-muted-foreground">@{definition.data.actorHandle}</small>}
        <Button aria-label={`${title} in Vollansicht öffnen`} onClick={() => openFullscreen(definition.id)} size="icon-sm" title={`${title} in Vollansicht öffnen`} variant="ghost">
          <ExpandIcon />
        </Button>
        {onCollapsedChange && (
          <Button aria-expanded={!collapsed} aria-label={`${title} ${collapsed ? "aufklappen" : "einklappen"}`} onClick={() => onCollapsedChange(!collapsed)} size="icon-sm" title={`${title} ${collapsed ? "aufklappen" : "einklappen"}`} variant="ghost">
            <ChevronDownIcon className={collapsed ? undefined : "rotate-180"} size={14} />
          </Button>
        )}
      </header>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>[data-slot=host-confirmation]]:max-h-[65%] [&>[data-slot=host-confirmation]]:flex-[0_1_auto] [&>[data-slot=host-confirmation]]:overflow-auto" hidden={presentation !== "tiled" && collapsed}>
        {confirmation && <HostConfirmation action={confirmation} key={confirmation.id} session={session} />}
        {frame}
      </div>
    </article>
  );
}
