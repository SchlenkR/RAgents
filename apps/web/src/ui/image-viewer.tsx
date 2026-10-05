import { useCallback, useEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { MinusIcon, PlusIcon, XIcon, ZoomInIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { constrainImage, fitImageScale, zoomImage, type ImageSize, type ImageTransform } from "./image-geometry";

export interface ImageViewerProps {
  src: string;
  fileName: string;
  alt?: string;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}

type View = { mode: "fit" } | ({ mode: "zoom" } & ImageTransform);

export function ImageViewer({ src, fileName, alt = fileName, onClose, returnFocus }: ImageViewerProps) {
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; view: ImageTransform; moved: boolean } | null>(null);
  const [viewport, setViewport] = useState<ImageSize>({ width: 1, height: 1 });
  const [image, setImage] = useState<ImageSize>();
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ mode: "fit" });
  const fit = image ? fitImageScale(image, viewport) : 1;
  const transform = image && view.mode === "zoom" ? constrainImage(view, image, viewport) : { scale: fit, x: 0, y: 0 };
  const canPan = !!image && (image.width * transform.scale > viewport.width || image.height * transform.scale > viewport.height);

  useEffect(() => {
    if (!canvas) return;
    const measure = () => setViewport({ width: canvas.clientWidth, height: canvas.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);

  const zoom = useCallback((factor: number, client?: { x: number; y: number }) => {
    if (!image || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const pointer = client ? {
      x: (client.x - bounds.left) * viewport.width / bounds.width - viewport.width / 2,
      y: (client.y - bounds.top) * viewport.height / bounds.height - viewport.height / 2,
    } : { x: 0, y: 0 };
    setView((current) => {
      const previous = current.mode === "fit" ? { scale: fit, x: 0, y: 0 } : constrainImage(current, image, viewport);
      const scale = Math.max(Math.min(fit, 0.1), Math.min(16, previous.scale * factor));
      return { mode: "zoom", ...constrainImage(zoomImage(previous, scale, pointer), image, viewport) };
    });
  }, [canvas, fit, image, viewport]);

  useEffect(() => {
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
      zoom(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), { x: event.clientX, y: event.clientY });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [canvas, zoom, viewport.height]);

  const toggleFit = () => setView((current) => current.mode === "fit" ? { mode: "zoom", scale: 1, x: 0, y: 0 } : { mode: "fit" });

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent
      className="h-[calc(100%-1rem)] w-[calc(100%-1rem)] max-w-none gap-0 rounded-none border border-border bg-background p-0 shadow-none ring-0 data-open:animate-none data-closed:animate-none"
      data-slot="image-viewer"
      finalFocus={returnFocus}
      initialFocus={closeRef}
      onKeyDown={(event) => {
        if (["+", "=", "Add", "-", "_", "Subtract", "0"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "0") setView({ mode: "fit" });
          else zoom(["-", "_", "Subtract"].includes(event.key) ? 1 / 1.25 : 1.25);
        }
      }}
      showCloseButton={false}
      size="full"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <DialogTitle className="min-w-0 flex-1 truncate text-sm" title={fileName}>{fileName}</DialogTitle>
        <span aria-live="polite" className="w-14 text-right text-xs text-muted-foreground tabular-nums">{Math.round(transform.scale * 100)} %</span>
        <Button aria-label="Zoom out" disabled={!image} onClick={() => zoom(1 / 1.25)} size="icon-sm" variant="ghost"><MinusIcon /></Button>
        <Button aria-label="Zoom in" disabled={!image} onClick={() => zoom(1.25)} size="icon-sm" variant="ghost"><PlusIcon /></Button>
        <Button aria-label={view.mode === "fit" ? "Show at 100 %" : "Fit image"} disabled={!image} onClick={toggleFit} size="sm" variant="outline">{view.mode === "fit" ? "100 %" : "Fit"}</Button>
        <Button aria-label="Close image viewer" onClick={onClose} ref={closeRef} size="icon-sm" variant="ghost"><XIcon /></Button>
      </header>
      <DialogDescription className="sr-only">Use the wheel or pinch to zoom, drag to pan, + and - to zoom, 0 to fit, and Escape to close. Double click toggles fit and 100 %.</DialogDescription>
      <div
        aria-label="Image canvas"
        className={cn("relative min-h-0 flex-1 touch-none overflow-hidden bg-canvas select-none", canPan && "cursor-grab active:cursor-grabbing")}
        data-mode={view.mode}
        data-scale={transform.scale}
        onClick={(event) => {
          if (drag.current?.moved) { drag.current = null; return; }
          if (event.target === event.currentTarget) onClose();
        }}
        onDoubleClick={toggleFit}
        onPointerDown={(event) => {
          drag.current = null;
          if (!canPan || event.button !== 0) return;
          drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, view: transform, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId || !image) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - current.startX) * viewport.width / bounds.width;
          const y = (event.clientY - current.startY) * viewport.height / bounds.height;
          current.moved ||= Math.abs(x) + Math.abs(y) > 3;
          setView({ mode: "zoom", ...constrainImage({ ...current.view, x: current.view.x + x, y: current.view.y + y }, image, viewport) });
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        ref={setCanvas}
      >
        {failed ? <p className="p-6 text-destructive" role="alert">Image could not be loaded.</p> : <img
          alt={alt}
          className="absolute top-1/2 left-1/2 max-w-none origin-center"
          draggable={false}
          onError={() => setFailed(true)}
          onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          src={src}
          style={{ width: image?.width, height: image?.height, transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) scale(${transform.scale})` }}
        />}
      </div>
    </DialogContent>
  </Dialog>;
}

export interface ImagePreviewProps extends Omit<ComponentProps<"img">, "src"> {
  src: string;
  fileName: string;
}

export function ImagePreview({ fileName, className, alt = fileName, ...props }: ImagePreviewProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button aria-label={`Open image ${fileName}`} className="group/image relative block max-w-full cursor-zoom-in outline-offset-4" data-slot="image-preview" onClick={() => setOpen(true)} ref={trigger} type="button">
      <img {...props} alt={alt} className={className} />
      <span aria-hidden className="pointer-events-none absolute top-2 right-2 bg-background/90 p-1 text-foreground opacity-0 group-hover/image:opacity-100 group-focus-visible/image:opacity-100"><ZoomInIcon className="size-4" /></span>
    </button>
    {open && <ImageViewer alt={alt} fileName={fileName} onClose={() => setOpen(false)} returnFocus={trigger} src={props.src} />}
  </>;
}
