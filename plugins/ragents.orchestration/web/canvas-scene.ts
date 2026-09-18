import {
  canvasEntityOf,
  canvasShapeSize,
  isCanvasGroupNode,
  type CanvasArrow,
  type CanvasGroupNode,
  type CanvasLayout,
  type CanvasLineStyle,
  type CanvasShape,
} from "../contract";
import type { BoundaryShape, GroupLayout, SceneGroup, SceneLeaf, SceneNode } from "./canvas-layout";
import type { RunActor, RunView } from "./run-view";
import { ACTOR_PROGRAMS_STATE_ID, type ActorProgramState } from "@aicontainer/plugins/ragents.actor-programs/contract";

export const DEFAULT_GAP = 44;
export const RANK_GAP = 86;
export const TOP_LEVEL_GAP = 56;
export const ANCHORED_GAP = 20;
export const AUTO_APP_MAX_COLUMNS = 3;
export const UNPLACED_LABEL = "Automatisch angeordnet";

export interface SceneApp {
  key: string;
  id: string;
  width: number;
  height: number;
  anchorActorId?: string;
}

export type SceneLeafInfo =
  | { type: "actor"; actor: RunActor }
  | { type: "app"; app: SceneApp }
  | { type: "shape"; shape: CanvasShape }
  | { type: "missing"; reference: string };

export interface SceneLine {
  key: string;
  fromKey: string;
  toKey: string;
  label?: string;
  arrow: CanvasArrow;
  style: CanvasLineStyle;
}

export interface Scene {
  root: SceneGroup;
  leaves: Map<string, SceneLeafInfo>;
  lines: SceneLine[];
  notices: string[];
}

export interface SceneInput {
  view: RunView;
  layout?: CanvasLayout;
  layoutProblem?: string;
  actorSize: (actor: RunActor) => { width: number; height: number };
  apps: readonly SceneApp[];
  hiddenAppIds?: readonly string[];
  hiddenActorIds?: readonly string[];
  showConnections?: boolean;
}

const ACTOR_KIND_ORDER: Record<string, number> = { human: 0, agent: 1, script: 2 };

export const actorSort = (left: RunActor, right: RunActor) =>
  (ACTOR_KIND_ORDER[left.kind] ?? 3) - (ACTOR_KIND_ORDER[right.kind] ?? 3)
  || String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))
  || left.id.localeCompare(right.id);

export const boundaryOf = (info: SceneLeafInfo): BoundaryShape =>
  info.type === "shape" ? (info.shape.kind === "circle" ? "circle" : "diamond") : "rect";

const missingSize = (reference: string) => ({
  width: Math.min(360, Math.max(160, 60 + reference.length * 8)),
  height: 36,
});

const isStopped = (actor: RunActor) => actor.lifecycle?.kind === "stopped";

/** Mirrors the server: an active actor wins the handle, otherwise the latest one. */
const actorsByHandle = (view: RunView): Map<string, RunActor> => {
  const byHandle = new Map<string, RunActor>();
  for (const actor of view.actors) {
    if (actor.kind === "human") continue;
    const handle = actor.handle.toLowerCase();
    const current = byHandle.get(handle);
    if (!current || isStopped(current)) byHandle.set(handle, actor);
  }
  return byHandle;
};

const groupLayoutOf = (node: CanvasGroupNode): GroupLayout => {
  const gap = node.gap ?? DEFAULT_GAP;
  switch (node.group) {
    case "h": return { type: "stack", axis: "h", gap };
    case "v": return { type: "stack", axis: "v", gap };
    case "wrap-h": return { type: "wrap", axis: "h", limit: node.width, gap };
    case "wrap-v": return { type: "wrap", axis: "v", limit: node.height, gap };
    case "grid": return { type: "grid", columns: node.columns, gap };
    case "circle": return { type: "circle", gap };
    case "tree": return { type: "tree", direction: node.direction, rankGap: RANK_GAP, siblingGap: gap };
  }
};

