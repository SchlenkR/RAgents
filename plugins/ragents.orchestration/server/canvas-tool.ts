import { Type } from "typebox";
import {
  DomainError,
  defineRunFunction,
  defineToolAvailability,
  eventResultSchema,
  holdsUsable,
  type RunFunction,
  type RunView,
  type ToolContributor,
} from "@aicontainer/ragents";
import { toolDescriptorFrom } from "@aicontainer/server/plugin-support/agent-tool.js";
import { ACTOR_PROGRAMS_STATE_ID, resolveActorView, type ActorProgramState } from "@aicontainer/plugins/ragents.actor-programs/contract.js";
import {
  CANVAS_ARROWS,
  CANVAS_GROUP_KINDS,
  CANVAS_LINE_STYLES,
  CANVAS_SHAPE_KINDS,
  CANVAS_TREE_DIRECTIONS,
  ORCHESTRATION_PLUGIN_ID,
  canvasEntityOf,
  canvasLayoutOf,
  isCanvasGroupNode,
  type CanvasLayout,
} from "../contract.js";
import { canvasTileEntities, mapCanvasTileEntities } from "../tiled-layout.js";

const ENTITY = "@handle names an actor, shape:<id> one of the shapes of this call, "
  + "app:@handle/view-key or app:program-name/view-key an activated actor view. "
  + "Use the actor handle or program name and view key you chose; the server resolves the view ID";

export const canvasToolMetadata = {
  name: "canvas_layout_replace",
  label: "Replace Canvas Layout",
  description: "Arrange actors and mini-apps on the free canvas or in a viewport-filling tiled layout with nested, weighted splits.",
  longDescription: "Free mode is the default. Set mode: 'tiled' and root to a recursive tree: "
    + "{entity:'@helper'} or {direction:'horizontal',weights:[2,1],children:[{entity:'app:@workspace/main'},{entity:'@helper'}]}. "
    + "horizontal means left/right; vertical means top/bottom. Weights [1,1] split equally. "
    + "Every split has two children, which may themselves be splits. Tiled mode has draggable dividers and no canvas pan or zoom. "
    + "Mode/root-only calls preserve the free layout; mode:'free' restores it. Personal user arrangements take precedence until reset. "
    + "In free mode the canvas draws NO lines by itself; "
    + "a relation is visible only when you add a line here. Actors you do not place appear below your "
    + "layout as lineage trees. Approximate sizes in px for planning wrap widths: an actor card is 150 to "
    + "320 wide and 44 high without card sections, with sections (documents, to-dos, tools) 360 to 640 wide "
    + "and 100 to 300 high; an actor view uses its declared canvas placement (280 to 960 by 180 to 720); "
    + "a circle shape is 120 wide, a diamond 150 by 94 by default.",
} as const;

export const canDesignCanvas = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Nur für Agenten und Script-Actors mit der Capability plugin.state.write.",
  requiredCapabilities: ["plugin.state.write"],
}, (actor) => actor.kind !== "human" && holdsUsable(actor, "plugin.state.write"));

const literals = <T extends string>(values: readonly T[]) => values.map((value) => Type.Literal(value));

const tileSchema = Type.Cyclic({
  CanvasTile: Type.Union([
    Type.Object({ entity: Type.String({ minLength: 1, description: "Actor @handle or activated mini-app app:@handle/view-key; no shapes" }) }, { additionalProperties: false }),
    Type.Object({
      direction: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical")]),
      weights: Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })]),
      children: Type.Tuple([Type.Ref("CanvasTile"), Type.Ref("CanvasTile")]),
    }, { additionalProperties: false }),
  ]),
}, "CanvasTile");

