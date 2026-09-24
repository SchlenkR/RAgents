import { surfaceEntityKey, surfaceEntityOf, type SurfaceTileNode } from "./contract.js";

export type { SurfaceTileNode } from "./contract.js";

export const MAX_SURFACE_TILE_DEPTH = 16;
export const MAX_SURFACE_TILES = 64;

export const surfaceTileNodeOf = (input: unknown): SurfaceTileNode => {
  const entities = new Set<string>();
  const parse = (value: unknown, where: string, depth: number): SurfaceTileNode => {
    if (depth > MAX_SURFACE_TILE_DEPTH) throw new Error(`${where}: höchstens ${MAX_SURFACE_TILE_DEPTH} verschachtelte Teilungen sind erlaubt`);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} muss eine Kachel oder Teilung sein`);
    const node = value as Record<string, unknown>;
    if (Object.hasOwn(node, "entity")) {
      if (Object.keys(node).some((key) => key !== "entity" && key !== "chatInput")) throw new Error(`${where}: eine Kachel trägt nur entity und chatInput; eine Teilung direction, weights und children`);
      if (typeof node.entity !== "string") throw new Error(`${where}.entity muss @handle oder app:<name>/<view> sein`);
      const entity = surfaceEntityOf(node.entity);
      const key = surfaceEntityKey(entity);
      if (node.chatInput !== undefined && (entity.kind !== "actor" || typeof node.chatInput !== "boolean")) {
        throw new Error(`${where}.chatInput ist nur für Actors als Wahrheitswert erlaubt`);
      }
      if (entities.has(key)) throw new Error(`${where}: ${key} ist mehr als einmal als Kachel platziert`);
      entities.add(key);
      if (entities.size > MAX_SURFACE_TILES) throw new Error(`Höchstens ${MAX_SURFACE_TILES} Kacheln sind erlaubt`);
      return node.chatInput === undefined ? { entity: key } : { entity: key, chatInput: node.chatInput as boolean };
    }
    if (Object.keys(node).some((key) => !["direction", "weights", "children"].includes(key))) throw new Error(`${where}: eine Teilung trägt nur direction, weights und children`);
    if (node.direction !== "horizontal" && node.direction !== "vertical") throw new Error(`${where}.direction muss horizontal oder vertical sein`);
    if (!Array.isArray(node.weights) || node.weights.length !== 2 || node.weights.some((weight) => typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0)) {
      throw new Error(`${where}.weights muss genau zwei endliche positive Zahlen enthalten`);
    }
    if (!Array.isArray(node.children) || node.children.length !== 2) throw new Error(`${where}.children muss genau zwei Kacheln oder Teilungen enthalten`);
    return {
      direction: node.direction,
      weights: [node.weights[0], node.weights[1]],
      children: [parse(node.children[0], `${where}.children[0]`, depth + 1), parse(node.children[1], `${where}.children[1]`, depth + 1)],
    };
  };
  return parse(input, "root", 0);
};

/** A tile hides the chat composer of its actor only when its leaf says chatInput: false. */
export const surfaceTileChatInput = (root: SurfaceTileNode | null | undefined, entity: string): boolean =>
  !root ? true : "entity" in root
    ? root.entity !== entity || root.chatInput !== false
    : surfaceTileChatInput(root.children[0], entity) && surfaceTileChatInput(root.children[1], entity);

export const surfaceTileEntities = (root: SurfaceTileNode | null | undefined): string[] =>
  !root ? [] : "entity" in root ? [root.entity] : root.children.flatMap(surfaceTileEntities);

export const mapSurfaceTileEntities = (root: SurfaceTileNode, resolve: (entity: string) => string): SurfaceTileNode =>
  "entity" in root ? { ...root, entity: resolve(root.entity) } : {
    ...root,
    children: [mapSurfaceTileEntities(root.children[0], resolve), mapSurfaceTileEntities(root.children[1], resolve)],
  };
