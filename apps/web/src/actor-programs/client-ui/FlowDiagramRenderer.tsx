import React, { useEffect, useRef, useState } from "react";
import { BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, type EdgeProps, type NodeProps } from "@xyflow/react";
import { Button, cn } from "../../ui";
import type { CardNode, GraphBounds, RouteEdge } from "./FlowDiagram";

const statusLabels = { pending: "Pending", active: "Active", done: "Done", blocked: "Blocked", skipped: "Skipped" };
const edgeColors = { pending: "var(--muted-foreground)", active: "var(--info)", done: "var(--success)", blocked: "var(--destructive)" };
const edgeClasses = {
  pending: "[--xy-edge-stroke:var(--muted-foreground)] [stroke-dasharray:4_6]",
  active: "[--xy-edge-stroke:var(--info)] [stroke-dasharray:9_5] animate-edge-flow motion-reduce:animate-none",
  done: "[--xy-edge-stroke:var(--success)]",
  blocked: "[--xy-edge-stroke:var(--destructive)]",
};
const statusIconClass = "size-[18px] flex-none text-muted-foreground data-[status=active]:text-info data-[status=done]:text-success data-[status=blocked]:text-destructive in-data-[running=true]:data-[status=active]:animate-spin in-data-[running=true]:data-[status=active]:[animation-duration:1.3s] in-data-[running=true]:data-[status=active]:motion-reduce:animate-none";
const cardStatusTones = "[--flow-status:var(--muted-foreground)] data-[status=active]:[--flow-status:var(--info)] data-[status=done]:[--flow-status:var(--success)] data-[status=blocked]:[--flow-status:var(--destructive)]";

function StatusIcon({ status, className }: { status: keyof typeof statusLabels; className?: string }) {
  return <svg className={cn(statusIconClass, className)} data-status={status} role="img" aria-label={statusLabels[status]} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {status === "pending" ? <circle cx="10" cy="10" r="7" />
      : status === "done" ? <path d="M4 10 L8 14 L16 5" />
        : status === "active" ? <path d="M10 3 A7 7 0 1 1 3 10" />
          : status === "blocked" ? <><circle cx="10" cy="10" r="7" /><path d="M10 6 V10 M10 14 H10.01" /></>
            : <path d="M4 10 H16" />}
  </svg>;
}

