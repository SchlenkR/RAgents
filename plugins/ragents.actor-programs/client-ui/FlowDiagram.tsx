import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { cn } from "../../../apps/web/src/ui";
import type { Edge, Node } from "@xyflow/react";
import type { ElkNode } from "elkjs/lib/elk-api";
import type { FlowDiagramProps } from "./flow-diagram-contracts";

type CardItem = NonNullable<FlowDiagramProps["nodes"][number]["items"]>[number] & { labelLines: string; detailLines?: string };
export interface GraphBounds { x: number; y: number; width: number; height: number }
type CardData = FlowDiagramProps["nodes"][number] & { labelLines: string; detailLines?: string; itemLines: CardItem[]; direction: "right" | "down"; detailLevel: "full" | "summary"; onAction?: FlowDiagramProps["onAction"] };
export type CardNode = Node<CardData, "card">;
type EdgeStatus = NonNullable<FlowDiagramProps["edges"][number]["status"]>;
export type RouteEdge = Edge<{ path: string; x: number; y: number; rotated?: boolean; labelWidth?: number; status?: EdgeStatus }, "route">;
export type Link = FlowDiagramProps["edges"][number] & { id: string };
export interface Placement { nodes: CardNode[]; edges: RouteEdge[]; bounds: GraphBounds }
interface Layout { key: string; nodes: CardNode[]; edges: RouteEdge[]; bounds?: GraphBounds; error?: string }
interface Point { x: number; y: number }

function textMeasure(): (text: string) => number {
  const canvas = typeof document === "undefined" ? undefined : document.createElement("canvas").getContext("2d");
  if (canvas) canvas.font = `600 16px ${getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif"}`;
  return text => canvas ? canvas.measureText(text).width : text.length * 10;
}

function wrap(text: string, width = 204): string {
  const textWidth = textMeasure();
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next) <= width) { line = next; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const character of word) {
        if (line && textWidth(line + character) > width) { lines.push(line); line = character; }
        else line += character;
      }
    }
    lines.push(line);
    return lines;
  }).join("\n");
}

function summarize(text: string, width: number, count: number): string {
  const lines = wrap(text, width).split("\n");
  if (lines.length <= count) return lines.join("\n");
  const textWidth = textMeasure();
  let last = lines[count - 1]!;
  while (last && textWidth(last + "...") > width) last = last.slice(0, -1);
  return [...lines.slice(0, count - 1), last.trimEnd() + "..."].join("\n");
}

const edgeStatuses = ["pending", "active", "done", "blocked"];