export const buildScene = ({ view, layout, layoutProblem, actorSize, apps, hiddenAppIds = [], hiddenActorIds = [], showConnections = true }: SceneInput): Scene => {
  const hiddenActors = new Set(hiddenActorIds);
  const hiddenAppReferences = new Set(hiddenAppIds.map((id) => `app:${id}`));
  const availableAppIds = new Set(apps.map((app) => app.id));
  const stoppedActorIds = new Set(view.actors.filter(isStopped).map((actor) => actor.id));
  for (const entry of view.pluginStates) {
    if (entry.pluginId !== ACTOR_PROGRAMS_STATE_ID || entry.scope.kind !== "actor" || !stoppedActorIds.has(entry.scope.actorId)) continue;
    const { program } = entry.state as ActorProgramState;
    for (const app of program?.views ?? []) {
      if (!availableAppIds.has(app.id)) hiddenAppReferences.add(`app:${app.id}`);
    }
  }
  const notices: string[] = layoutProblem ? [`Layout unlesbar: ${layoutProblem}`] : [];
  const leaves = new Map<string, SceneLeafInfo>();
  const cards = view.actors.filter((actor) => actor.kind !== "human").sort(actorSort);
  const byHandle = actorsByHandle(view);
  const shapesById = new Map((layout?.shapes ?? []).map((shape) => [shape.id, shape]));
  const appsById = new Map(apps.map((app) => [app.id, app]));
  const placedActors = new Set<string>();
  const placedApps = new Set<string>();
  const entityKeys = new Map<string, string>();

  const actorLeaf = (actor: RunActor): SceneLeaf => {
    const key = `actor:${actor.id}`;
    placedActors.add(actor.id);
    leaves.set(key, { type: "actor", actor });
    return { kind: "leaf", key, ...actorSize(actor) };
  };
  const appLeaf = (app: SceneApp): SceneLeaf => {
    placedApps.add(app.key);
    leaves.set(app.key, { type: "app", app });
    entityKeys.set(`app:${app.id}`, app.key);
    return { kind: "leaf", key: app.key, width: app.width, height: app.height };
  };
  const shapeLeaf = (shape: CanvasShape): SceneLeaf => {
    const key = `shape:${shape.id}`;
    leaves.set(key, { type: "shape", shape });
    entityKeys.set(key, key);
    return { kind: "leaf", key, ...canvasShapeSize(shape) };
  };
  const missingLeaf = (reference: string, reason: string): SceneLeaf => {
    const key = `missing:${reference}`;
    leaves.set(key, { type: "missing", reference });
    notices.push(reason);
    return { kind: "leaf", key, ...missingSize(reference) };
  };

  // Actors and apps named as single items are spoken for before any tree claims its lineage.
  const claimed = new Set<string>();
  const claimedApps = new Set<string>();
  for (const node of layout?.nodes ?? []) {
    if (isCanvasGroupNode(node)) continue;
    const entity = canvasEntityOf(node.entity);
    if (entity.kind === "actor") {
      const actor = byHandle.get(entity.handle);
      if (actor) claimed.add(actor.id);
    } else if (entity.kind === "app") {
      const app = appsById.get(entity.id);
      if (app) claimedApps.add(app.key);
    }
  }

  const appGroup = (key: string, members: readonly SceneApp[]): SceneGroup => ({
    kind: "group", key,
    layout: { type: "grid", columns: Math.min(AUTO_APP_MAX_COLUMNS, Math.ceil(Math.sqrt(members.length))), gap: DEFAULT_GAP },
    children: members.map(appLeaf),
  });

  // Apps keep their owner's position even when the owner's card is hidden.
  const actorWithApps = (actor: RunActor): SceneNode | undefined => {
    placedActors.add(actor.id);
    const leaf = hiddenActors.has(actor.id) ? undefined : actorLeaf(actor);
    const anchored = apps.filter((app) =>
      app.anchorActorId === actor.id && !claimedApps.has(app.key) && !placedApps.has(app.key));
    if (anchored.length === 0) return leaf;
    const group = appGroup(`anchored-apps:${actor.id}`, anchored);
    return leaf
      ? { kind: "group", key: `anchored:${actor.id}`, layout: { type: "stack", axis: "v", gap: ANCHORED_GAP }, children: [leaf, group] }
      : group;
  };

  const lineageNode = (actor: RunActor, direction: "right" | "down", siblingGap: number): SceneGroup | undefined => {
    const node = actorWithApps(actor);
    const children = cards.filter((candidate) =>
      candidate.createdBy === actor.id && !claimed.has(candidate.id) && !placedActors.has(candidate.id));
    const descendants = children.flatMap((child) => {
      const branch = lineageNode(child, direction, siblingGap);
      return branch ? [branch] : [];
    });
    if (!node && descendants.length === 0) return undefined;
    return {
      kind: "group",
      key: `lineage:${actor.id}`,
      layout: node ? { type: "tree", direction, rankGap: RANK_GAP, siblingGap }
        : { type: "stack", axis: direction === "right" ? "v" : "h", gap: siblingGap },
      children: node ? [node, ...descendants] : descendants,
    };
  };

  const itemNode = (reference: string): SceneNode | undefined => {
    const entity = canvasEntityOf(reference);
    if (entity.kind === "actor") {
      const actor = byHandle.get(entity.handle);
      if (!actor) return missingLeaf(reference, `${reference} ist kein Actor dieses Laufs`);
      if (placedActors.has(actor.id)) return missingLeaf(reference, `${reference} ist schon platziert`);
      return actorWithApps(actor);
    }
    if (entity.kind === "shape") {
      const shape = shapesById.get(entity.id);
      return shape ? shapeLeaf(shape) : missingLeaf(reference, `${reference} ist keine definierte Form`);
    }
    const app = appsById.get(entity.id);
    if (!app) return missingLeaf(reference, `${reference} ist keine App auf der Fläche`);
    if (placedApps.has(app.key)) return missingLeaf(reference, `${reference} ist schon platziert`);
    return appLeaf(app);
  };

  const treeChildren = (node: CanvasGroupNode & { group: "tree" }, group: SceneGroup): SceneNode[] => {
    const entity = canvasEntityOf(node.root);
    const actor = entity.kind === "actor" ? byHandle.get(entity.handle) : undefined;
    if (!actor) return [missingLeaf(node.root, `${node.root} ist kein Actor dieses Laufs; der Baum ${node.id} bleibt leer`)];
    if (placedActors.has(actor.id)) return [missingLeaf(node.root, `${node.root} ist schon platziert; der Baum ${node.id} bleibt leer`)];
    const tree = lineageNode(actor, node.direction, node.gap ?? DEFAULT_GAP);
    if (tree) group.layout = tree.layout;
    return tree?.children ?? [];
  };

  const groups = new Map<string, SceneGroup>();
  const topLevel: SceneNode[] = [];
  for (const node of layout?.nodes ?? []) {
    if (!isCanvasGroupNode(node)) continue;
    groups.set(node.id, {
      kind: "group",
      key: `group:${node.id}`,
      layout: groupLayoutOf(node),
      children: [],
      ...(node.label || node.frame ? { frame: { label: node.label, outline: node.frame } } : {}),
    });
  }
  for (const node of layout?.nodes ?? []) {
    const target = node.parent ? groups.get(node.parent)?.children : topLevel;
    if (!target) continue;
    if (isCanvasGroupNode(node)) {
      const group = groups.get(node.id)!;
      if (node.group === "tree") group.children = treeChildren(node, group);
      target.push(group);
    } else {
      if (!hiddenAppReferences.has(node.entity)) {
        const item = itemNode(node.entity);
        if (item) target.push(item);
      }
    }
  }

  const unplaced = cards.filter((actor) => !placedActors.has(actor.id));
  const unplacedIds = new Set(unplaced.map((actor) => actor.id));
  const roots = unplaced.filter((actor) => !actor.createdBy || !unplacedIds.has(actor.createdBy));
  const autoChildren: SceneNode[] = roots
    .filter((actor) => !placedActors.has(actor.id))
    .flatMap((actor) => {
      const branch = lineageNode(actor, "right", DEFAULT_GAP);
      return branch ? [branch] : [];
    });
  const unplacedApps = apps.filter((app) => !placedApps.has(app.key));
  if (unplacedApps.length > 0) {
    autoChildren.push(appGroup("auto:apps", unplacedApps));
  }
  const removeEmpty = (nodes: SceneNode[]): SceneNode[] => nodes.flatMap<SceneNode>((node) => {
    if (node.kind === "leaf") return [node];
    const children = removeEmpty(node.children);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
  const children: SceneNode[] = hiddenActors.size > 0 || hiddenAppReferences.size > 0 ? removeEmpty(topLevel) : [...topLevel];
  if (autoChildren.length > 0) {
    children.push(children.length > 0
      ? { kind: "group", key: "auto", layout: { type: "stack", axis: "v", gap: DEFAULT_GAP }, frame: { label: UNPLACED_LABEL, outline: false }, children: autoChildren }
      : { kind: "group", key: "auto", layout: { type: "stack", axis: "v", gap: DEFAULT_GAP }, children: autoChildren });
  }

  for (const [handle, actor] of byHandle) {
    if (leaves.has(`actor:${actor.id}`)) entityKeys.set(`@${handle}`, `actor:${actor.id}`);
  }

  const lines = (layout?.lines ?? []).flatMap((line, index): SceneLine[] => {
    if (!showConnections) return [];
    if (hiddenAppReferences.has(line.from) || hiddenAppReferences.has(line.to)) return [];
    if ([line.from, line.to].some((reference) => {
      const entity = canvasEntityOf(reference);
      const actor = entity.kind === "actor" ? byHandle.get(entity.handle) : undefined;
      return actor && hiddenActors.has(actor.id);
    })) return [];
    const fromKey = entityKeys.get(line.from);
    const toKey = entityKeys.get(line.to);
    if (!fromKey || !toKey) {
      notices.push(`Linie ${line.from} nach ${line.to}: ${fromKey ? line.to : line.from} ist nicht auf der Fläche`);
      return [];
    }
    return [{ key: `line:${index}`, fromKey, toKey, label: line.label, arrow: line.arrow, style: line.style }];
  });

  return {
    root: { kind: "group", key: "root", layout: { type: "stack", axis: "v", gap: TOP_LEVEL_GAP }, children },
    leaves,
    lines,
    notices: [...new Set(notices)],
  };
};
