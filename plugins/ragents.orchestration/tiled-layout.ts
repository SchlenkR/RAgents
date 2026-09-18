import { canvasEntityKey, canvasEntityOf, type CanvasTileNode } from "./contract.js";

export type { CanvasTileNode } from "./contract.js";

export const MAX_CANVAS_TILE_DEPTH = 16;
export const MAX_CANVAS_TILES = 64;

export const canvasTileNodeOf = (input: unknown): CanvasTileNode => {
  const entities = new Set<string>();
  const parse = (value: unknown, where: string, depth: number): CanvasTileNode => {
    if (depth > MAX_CANVAS_TILE_DEPTH) throw new Error(`${where}: höchstens ${MAX_CANVAS_TILE_DEPTH} verschachtelte Teilungen sind erlaubt`);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} muss eine Kachel oder Teilung sein`);
    const node = value as Record<string, unknown>;
    if (Object.hasOwn(node, "entity")) {
      if (Object.keys(node).some((key) => key !== "entity")) throw new Error(`${where}: eine Kachel trägt nur entity; eine Teilung direction, weights und children`);
      if (typeof node.entity !== "string") throw new Error(`${where}.entity muss @handle oder app:<name>/<view> sein`);
      const entity = canvasEntityOf(node.entity);
      if (entity.kind === "shape") throw new Error(`${where}: Kacheln zeigen Actors (@handle) oder Mini-Apps (app:<name>/<view>), keine Formen`);
      const key = canvasEntityKey(entity);
      if (entities.has(key)) throw new Error(`${where}: ${key} ist mehr als einmal als Kachel platziert`);
      entities.add(key);
      if (entities.size > MAX_CANVAS_TILES) throw new Error(`Höchstens ${MAX_CANVAS_TILES} Kacheln sind erlaubt`);
      return { entity: key };
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

export const canvasTileEntities = (root: CanvasTileNode | null | undefined): string[] =>
  !root ? [] : "entity" in root ? [root.entity] : root.children.flatMap(canvasTileEntities);

export const mapCanvasTileEntities = (root: CanvasTileNode, resolve: (entity: string) => string): CanvasTileNode =>
  "entity" in root ? { entity: resolve(root.entity) } : {
    ...root,
    children: [mapCanvasTileEntities(root.children[0], resolve), mapCanvasTileEntities(root.children[1], resolve)],
  };