const canvasLayoutSchema = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal("free"), Type.Literal("tiled")], { description: "free is the default; tiled fills the viewport, disables pan/zoom and uses root" })),
  root: Type.Optional(Type.Union([tileSchema, Type.Null()], { description: "Tiled layout: an actor/app leaf or a binary split. Maximum 64 unique leaves and 16 nested splits. null clears the tiles; omitted preserves them" })),
  nodes: Type.Optional(Type.Array(Type.Object({
    id: Type.Optional(Type.String({ minLength: 1, description: "Groups only: an id you choose; member nodes name it in parent" })),
    group: Type.Optional(Type.Union(literals(CANVAS_GROUP_KINDS), {
      description: "Makes the node a group. h = row, v = column, wrap-h = row wrapping at width, "
        + "wrap-v = column wrapping at height, grid = columns by rows, circle = members on a ring "
        + "(actors talking to each other), tree = the root actor and everything it spawned",
    })),
    entity: Type.Optional(Type.String({ minLength: 1, description: `Items only: ${ENTITY}` })),
    chatInput: Type.Optional(Type.Boolean({ description: "Actor items only: false hides the chat composer on free canvas and tiles; default true. Does not change permissions or the inspector" })),
    parent: Type.Optional(Type.String({ minLength: 1, description: "Id of the enclosing group; omitted = top level (top-level nodes stack vertically)" })),
    label: Type.Optional(Type.String({ description: "Groups: caption above the members, shown with or without frame" })),
    frame: Type.Optional(Type.Boolean({ description: "Groups: true draws a dashed outline around the members; default false, no outline" })),
    gap: Type.Optional(Type.Number({ minimum: 0, description: "Groups: minimum distance between members in px, default 44; labelled connections may increase it to leave room for their text" })),
    width: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "wrap-h only and required there: row width in px before wrapping" })),
    height: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "wrap-v only and required there: column height in px before wrapping" })),
    columns: Type.Optional(Type.Integer({ minimum: 1, description: "grid only and required there" })),
    direction: Type.Optional(Type.Union(literals(CANVAS_TREE_DIRECTIONS), { description: "tree only: where the children go, default right" })),
    root: Type.Optional(Type.String({ minLength: 1, description: "tree only and required there: @handle of the root actor" })),
  }))),
  shapes: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ minLength: 1, description: "Your id; place the shape as an item with entity shape:<id>" }),
    kind: Type.Union(literals(CANVAS_SHAPE_KINDS)),
    text: Type.String({ minLength: 1, description: "Text inside the shape; keep it to a few words" }),
    size: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "Diameter of a circle or width of a diamond in px; default 120 and 150" })),
  }))),
  lines: Type.Optional(Type.Array(Type.Object({
    from: Type.String({ minLength: 1, description: ENTITY }),
    to: Type.String({ minLength: 1, description: `${ENTITY}; must differ from from` }),
    label: Type.Optional(Type.String({ description: "Short caption on the line" })),
    arrow: Type.Optional(Type.Union(literals(CANVAS_ARROWS), { description: "none = plain line (default), end = arrow at to, both = arrows at both ends" })),
    style: Type.Optional(Type.Union(literals(CANVAS_LINE_STYLES), { description: "solid (default) or dashed" })),
  }))),
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

const actorByHandle = (view: RunView, reference: string, where: string) => {
  const entity = canvasEntityOf(reference);
  if (entity.kind !== "actor") throw invalid(`${where}: ${reference} ist kein Actor`);
  const handle = entity.handle;
  const sharing = view.actors.filter((actor) => actor.handle === handle);
  const found = sharing.find((actor) => actor.kind === "human" || !isStopped(actor)) ?? sharing.at(-1);
  if (!found) {
    const known = view.actors.filter((actor) => actor.kind !== "human").map((actor) => `@${actor.handle}`);
    throw invalid(`${where}: @${handle} ist kein Actor dieses Laufs. Vorhanden: ${known.join(", ") || "keine"}`);
  }
  if (found.kind === "human") {
    throw invalid(`${where}: @${handle} ist der Mensch im Chat; der Chat liegt fest links neben der Fläche`);
  }
  return found;
};

