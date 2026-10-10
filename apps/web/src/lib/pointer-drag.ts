import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export interface PointerPoint { readonly x: number; readonly y: number }

/** One pointer drag at a time with pointer capture; release finishes with the point, Escape, cancel, and leaving the window finish with null. */
export function usePointerDrag() {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  return (event: ReactPointerEvent<HTMLElement>, move: (point: PointerPoint) => void, finish: (point: PointerPoint | null) => void, captureElement = event.currentTarget) => {
    if (event.button !== 0) return;
    cleanup.current?.();
    if (event.currentTarget.tagName !== "BUTTON") event.preventDefault();
    const element = captureElement;
    const pointerId = event.pointerId;
    element.setPointerCapture(pointerId);
    const onMove = (next: PointerEvent) => { if (next.pointerId === pointerId) move({ x: next.clientX, y: next.clientY }); };
    const clear = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onCancel);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      cleanup.current = undefined;
    };
    const onUp = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      clear();
      finish({ x: next.clientX, y: next.clientY });
    };
    const onCancel = () => { clear(); finish(null); };
    const onKey = (next: KeyboardEvent) => {
      if (next.key !== "Escape") return;
      next.preventDefault();
      next.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onCancel);
    cleanup.current = clear;
  };
}