function prepare({ nodes, edges, direction = "right", height = 360, viewport = "interactive", detailLevel = "summary", layout = "layered" }: FlowDiagramProps) {
  if (viewport !== "interactive" && viewport !== "fit-width" && viewport !== "fit") throw new Error("Unbekannter Diagrammansichtsmodus.");
  if (!Number.isFinite(height) || height <= 0) throw new Error("Die Diagrammhöhe muss positiv sein.");
  if (direction !== "right" && direction !== "down") throw new Error("Unbekannte Diagrammrichtung.");
  if (detailLevel !== "full" && detailLevel !== "summary") throw new Error("Unbekannte Diagrammdetailstufe.");
  if (layout !== "layered" && layout !== "star") throw new Error("Unbekannte Diagrammanordnung.");
  const summary = detailLevel === "summary";
  const textWidth = textMeasure();
  const ids = new Set<string>();
  const cards = nodes.map((node): CardNode => {
    if (typeof node.id !== "string" || !node.id.trim() || ids.has(node.id)) throw new Error("Knoten benötigen eindeutige, nicht leere IDs.");
    ids.add(node.id);
    if (typeof node.label !== "string" || (node.detail !== undefined && typeof node.detail !== "string")) throw new Error("Knotenbeschriftungen müssen Text sein.");
    if (node.status !== undefined && !["pending", "active", "done", "blocked"].includes(node.status)) throw new Error("Unbekannter Knotenstatus.");
    if (node.running !== undefined && typeof node.running !== "boolean") throw new Error("Knotenaktivität muss ein Wahrheitswert sein.");
    if (node.kind !== undefined && !["actor", "agent", "service"].includes(node.kind)) throw new Error("Unbekannte Knotenart.");
    const labelLines = summary ? summarize(node.label, 284, 2) : wrap(node.label);
    const detailLines = summary || node.detail === undefined ? undefined : wrap(node.detail);
    if (node.items !== undefined && !Array.isArray(node.items)) throw new Error("Knotenpunkte müssen eine Liste sein.");
    const itemLines = (node.items ?? []).map((item) => {
      if (typeof item.label !== "string" || (item.detail !== undefined && typeof item.detail !== "string")) throw new Error("Punktbeschriftungen müssen Text sein.");
      if (item.status !== undefined && !["pending", "active", "done", "blocked", "skipped"].includes(item.status)) throw new Error("Unbekannter Punktstatus.");
      return { ...item, labelLines: wrap(item.label, summary ? 256 : 176), detailLines: summary || item.detail === undefined ? undefined : wrap(item.detail) };
    });
    if (node.actions !== undefined && !Array.isArray(node.actions)) throw new Error("Knotenaktionen müssen eine Liste sein.");
    const actionIds = new Set<string>();
    for (const action of node.actions ?? []) {
      if (typeof action.id !== "string" || !action.id.trim() || actionIds.has(action.id)) throw new Error("Aktionen benötigen eindeutige, nicht leere IDs.");
      actionIds.add(action.id);
      if (typeof action.label !== "string") throw new Error("Aktionsbeschriftungen müssen Text sein.");
    }
    const itemsHeight = summary ? itemLines.reduce((height, item) => height + 12 + item.labelLines.split("\n").length * 24, 0) : itemLines.reduce((height, item) => height + 24 + item.labelLines.split("\n").length * 24 + 24 + (item.detailLines === undefined ? 0 : item.detailLines.split("\n").length * 24), 0);
    const actionsHeight = node.actions?.length ? 49 : 0;
    const height = itemsHeight + actionsHeight + (summary ? 50 : 60) + labelLines.split("\n").length * 24 + (detailLines === undefined ? 0 : 24 + detailLines.split("\n").length * 24);
    return { id: node.id, type: "card", position: { x: 0, y: 0 }, width: summary ? 320 : 240, height, data: { ...node, labelLines, detailLines, itemLines, direction, detailLevel } };
  });
  const edgeIds = new Set<string>();
  const links = edges.map((edge, index): Link => {
    const id = edge.id ?? `flow-edge-${index}`;
    if (typeof id !== "string" || !id.trim() || edgeIds.has(id)) throw new Error("Verbindungen benötigen eindeutige, nicht leere IDs.");
    edgeIds.add(id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error("Eine Verbindung verweist auf einen fehlenden Knoten.");
    if (edge.kind !== undefined && edge.kind !== "return") throw new Error("Unbekannte Verbindungsart.");
    if (edge.status !== undefined && !edgeStatuses.includes(edge.status)) throw new Error("Unbekannter Verbindungsstatus.");
    if (edge.label !== undefined && typeof edge.label !== "string") throw new Error("Verbindungsbeschriftungen müssen Text sein.");
    return { ...edge, id };
  });
  const key = JSON.stringify([layout, direction, cards.map(({ id, width, height }) => [id, width, height]), links.map(({ id, source, target, label, kind }) => [id, source, target, kind, label === undefined ? 0 : Math.ceil(textWidth(label))])]);
  return { key, cards, links, direction, layout };
}

function bounds(points: Point[]): GraphBounds {
  const x = Math.min(...points.map(point => point.x)) - 16;
  const y = Math.min(...points.map(point => point.y)) - 16;
  return { x, y, width: Math.max(...points.map(point => point.x)) + 16 - x, height: Math.max(...points.map(point => point.y)) + 16 - y };
}

const corners = (nodes: CardNode[]): Point[] => nodes.flatMap(node => [{ x: node.position.x, y: node.position.y }, { x: node.position.x + node.width!, y: node.position.y + node.height! }]);

export function starLayout(cards: CardNode[], links: Link[]): Placement {
  const [hub, ...rest] = cards;
  const gap = 24;
  const rightCount = Math.ceil(rest.length / 2);
  const columns = [{ side: 1, cards: rest.slice(0, rightCount) }, { side: -1, cards: rest.slice(rightCount) }];
  const rows = new Map<string, { side: number; relativeY: number }>();
  const placed = columns.flatMap(({ side, cards: column }) => {
    const total = column.reduce((sum, card) => sum + card.height!, 0) + gap * (column.length - 1);
    let top = -total / 2;
    return column.map((card, index) => {
      const relativeY = column.length < 2 ? 0 : index * 2 / (column.length - 1) - 1;
      const distance = hub!.width! / 2 + 120 + card.width! / 2;
      const y = top + card.height! / 2;
      top += card.height! + gap;
      rows.set(card.id, { side, relativeY });
      return { ...card, position: { x: side * distance - card.width! / 2, y: y - card.height! / 2 } };
    });
  });
  const nodes = [{ ...hub!, position: { x: -hub!.width! / 2, y: -hub!.height! / 2 } }, ...placed];
  const center = (node: CardNode): Point => ({ x: node.position.x + node.width! / 2, y: node.position.y + node.height! / 2 });
  const pairs = new Map<string, Link[]>();
  for (const link of links) {
    const pair = [link.source, link.target].sort().join("\n");
    pairs.set(pair, [...(pairs.get(pair) ?? []), link]);
  }
  const edges = links.map((link): RouteEdge => {
    const siblings = pairs.get([link.source, link.target].sort().join("\n"))!;
    const offset = (siblings.indexOf(link) - (siblings.length - 1) / 2) * 16;
    const source = nodes.find(node => node.id === link.source)!;
    const target = nodes.find(node => node.id === link.target)!;
    const spoke = source.id === hub!.id ? target : target.id === hub!.id ? source : undefined;
    const data = { status: link.status, labelWidth: link.label ? Math.ceil(textMeasure()(link.label)) : 0 };
    if (!spoke) {
      const start = center(source);
      const end = center(target);
      return { ...link, type: "route", data: { ...data, path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
    }
    const { side, relativeY } = rows.get(spoke.id)!;
    const hubPort = { x: side * hub!.width! / 2, y: relativeY * (hub!.height! / 2 - 24) + offset };
    const spokePort = { x: center(spoke).x - side * spoke.width! / 2, y: center(spoke).y + offset };
    const [start, end] = source.id === hub!.id ? [hubPort, spokePort] : [spokePort, hubPort];
    const reach = side * Math.abs(end.x - start.x) / 2 * (source.id === hub!.id ? 1 : -1);
    const path = `M ${start.x} ${start.y} C ${start.x + reach} ${start.y} ${end.x - reach} ${end.y} ${end.x} ${end.y}`;
    return { ...link, type: "route", data: { ...data, path, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  });
  return { nodes, edges, bounds: bounds(corners(nodes)) };
}

async function layeredLayout(cards: CardNode[], links: Link[], direction: "right" | "down"): Promise<Placement> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const result: ElkNode = await new ELK().layout({
    id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": direction === "right" ? "RIGHT" : "DOWN", "elk.edgeRouting": "ORTHOGONAL", "elk.spacing.nodeNode": "52", "elk.layered.spacing.nodeNodeBetweenLayers": "94" },
    children: cards.map(({ id, width, height }) => ({ id, width, height })),
    edges: links.filter(edge => edge.kind !== "return").map(({ id, source, target, label }) => ({ id, sources: [source], targets: [target], ...(label ? { labels: [{ text: label, width: Math.max(40, Math.ceil(textMeasure()(label))), height: 24 }] } : {}) })),
  });
  const nodes = cards.map((card, index) => ({ ...card, position: { x: result.children![index]!.x!, y: result.children![index]!.y! } }));
  const extraPoints: Point[] = [];
  let lane = Math.max(...nodes.map(node => node.position.x + node.width!)) + 48;
  const edges: RouteEdge[] = links.map((edge) => {
    if (edge.kind === "return") {
      const source = nodes.find(node => node.id === edge.source)!;
      const target = nodes.find(node => node.id === edge.target)!;
      const start = { x: source.position.x + source.width!, y: source.position.y + source.height! * (edge.source === edge.target ? 2 / 3 : 1 / 2) };
      const end = { x: target.position.x + target.width!, y: target.position.y + target.height! * (edge.source === edge.target ? 1 / 3 : 1 / 2) };
      const labelWidth = edge.label ? Math.ceil(textMeasure()(edge.label)) : 0;
      const x = lane;
      const y = (start.y + end.y) / 2;
      const path = `M ${start.x} ${start.y} L ${lane} ${start.y} L ${lane} ${end.y} L ${end.x} ${end.y}`;
      extraPoints.push(start, end, { x: lane, y: start.y }, { x: lane, y: end.y }, { x: lane + 16, y: y + labelWidth / 2 + 8 }, { x: lane - 16, y: y - labelWidth / 2 - 8 });
      lane += 32;
      return { ...edge, type: "route", data: { path, x, y, rotated: true, labelWidth, status: edge.status } };
    }
    const route = result.edges!.find(route => route.id === edge.id)!;
    if (!route.sections?.length) throw new Error("Für eine Verbindung fehlt die automatische Linienführung.");
    const path = route.sections.map((section) => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")).join(" ");
    const section = route.sections[0]!;
    const label = route.labels?.[0];
    return { ...edge, type: "route", data: { path, status: edge.status, x: label?.x === undefined ? (section.startPoint.x + section.endPoint.x) / 2 : label.x + (label.width ?? 0) / 2, y: label?.y === undefined ? (section.startPoint.y + section.endPoint.y) / 2 : label.y + (label.height ?? 0) / 2 } };
  });
  const points = [...corners(nodes), ...extraPoints];
  for (const edge of result.edges ?? []) {
    for (const section of edge.sections ?? []) points.push(section.startPoint, ...(section.bendPoints ?? []), section.endPoint);
    for (const label of edge.labels ?? []) {
      if (label.x !== undefined && label.y !== undefined) points.push({ x: label.x - 8, y: label.y - 8 }, { x: label.x + (label.width ?? 0) + 8, y: label.y + (label.height ?? 0) + 8 });
    }
  }
  return { nodes, edges, bounds: bounds(points) };
}

const FlowDiagramRenderer = lazy(() => import("./FlowDiagramRenderer"));

const flowSurface = "w-full min-w-0 overflow-hidden bg-transparent text-[16px]/[1.5] text-foreground [&>p]:p-4 [&_[role=alert]]:text-destructive data-[viewport=fit-width]:flex-none data-[viewport=fit]:h-full data-[viewport=fit]:min-h-0 data-[viewport=fit]:flex-auto";

export function FlowDiagram(props: FlowDiagramProps) {
  const inputKey = JSON.stringify([props.nodes, props.edges, props.direction, props.height, props.viewport, props.detailLevel, props.layout]);
  const prepared = useMemo(() => {
    try { return { graph: prepare(props) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [inputKey]);
  const graph = prepared.graph;
  const [layout, setLayout] = useState<Layout>();
  const key = graph?.key;
  useEffect(() => {
    if (!graph || graph.cards.length === 0) return;
    let current = true;
    void (async () => {
      const placement = graph.layout === "star" ? starLayout(graph.cards, graph.links) : await layeredLayout(graph.cards, graph.links, graph.direction);
      if (current) setLayout({ key: graph.key, ...placement });
    })().catch((error: unknown) => { if (current) setLayout({ key: graph.key, nodes: [], edges: [], error: error instanceof Error ? error.message : String(error) }); });
    return () => { current = false; };
  }, [key]);
  const active = layout?.key === key ? layout : undefined;
  const error = prepared.error ?? active?.error;
  const cards = active?.nodes.map((node, index) => ({ ...node, data: { ...graph!.cards[index]!.data, onAction: props.onAction } })) ?? [];
  const viewport = props.viewport ?? "interactive";
  return <section aria-label={props.label} className={cn(flowSurface, props.className)} data-viewport={viewport} style={{ height: viewport !== "interactive" ? undefined : Number.isFinite(props.height) && props.height! > 0 ? props.height : 360 }}>
    {error ? <p role="alert">Das Diagramm konnte nicht angezeigt werden: {error}</p>
      : graph?.cards.length === 0 ? <p role="status">Keine Knoten vorhanden.</p>
        : !active ? <p role="status">Diagramm wird geladen ...</p>
          : <Suspense fallback={<p role="status">Diagramm wird geladen ...</p>}><FlowDiagramRenderer key={key} mode={viewport} bounds={active.bounds!} nodes={cards} edges={active.edges.map((edge, index) => ({ ...edge, label: graph!.links[index]!.label, data: { ...edge.data!, status: graph!.links[index]!.status } }))} /></Suspense>}
  </section>;
}