function Card({ data }: NodeProps<CardNode>) {
  return <div className={cn(cardStatusTones, "pointer-events-auto h-full overflow-hidden rounded-[12px] border border-[color-mix(in_srgb,var(--flow-status)_60%,var(--border))] bg-card text-[16px]/[24px] shadow-[0_3px_9px_#49384e20] data-[running=true]:animate-ring-pulse data-[running=true]:motion-reduce:animate-none")}
    data-status={data.status ?? "pending"} data-kind={data.kind} data-detail-level={data.detailLevel} data-running={data.status === "active" && data.running === true}>
    <Handle type="target" position={data.direction === "right" ? Position.Left : Position.Top} />
    <div className="relative rounded-t-[11px] bg-[color-mix(in_srgb,var(--flow-status)_12%,var(--card))] px-[17px] py-[15px] in-data-[detail-level=summary]:py-[10px]">
      <h3 className="font-semibold whitespace-pre" title={[data.label, statusLabels[data.status ?? "pending"], data.detail].filter(Boolean).join("\n")}>{data.labelLines}</h3>
      <span className="mt-[4px] flex h-[24px] w-max items-center gap-[7px] rounded-[12px] bg-[color-mix(in_srgb,var(--flow-status)_23%,var(--card))] px-[7px] font-semibold text-[var(--flow-status)]"><StatusIcon status={data.status ?? "pending"} />{statusLabels[data.status ?? "pending"]}</span>
    </div>
    {data.detailLines !== undefined && <div className="border-t border-border px-[17px] pt-[11px] pb-[12px] whitespace-pre">{data.detailLines}</div>}
    {data.itemLines.length > 0 && <ul>{data.itemLines.map((item, index) => <li className="group border-t border-border px-[17px] pt-[11px] pb-[12px] whitespace-pre in-data-[detail-level=summary]:pt-[5px] in-data-[detail-level=summary]:pb-[6px]"
      key={index} data-status={item.status ?? "pending"} title={[item.label, statusLabels[item.status ?? "pending"], item.detail].filter(Boolean).join("\n")}>
      <div className="flex items-start gap-[10px] font-semibold in-data-[detail-level=summary]:font-normal"><StatusIcon className="mt-[3px]" status={item.status ?? "pending"} /><span>{item.labelLines}</span></div>
      {data.detailLevel !== "summary" && <div className="text-muted-foreground group-data-[status=active]:text-info group-data-[status=done]:text-success group-data-[status=blocked]:text-destructive">{statusLabels[item.status ?? "pending"]}</div>}
      {item.detailLines !== undefined && <div>{item.detailLines}</div>}
    </li>)}</ul>}
    {data.actions !== undefined && data.actions.length > 0 && <div className="nodrag nopan flex flex-wrap gap-2 border-t border-border px-[17px] py-[10px]">{data.actions.map((action) =>
      <Button key={action.id} disabled={action.disabled} onClick={() => data.onAction?.(data.id, action.id)} size="sm" variant={action.primary ? "default" : "outline"}>{action.label}</Button>)}</div>}
    <Handle type="source" position={data.direction === "right" ? Position.Right : Position.Bottom} />
  </div>;
}
function Route({ id, data, label, markerEnd }: EdgeProps<RouteEdge>) {
  if (!data) return null;
  return <><BaseEdge className={data.status ? edgeClasses[data.status] : undefined} data-status={data.status} id={id} path={data.path} markerEnd={markerEnd} label={data.rotated ? undefined : label} labelX={data.x} labelY={data.y} />
    {data.rotated && label && <g data-kind="return" transform={`translate(${data.x} ${data.y}) rotate(-90)`}>
      <rect className="fill-background" x={-(data.labelWidth ?? 0) / 2 - 4} y={-12} width={(data.labelWidth ?? 0) + 8} height={24} rx={4} />
      <text className="fill-foreground text-[16px]" textAnchor="middle" dominantBaseline="central">{label}</text>
    </g>}
  </>;

}
const nodeTypes = { card: Card };
const edgeTypes = { route: Route };
const diagramScale = 0.8;

export default function FlowDiagramRenderer({ nodes, edges, bounds, mode }: { nodes: CardNode[]; edges: RouteEdge[]; bounds: GraphBounds; mode: "interactive" | "fit-width" | "fit" }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const fitted = mode !== "interactive";
  useEffect(() => {
    if (!fitted || !host.current) return;
    const element = host.current;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [fitted]);
  const zoom = size.width > 0 ? Math.min(diagramScale, size.width / bounds.width, mode === "fit" ? size.height / bounds.height : Infinity) : diagramScale;
  const offsetX = Math.max(0, size.width - bounds.width * zoom) / 2;
  const offsetY = mode === "fit" ? Math.max(0, size.height - bounds.height * zoom) / 2 : 0;
  return <div ref={host} className="w-full min-w-0" style={{ height: mode === "fit-width" ? Math.ceil(bounds.height * zoom) : "100%" }}><ReactFlow
    viewport={fitted ? { x: offsetX - bounds.x * zoom, y: offsetY - bounds.y * zoom, zoom } : undefined}
    zoomOnScroll={!fitted} zoomOnPinch={!fitted} zoomOnDoubleClick={!fitted} panOnDrag={!fitted} panOnScroll={false}
    preventScrolling={!fitted} disableKeyboardA11y={fitted} autoPanOnNodeFocus={false}
    zoomActivationKeyCode={fitted ? null : "Meta"} panActivationKeyCode={fitted ? null : "Space"}
 ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "Zoom in", "controls.zoomOut.ariaLabel": "Zoom out", "controls.fitView.ariaLabel": "Fit view" }} nodes={nodes} edges={edges.map(edge => ({ ...edge, markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[edge.data?.status ?? "pending"] } }))} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false} fitView={!fitted} fitViewOptions={{ minZoom: diagramScale, maxZoom: diagramScale, padding: 0.15 }} minZoom={fitted ? zoom : 0.3} maxZoom={fitted ? zoom : 2} proOptions={{ hideAttribution: true }}>
    {!fitted && <Controls showInteractive={false} fitViewOptions={{ minZoom: diagramScale, maxZoom: diagramScale }} />}
  </ReactFlow></div>;
}
