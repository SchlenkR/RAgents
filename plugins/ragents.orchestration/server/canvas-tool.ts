import { Type } from "typebox";
import {
  DomainError,
  actorByHandle,
  defineRunFunction,
  defineToolAvailability,
  eventResultSchema,
  holdsUsable,
  type RunFunction,
  type RunView,
  type ToolContributor,
} from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { ACTOR_PROGRAMS_STATE_ID, resolveActorView, type ActorProgramState } from "@ragents/host/plugin-support/actor-programs/contract.js";
import {
  ORCHESTRATION_PLUGIN_ID,
  canvasEntityOf,
  canvasLayoutOf,
  type CanvasLayout,
} from "../contract.js";
import { canvasTileEntities, mapCanvasTileEntities } from "../tiled-layout.js";

export const canvasToolMetadata = {
  name: "canvas_layout_replace",
  label: "Replace Canvas Layout",
  description: "Arrange actors and mini-apps as tiles on the viewport-filling work surface, using a binary tree of weighted splits.",
  longDescription: "root is the whole arrangement and replaces the stored one. A tile is {entity:'@helper'} or "
    + "{entity:'app:@workspace/main'}; a split is {direction:'horizontal',weights:[1,1],children:[tile,tile]}. "
    + "horizontal means left/right, vertical means top/bottom, and weights give the ratio of the two children. "
    + "App left, chat right at 50:50: {root:{direction:'horizontal',weights:[1,1],children:["
    + "{entity:'app:@workspace/main'},{entity:'@helper'}]}}. One tile above two tiles at 2:1: "
    + "{root:{direction:'vertical',weights:[2,1],children:[{entity:'@lead'},"
    + "{direction:'horizontal',weights:[1,1],children:[{entity:'@first'},{entity:'@second'}]}]}}. "
    + "root:null clears the surface. Dividers are draggable, so do not resend a layout to fight a personal arrangement. "
    + "Participants you do not place stay reachable through the run header.",
} as const;

export const canDesignCanvas = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Nur für Agenten und Script-Actors mit der Capability plugin.state.write.",
  requiredCapabilities: ["plugin.state.write"],
}, (actor) => actor.kind !== "human" && holdsUsable(actor, "plugin.state.write"));

const tileSchema = Type.Cyclic({
  CanvasTile: Type.Union([
    Type.Object({
      entity: Type.String({ minLength: 1, description: "Actor @handle or activated mini-app app:@handle/view-key or app:program-name/view-key; the server resolves the view ID" }),
      chatInput: Type.Optional(Type.Boolean({ description: "Actor tiles only: false hides the chat composer in the tile; default true. Does not change permissions or the inspector" })),
    }, { additionalProperties: false }),
    Type.Object({
      direction: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical")]),
      weights: Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })]),
      children: Type.Tuple([Type.Ref("CanvasTile"), Type.Ref("CanvasTile")]),
    }, { additionalProperties: false }),
  ]),
}, "CanvasTile");

const canvasLayoutSchema = Type.Object({
  root: Type.Union([tileSchema, Type.Null()], { description: "The whole arrangement: a tile or a binary split. Maximum 64 unique tiles and 16 nested splits. null clears the surface" }),
});

const invalid = (message: string) => new DomainError("invalid-canvas-layout", message, 400);

const parsedLayout = (input: unknown): CanvasLayout => {
  try {
    return canvasLayoutOf(input);
  } catch (caught) {
    throw invalid(caught instanceof Error ? caught.message : String(caught));
  }
};

const isStopped = (actor: RunView["actors"][number]) => actor.kind !== "human" && actor.lifecycle.kind === "stopped";

const canvasActorOf = (view: RunView, reference: string, where: string) => {
  const entity = canvasEntityOf(reference);
  if (entity.kind !== "actor") throw invalid(`${where}: ${reference} ist kein Actor`);
  const handle = entity.handle;
  const found = actorByHandle(view.actors, handle);
  if (!found) {
    const known = view.actors.filter((actor) => actor.kind !== "human").map((actor) => `@${actor.handle}`);
    throw invalid(`${where}: @${handle} ist kein Actor dieses Laufs. Vorhanden: ${known.join(", ") || "keine"}`);
  }
  if (found.kind === "human") {
    throw invalid(`${where}: @${handle} ist der Mensch im Chat; der Chat liegt fest links neben der Fläche`);
  }
  return found;
};

const isActorReference = (reference: string) => canvasEntityOf(reference).kind === "actor";

const resolveAppReferences = (view: RunView, layout: CanvasLayout): CanvasLayout => {
  const programs = view.pluginStates.flatMap((entry) => {
    if (entry.pluginId !== ACTOR_PROGRAMS_STATE_ID || entry.scope.kind !== "actor") return [];
    const actorId = entry.scope.actorId;
    const actor = view.actors.find((candidate) => candidate.id === actorId);
    if (!actor || actor.kind === "human" || isStopped(actor)) return [];
    const { program } = entry.state as unknown as ActorProgramState;
    return program ? [program] : [];
  });
  const resolve = (reference: string, where: string): string => {
    const entity = canvasEntityOf(reference);
    if (entity.kind !== "app") return reference;
    try {
      return `app:${resolveActorView(programs, entity.id).view.id}`;
    } catch (error) {
      throw invalid(`${where}: ${reference}: ${error instanceof Error ? error.message : String(error)} Canvas-Entitäten erhalten das Präfix app:.`);
    }
  };
  return parsedLayout({ root: layout.root ? mapCanvasTileEntities(layout.root, (entity) => resolve(entity, "root")) : null });
};

/** Resolve app names and validate the placed actors before any layout is stored. */
export const checkLayoutAgainstRun = (view: RunView, input: CanvasLayout): CanvasLayout => {
  const layout = resolveAppReferences(view, input);
  for (const reference of canvasTileEntities(layout.root)) {
    if (isActorReference(reference)) canvasActorOf(view, reference, "root");
  }
  return layout;
};

export const createCanvasTool = (): RunFunction =>
  defineRunFunction({
    ...canvasToolMetadata,
    schema: canvasLayoutSchema,
    resultSchema: eventResultSchema,
    available: canDesignCanvas,
    run: ({ runtime, caller, context, eventsFor }, toolCallId, input) => {
      const view = runtime.view(caller.runId);
      const layout = checkLayoutAgainstRun(view, parsedLayout(input));
      runtime.replacePluginState(context(toolCallId), caller.runId, {
        pluginId: ORCHESTRATION_PLUGIN_ID,
        scope: { kind: "run" },
        state: layout,
      });
      return eventsFor(toolCallId);
    },
  });

export const createCanvasToolContributor = (): ToolContributor => ({
  name: "ragents.orchestration.canvas",
  descriptors: [toolDescriptorFrom(canvasToolMetadata, canDesignCanvas)],
  tools: () => [createCanvasTool()],
});
