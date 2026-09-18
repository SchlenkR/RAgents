import { canvasTileNodeOf } from "./tiled-layout.js";

export const ORCHESTRATION_PLUGIN_ID = "ragents.orchestration";

export const CANVAS_GROUP_KINDS = ["h", "v", "wrap-h", "wrap-v", "grid", "circle", "tree"] as const;
export type CanvasGroupKind = typeof CANVAS_GROUP_KINDS[number];

export const CANVAS_TREE_DIRECTIONS = ["right", "down"] as const;
export type CanvasTreeDirection = typeof CANVAS_TREE_DIRECTIONS[number];

export const CANVAS_SHAPE_KINDS = ["circle", "diamond"] as const;
export type CanvasShapeKind = typeof CANVAS_SHAPE_KINDS[number];

export const CANVAS_ARROWS = ["none", "end", "both"] as const;
export type CanvasArrow = typeof CANVAS_ARROWS[number];

export const CANVAS_LINE_STYLES = ["solid", "dashed"] as const;
export type CanvasLineStyle = typeof CANVAS_LINE_STYLES[number];

/** Default sizes of the shapes in px; a circle is measured by its diameter, a diamond by its width. */
export const CANVAS_SHAPE_DEFAULT_SIZE: Record<CanvasShapeKind, number> = { circle: 120, diamond: 150 };
const DIAMOND_ASPECT = 0.62;

export type CanvasEntity =
  | { kind: "actor"; handle: string }
  | { kind: "shape"; id: string }
  | { kind: "app"; id: string };

type CanvasGroupBase = {
  id: string;
  parent?: string;
  label?: string;
  gap?: number;
  frame: boolean;
};

/** The model sends one flat object per node; internally each group kind carries exactly its own parameters. */
export type CanvasGroupNode =
  | (CanvasGroupBase & { group: "h" | "v" | "circle" })
  | (CanvasGroupBase & { group: "wrap-h"; width: number })
  | (CanvasGroupBase & { group: "wrap-v"; height: number })
  | (CanvasGroupBase & { group: "grid"; columns: number })
  | (CanvasGroupBase & { group: "tree"; root: string; direction: CanvasTreeDirection });

export type CanvasItemNode = {
  entity: string;
  parent?: string;
  chatInput?: boolean;
};

export type CanvasLayoutNode = CanvasGroupNode | CanvasItemNode;

export type CanvasShape = {
  id: string;
  kind: CanvasShapeKind;
  text: string;
  size: number;
};

export type CanvasLine = {
  from: string;
  to: string;
  label?: string;
  arrow: CanvasArrow;
  style: CanvasLineStyle;
};

export type CanvasTileNode =
  | { entity: string }
  | { direction: "horizontal" | "vertical"; weights: [number, number]; children: [CanvasTileNode, CanvasTileNode] };

export type CanvasLayout = {
  mode?: "free" | "tiled";
  root?: CanvasTileNode | null;
  nodes: CanvasLayoutNode[];
  shapes: CanvasShape[];
  lines: CanvasLine[];
};

export const isCanvasGroupNode = (node: CanvasLayoutNode): node is CanvasGroupNode => "group" in node;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isAbsent = (value: unknown) => value === undefined || value === null;

const normalizedHandle = (value: string) => value.trim().replace(/^@/, "").toLowerCase();

export const canvasEntityOf = (text: string): CanvasEntity => {
  const trimmed = text.trim();
  if (trimmed.startsWith("@")) {
    const handle = normalizedHandle(trimmed);
    if (!handle || /\s/.test(handle)) throw new Error(`Entität ${JSON.stringify(text)}: nach dem @ fehlt ein Handle`);
    return { kind: "actor", handle };
  }
  const match = /^(shape|app):(.+)$/s.exec(trimmed);
  if (!match) {
    throw new Error(`Entität ${JSON.stringify(text)}: erwartet @handle, shape:<id> oder app:<id>`);
  }
  const id = match[2].trim();
  if (!id) throw new Error(`Entität ${JSON.stringify(text)}: die ID nach dem Doppelpunkt ist leer`);
  return match[1] === "shape" ? { kind: "shape", id } : { kind: "app", id };
};

export const canvasEntityKey = (entity: CanvasEntity): string =>
  entity.kind === "actor" ? `@${entity.handle}` : `${entity.kind}:${entity.id}`;

export const canvasShapeSize = (shape: CanvasShape): { width: number; height: number } =>
  shape.kind === "circle"
    ? { width: shape.size, height: shape.size }
    : { width: shape.size, height: Math.round(shape.size * DIAMOND_ASPECT) };

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, where: string): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${where}: ${JSON.stringify(value)} ist unbekannt, erlaubt sind ${allowed.join(", ")}`);
  }
  return value as T;
};

const optionalText = (value: unknown, where: string): string | undefined => {
  if (isAbsent(value)) return undefined;
  if (typeof value !== "string") throw new Error(`${where} muss ein Text sein`);
  return value.trim() || undefined;
};

const requiredText = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where} fehlt oder ist leer`);
  return value.trim();
};

