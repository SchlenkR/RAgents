import type { CanvasCamera } from "./canvas-layout-storage";

const DURATION = 300;

export interface CanvasNavigationBox { id: string; left: number; top: number; right: number; bottom: number }

export const nextCanvasElement = (
  elements: readonly CanvasNavigationBox[],
  origin: Omit<CanvasNavigationBox, "id">,
  key: string,
  currentId?: string,
): CanvasNavigationBox | undefined => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return undefined;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const x = (origin.left + origin.right) / 2;
  const y = (origin.top + origin.bottom) / 2;
  return elements.filter((box) => box.id !== currentId).map((box) => {
    const dx = (box.left + box.right) / 2 - x;
    const dy = (box.top + box.bottom) / 2 - y;
    const forward = (horizontal ? dx : dy) * direction;
    const across = horizontal ? dy : dx;
    const aligned = horizontal ? box.bottom >= origin.top && box.top <= origin.bottom
      : box.right >= origin.left && box.left <= origin.right;
    return { box, forward, aligned, distance: Math.hypot(forward, across * 2) };
  }).filter((entry) => entry.forward > 1)
    .sort((a, b) => Number(b.aligned) - Number(a.aligned) || a.distance - b.distance || a.box.id.localeCompare(b.box.id))[0]?.box;
};

export const createKeyboardNavigation = (read: () => CanvasCamera, apply: (camera: CanvasCamera) => void) => {
  let frame: number | undefined;
  let startedAt = -Infinity;
  const cancel = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const moveTo = (to: CanvasCamera, repeat: boolean, reducedMotion: boolean): boolean => {
    const now = performance.now();
    if (repeat && (frame !== undefined || now - startedAt < DURATION)) return false;
    const from = read();
    cancel();
    startedAt = now;
    if (reducedMotion) { apply(to); return true; }
    const step = (time: number) => {
      const progress = Math.min(1, Math.max(0, (time - startedAt) / DURATION));
      const eased = progress * progress * (3 - 2 * progress);
      apply({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased, zoom: from.zoom });
      if (progress < 1) frame = requestAnimationFrame(step);
      else frame = undefined;
    };
    frame = requestAnimationFrame(step);
    return true;
  };
  return { moveTo, cancel };
};
