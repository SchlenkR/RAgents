import { memo, useId, useLayoutEffect, useRef, useState } from "react";
import { MATERIAL_DEPTH_PER_STEP } from "@aicontainer/web/material-settings";
import { cn } from "@aicontainer/web/ui";

export type MaterialSurface = "agent" | "primary" | "script" | "app";

/** Schichtwerk: matte Front, gerade Kanten, die Tiefe kommt aus MaterialBody. */
const materialBaseClass = "relative isolate rounded-panel border-[1.5px] border-(--material-edge) bg-(--material-face) [box-shadow:var(--material-extrusion)] [--material-edge:#514657] dark:[--material-edge:#b7a8bd]";

const materialSurfaceClass: Readonly<Record<MaterialSurface, string>> = {
  agent: "[--material-face:var(--color-glass-agent)] [--material-tone:19] [--material-saturation:37%] [--material-lightness:62%] dark:[--material-lightness:27%]",
  primary: "[--material-face:var(--color-glass-primary)] [--material-tone:275] [--material-saturation:23%] [--material-lightness:64%] dark:[--material-lightness:26%]",
  script: "[--material-face:var(--color-glass-script)] [--material-tone:45] [--material-saturation:40%] [--material-lightness:57%] dark:[--material-lightness:24%]",
  app: "[--material-face:var(--color-glass-app)] [--material-tone:212] [--material-saturation:18%] [--material-lightness:70%] dark:[--material-lightness:25%]",
};

export const materialCardClass = (surface: MaterialSurface, className?: string) =>
  cn(materialBaseClass, materialSurfaceClass[surface], className);

/** Kopfzeile einer Materialkarte: dieselbe Front, eine Spur dunkler, oben gerundet. */
export const materialHeadClass = "relative flex items-center gap-2 rounded-t-[15.5px] bg-[color-mix(in_srgb,var(--material-face)_96%,black)] px-3 py-2";

export const materialTitleClass = "min-w-0 truncate p-0 text-[17px] font-[730] leading-[1.3] tracking-[-.5px]";

export const materialIconClass = "grid size-8 flex-none place-items-center rounded-[11px] border border-[#5146578a] bg-white/9 text-foreground shadow-glass-icon";

export const materialRuleClass = "border-[#51465738]";

export function materialExtrusion(steps: number): string {
  if (steps === 0) return "none";
  const depth = steps * MATERIAL_DEPTH_PER_STEP;
  const layers: string[] = [];
  for (let i = .5; i <= depth; i += .5) {
    const band = Math.floor((i - .5) / MATERIAL_DEPTH_PER_STEP);
    layers.push(`${i * .5}px ${-i * .7}px 0 hsl(var(--material-tone) var(--material-saturation) calc(var(--material-lightness) - ${8 - band * 3}%))`);
  }
  return layers.join(",");
}

function outlineOf(width: number, height: number, dx: number, dy: number): string {
  const radius = Math.min(17, (width - 1) / 2, (height - 1) / 2);
  const points = [[radius, radius], [radius + dx, radius + dy], [width - radius + dx, radius + dy],
    [width - radius + dx, height - radius + dy], [width - radius, height - radius], [radius, height - radius]];
  const normals = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const x = next[0]! - point[0]!, y = next[1]! - point[1]!, length = Math.hypot(x, y);
    return [y / length, -x / length];
  });
  return points.map((point, index) => {
    const before = normals[(index + points.length - 1) % points.length]!, after = normals[index]!;
    const start = [point[0]! + radius * before[0]!, point[1]! + radius * before[1]!];
    const end = [point[0]! + radius * after[0]!, point[1]! + radius * after[1]!];
    return `${index ? "L" : "M"}${start.join(" ")}A${radius} ${radius} 0 0 1 ${end.join(" ")}`;
  }).join("") + "Z";
}

const depthClass = "pointer-events-none absolute -top-[1.5px] -left-[1.5px] z-2 h-[calc(100%+3px)] w-[calc(100%+3px)] flex-none overflow-visible";

export const MaterialBody = memo(function MaterialBody({ steps }: { steps: number }) {
  const depth = steps * MATERIAL_DEPTH_PER_STEP;
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const id = useId().replaceAll(":", "");
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    parent.style.setProperty("--material-extrusion", materialExtrusion(steps));
    return () => { parent.style.removeProperty("--material-extrusion"); };
  }, [steps]);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || steps === 0) return;
    const measure = () => setSize((previous) => {
      const width = parent.offsetWidth, height = parent.offsetHeight;
      return width === previous.width && height === previous.height ? previous : { width, height };
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [steps]);
  const { width, height } = size, dx = depth * .5, dy = -depth * .7;
  if (steps === 0 || width < 2 || height < 2) return <svg aria-hidden="true" className={depthClass} ref={ref} />;
  const outline = outlineOf(width, height, dx, dy), length = Math.hypot(dx, dy);
  const normalX = -dy / length, normalY = dx / length, radius = Math.min(17, (width - 1) / 2, (height - 1) / 2);
  const centerX = width - radius + radius / Math.sqrt(2), centerY = radius - radius / Math.sqrt(2);
  return <svg aria-hidden="true" className={depthClass} ref={ref} viewBox={`0 0 ${width} ${height}`}>
    <defs>
      <mask id={`${id}-face`} maskUnits="userSpaceOnUse" x={-3} y={dy - 3} width={width + dx + 6} height={height - dy + 6}>
        <rect x={-3} y={dy - 3} width={width + dx + 6} height={height - dy + 6} fill="white" stroke="none" />
        <rect width={width} height={height} rx={radius} fill="black" stroke="black" strokeWidth={1} />
      </mask>
      <linearGradient id={`${id}-corner`} gradientUnits="userSpaceOnUse"
        x1={centerX - normalX * 24} y1={centerY - normalY * 24} x2={centerX + normalX * 24} y2={centerY + normalY * 24}>
        {[[0, 0], [.15, 0], [.15, .12], [.35, .12], [.35, .28], [.65, .28], [.65, .12], [.85, .12], [.85, 0], [1, 0]]
          .map(([offset, opacity], index) => <stop key={index} offset={offset} stopColor="black" stopOpacity={opacity} />)}
      </linearGradient>
    </defs>
    <g mask={`url(#${id}-face)`}>
      <path d={outline} fill={`url(#${id}-corner)`} stroke="none" />
      <path d={outline} fill="none" stroke="var(--material-edge)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </g>
  </svg>;
});