const positiveNumber = (value: unknown, where: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${where} muss eine positive Zahl sein`);
  return value;
};

const optionalGap = (value: unknown, where: string): number | undefined => {
  if (isAbsent(value)) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${where} darf nicht negativ sein`);
  return value;
};

const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

const GROUP_PARAMETERS: Record<CanvasGroupKind, readonly string[]> = {
  "h": [],
  "v": [],
  "circle": [],
  "wrap-h": ["width"],
  "wrap-v": ["height"],
  "grid": ["columns"],
  "tree": ["direction", "root"],
};

const groupNodeOf = (value: Record<string, unknown>, index: number): CanvasGroupNode => {
  const where = `nodes[${index}]`;
  const group = oneOf(CANVAS_GROUP_KINDS, value.group, `${where}.group`);
  const id = requiredText(value.id, `${where}.id (jede Gruppe braucht eine ID)`);
  if (!isAbsent(value.entity)) {
    throw new Error(`${where}: Gruppe ${id} darf kein entity tragen; Elemente sind eigene Knoten mit parent ${JSON.stringify(id)}`);
  }
  for (const parameter of ["width", "height", "columns", "direction", "root"]) {
    if (!isAbsent(value[parameter]) && !GROUP_PARAMETERS[group].includes(parameter)) {
      throw new Error(`${where}: Gruppe ${id} (${group}) kennt keinen Parameter ${parameter}`
        + (parameter === "width" ? "; für Umbruch wrap-h nehmen" : parameter === "height" ? "; für Umbruch wrap-v nehmen" : ""));
    }
  }
  if (!isAbsent(value.frame) && typeof value.frame !== "boolean") throw new Error(`${where}.frame muss true oder false sein`);
  const base: CanvasGroupBase = withoutUndefined({
    id,
    parent: optionalText(value.parent, `${where}.parent`),
    label: optionalText(value.label, `${where}.label`),
    gap: optionalGap(value.gap, `${where}.gap`),
    frame: value.frame === true,
  });
  switch (group) {
    case "h":
    case "v":
    case "circle":
      return { ...base, group };
    case "wrap-h":
      return { ...base, group, width: positiveNumber(value.width, `${where}.width (wrap-h braucht die Zeilenbreite)`) };
    case "wrap-v":
      return { ...base, group, height: positiveNumber(value.height, `${where}.height (wrap-v braucht die Spaltenhöhe)`) };
    case "grid": {
      const columns = value.columns;
      if (typeof columns !== "number" || !Number.isInteger(columns) || columns < 1) {
        throw new Error(`${where}.columns (grid braucht eine ganze Spaltenzahl ab 1)`);
      }
      return { ...base, group, columns };
    }
    case "tree": {
      const entity = canvasEntityOf(requiredText(value.root, `${where}.root (tree braucht den @handle des Wurzel-Actors)`));
      if (entity.kind !== "actor") throw new Error(`${where}.root: die Wurzel eines Baums ist ein Actor (@handle)`);
      return {
        ...base,
        group,
        root: canvasEntityKey(entity),
        direction: isAbsent(value.direction) ? "right" : oneOf(CANVAS_TREE_DIRECTIONS, value.direction, `${where}.direction`),
      };
    }
  }
};

const itemNodeOf = (value: Record<string, unknown>, index: number): CanvasItemNode => {
  const where = `nodes[${index}]`;
  if (typeof value.entity !== "string") {
    throw new Error(`${where}: ein Knoten ist entweder eine Gruppe (group + id) oder ein Element (entity)`);
  }
  const entity = canvasEntityOf(value.entity);
  if (value.chatInput !== undefined && (entity.kind !== "actor" || typeof value.chatInput !== "boolean")) {
    throw new Error(`${where}.chatInput ist nur für Actors als Wahrheitswert erlaubt`);
  }
  return withoutUndefined({
    entity: canvasEntityKey(entity),
    parent: optionalText(value.parent, `${where}.parent`),
    chatInput: value.chatInput as boolean | undefined,
  });
};

const shapeOf = (value: unknown, index: number): CanvasShape => {
  const where = `shapes[${index}]`;
  if (!isRecord(value)) throw new Error(`${where} muss ein Objekt sein`);
  const kind = oneOf(CANVAS_SHAPE_KINDS, value.kind, `${where}.kind`);
  return {
    id: requiredText(value.id, `${where}.id`),
    kind,
    text: requiredText(value.text, `${where}.text (jede Form trägt einen Text)`),
    size: isAbsent(value.size) ? CANVAS_SHAPE_DEFAULT_SIZE[kind] : positiveNumber(value.size, `${where}.size`),
  };
};