const descendantsOf = (view: RunView, actorId: string): string[] => {
  const result: string[] = [];
  const queue = [actorId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const actor of view.actors) {
      if (actor.kind !== "human" && actor.createdBy === current && !result.includes(actor.id)) {
        result.push(actor.id);
        queue.push(actor.id);
      }
    }
  }
  return result;
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
  return parsedLayout({
    ...layout,
    ...(layout.root ? { root: mapCanvasTileEntities(layout.root, (entity) => resolve(entity, "root")) } : {}),
    nodes: layout.nodes.map((node, index) => isCanvasGroupNode(node)
      ? node : { ...node, entity: resolve(node.entity, `nodes[${index}].entity`) }),
    lines: layout.lines.map((line, index) => ({
      ...line,
      from: resolve(line.from, `lines[${index}].from`),
      to: resolve(line.to, `lines[${index}].to`),
    })),
  });
};

/** Resolve app names and validate entities and actor ancestry before any layout is stored. */
export const checkLayoutAgainstRun = (view: RunView, input: CanvasLayout): CanvasLayout => {
  const layout = resolveAppReferences(view, input);
  for (const reference of canvasTileEntities(layout.root)) {
    if (isActorReference(reference)) actorByHandle(view, reference, "root");
  }
  const placed = new Map<string, string>();
  layout.nodes.forEach((node, index) => {
    if (isCanvasGroupNode(node) || !isActorReference(node.entity)) return;
    const actor = actorByHandle(view, node.entity, `nodes[${index}]`);
    placed.set(actor.id, node.entity);
  });
  const trees = layout.nodes.flatMap((node, index) =>
    isCanvasGroupNode(node) && node.group === "tree"
      ? [{ node, root: actorByHandle(view, node.root, `nodes[${index}].root`) }]
      : []);
  for (const { node, root } of trees) {
    if (placed.has(root.id)) {
      throw invalid(`Baum ${node.id}: die Wurzel ${node.root} ist zusätzlich einzeln platziert`);
    }
    for (const id of descendantsOf(view, root.id)) {
      const reference = placed.get(id);
      if (reference) throw invalid(`Baum ${node.id}: ${reference} gehört zur Abstammung von ${node.root} und ist zusätzlich einzeln platziert`);
      const other = trees.find((tree) => tree.root.id === id);
      if (other) throw invalid(`Baum ${other.node.id}: ${other.node.root} liegt schon im Baum ${node.id} von ${node.root}`);
    }
  }
  layout.lines.forEach((line, index) => {
    if (isActorReference(line.from)) actorByHandle(view, line.from, `lines[${index}].from`);
    if (isActorReference(line.to)) actorByHandle(view, line.to, `lines[${index}].to`);
  });
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
      if (input.nodes === undefined && input.mode === undefined && input.root === undefined) throw invalid("nodes oder mode/root muss angegeben werden");
      if (input.nodes === undefined && (input.shapes !== undefined || input.lines !== undefined)) throw invalid("shapes und lines ersetzen den freien Canvas zusammen mit nodes");
      const currentState = view.pluginStates.find((entry) => entry.pluginId === ORCHESTRATION_PLUGIN_ID && entry.scope.kind === "run");
      const current = currentState ? parsedLayout(currentState.state) : { nodes: [], shapes: [], lines: [] };
      const checked = checkLayoutAgainstRun(view, parsedLayout({ ...input, nodes: input.nodes ?? [] }));
      const layout: CanvasLayout = {
        ...current,
        ...checked,
        ...(input.nodes === undefined ? { nodes: current.nodes, shapes: current.shapes, lines: current.lines } : {}),
        ...(input.mode !== undefined || input.root !== undefined || current.mode !== undefined
          ? { mode: input.mode ?? (input.root !== undefined ? "tiled" : "free") } : {}),
      };
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