const lineOf = (value: unknown, index: number): CanvasLine => {
  const where = `lines[${index}]`;
  if (!isRecord(value)) throw new Error(`${where} muss ein Objekt sein`);
  const from = canvasEntityKey(canvasEntityOf(requiredText(value.from, `${where}.from`)));
  const to = canvasEntityKey(canvasEntityOf(requiredText(value.to, `${where}.to`)));
  if (from === to) throw new Error(`${where}: eine Linie führt von einer Entität zu einer ANDEREN, nicht von ${from} zu sich selbst`);
  return withoutUndefined({
    from,
    to,
    label: optionalText(value.label, `${where}.label`),
    arrow: isAbsent(value.arrow) ? "none" : oneOf(CANVAS_ARROWS, value.arrow, `${where}.arrow`),
    style: isAbsent(value.style) ? "solid" : oneOf(CANVAS_LINE_STYLES, value.style, `${where}.style`),
  });
};

const assertNoCycle = (groups: Map<string, CanvasGroupNode>) => {
  for (const start of groups.values()) {
    const seen = new Set<string>([start.id]);
    let current = start;
    while (current.parent) {
      const next = groups.get(current.parent);
      if (!next) throw new Error(`Gruppe ${current.id}: parent ${JSON.stringify(current.parent)} ist keine bekannte Gruppe`);
      if (seen.has(next.id)) throw new Error(`Gruppe ${start.id} liegt über parent in sich selbst`);
      seen.add(next.id);
      current = next;
    }
  }
};

/** Parses and validates a canvas layout; throws a German error naming the first violation. */
export const canvasLayoutOf = (value: unknown): CanvasLayout => {
  if (!isRecord(value)) throw new Error("Das Layout muss ein Objekt mit nodes, shapes und lines sein");
  if (!Array.isArray(value.nodes)) throw new Error("nodes fehlt oder ist keine Liste");
  const rawShapes = value.shapes ?? [];
  const rawLines = value.lines ?? [];
  if (!Array.isArray(rawShapes)) throw new Error("shapes muss eine Liste sein");
  if (!Array.isArray(rawLines)) throw new Error("lines muss eine Liste sein");

  const nodes = value.nodes.map((entry, index): CanvasLayoutNode => {
    if (!isRecord(entry)) throw new Error(`nodes[${index}] muss ein Objekt sein`);
    if (!isAbsent(entry.group) && entry.chatInput !== undefined) throw new Error(`nodes[${index}].chatInput ist nur für Actors erlaubt`);
    return isAbsent(entry.group) ? itemNodeOf(entry, index) : groupNodeOf(entry, index);
  });
  const shapes = rawShapes.map(shapeOf);
  const lines = rawLines.map(lineOf);

  const groups = new Map<string, CanvasGroupNode>();
  for (const node of nodes.filter(isCanvasGroupNode)) {
    if (groups.has(node.id)) throw new Error(`Gruppen-ID ${JSON.stringify(node.id)} kommt mehrfach vor`);
    groups.set(node.id, node);
  }
  assertNoCycle(groups);
  for (const node of nodes) {
    if (!node.parent) continue;
    const parent = groups.get(node.parent);
    if (!parent) throw new Error(`parent ${JSON.stringify(node.parent)} ist keine bekannte Gruppe`);
    if (parent.group === "tree") {
      throw new Error(`Gruppe ${parent.id} ist ein Baum und füllt sich aus der Abstammung von ${parent.root}; sie nimmt keine eigenen Kinder auf`);
    }
  }

  const shapeIds = new Set<string>();
  for (const shape of shapes) {
    if (shapeIds.has(shape.id)) throw new Error(`Form-ID ${JSON.stringify(shape.id)} kommt mehrfach vor`);
    shapeIds.add(shape.id);
  }
  const placed = new Set<string>();
  for (const node of nodes) {
    if (isCanvasGroupNode(node)) continue;
    if (placed.has(node.entity)) throw new Error(`${node.entity} ist mehr als einmal platziert`);
    placed.add(node.entity);
  }
  const assertKnownShape = (reference: string, where: string) => {
    const entity = canvasEntityOf(reference);
    if (entity.kind === "shape" && !shapeIds.has(entity.id)) {
      throw new Error(`${where}: Form ${JSON.stringify(entity.id)} ist nicht in shapes definiert`);
    }
  };
  for (const reference of placed) assertKnownShape(reference, "nodes");
  for (const shape of shapes) {
    if (!placed.has(`shape:${shape.id}`)) throw new Error(`Form ${JSON.stringify(shape.id)} ist nirgends platziert; jede Form braucht einen Knoten mit entity shape:${shape.id}`);
  }
  lines.forEach((line, index) => {
    assertKnownShape(line.from, `lines[${index}].from`);
    assertKnownShape(line.to, `lines[${index}].to`);
  });

  const mode = value.mode === undefined ? undefined : oneOf(["free", "tiled"] as const, value.mode, "mode");
  const root = value.root === undefined ? undefined : value.root === null ? null : canvasTileNodeOf(value.root);
  return withoutUndefined({ nodes, shapes, lines, mode, root });
};
