import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ZoomInIcon } from "lucide-react";
import { ImageViewer } from "./image-viewer";

const ImageGroupContext = createContext(false);

const fileNameOf = (image: HTMLImageElement): string => {
  const download = image.closest<HTMLAnchorElement>("a[download]")?.download;
  if (download) return download;
  if (/^(data|blob):/.test(image.src)) return image.alt || "Image";
  const name = new URL(image.src).pathname.split("/").at(-1);
  if (!name) return image.alt || "Image";
  try { return decodeURIComponent(name); }
  catch { return name; }
};

export function ImagePreviewGroup({ children }: { children: ReactNode }) {
  const nested = useContext(ImageGroupContext);
  return nested ? children : <ImageGroupContext value><ImageGroup>{children}</ImageGroup></ImageGroupContext>;
}

function ImageGroup({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [opened, setOpened] = useState<{ src: string; alt: string; fileName: string }>();
  const [hint, setHint] = useState<{ x: number; y: number }>();

  useEffect(() => {
    const element = root.current!;
    const originals = new Map<HTMLElement, { role: string | null; label: string | null; title: string | null; tabIndex: string | null }>();
    const images = () => [...element.querySelectorAll<HTMLImageElement>("img")].filter((image) => !image.closest('[data-slot="image-preview"], [data-slot="image-viewer"]'));
    const enhance = () => {
      for (const image of images()) {
        const trigger = image.closest<HTMLAnchorElement>("a") ?? image;
        if (!originals.has(trigger)) originals.set(trigger, { role: trigger.getAttribute("role"), label: trigger.getAttribute("aria-label"), title: trigger.getAttribute("title"), tabIndex: trigger.getAttribute("tabindex") });
        trigger.setAttribute("role", "button");
        trigger.setAttribute("aria-label", `Open image ${fileNameOf(image)}`);
        trigger.title = "Click to zoom";
        trigger.tabIndex = 0;
      }
    };
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "alt"] });
    return () => {
      observer.disconnect();
      for (const [image, original] of originals) {
        for (const [attribute, value] of [["role", original.role], ["aria-label", original.label], ["title", original.title], ["tabindex", original.tabIndex]] as const) {
          if (value === null) image.removeAttribute(attribute);
          else image.setAttribute(attribute, value);
        }
      }
    };
  }, []);

  const imageOf = (target: EventTarget | null): HTMLImageElement | undefined => {
    if (!(target instanceof Element) || target.closest('[data-slot="image-preview"], [data-slot="image-viewer"]')) return;
    return target instanceof HTMLImageElement ? target : target.closest("a")?.querySelector("img") ?? undefined;
  };
  const open = (image: HTMLImageElement) => {
    returnFocus.current = image.closest<HTMLAnchorElement>("a") ?? image;
    setHint(undefined);
    setOpened({ src: image.currentSrc || image.src, alt: image.alt, fileName: fileNameOf(image) });
  };
  return <>
    <div
      className="contents [&_img]:cursor-zoom-in"
      onClickCapture={(event) => {
        const image = imageOf(event.target);
        if (!image) return;
        event.preventDefault();
        event.stopPropagation();
        open(image);
      }}
      onKeyDownCapture={(event) => {
        const image = imageOf(event.target);
        if (!image || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        event.stopPropagation();
        open(image);
      }}
      onPointerOver={(event) => {
        const image = imageOf(event.target);
        if (!image) return;
        const bounds = image.getBoundingClientRect();
        setHint({ x: bounds.right - 28, y: bounds.top + 6 });
      }}
      onPointerOut={() => setHint(undefined)}
      onFocusCapture={(event) => {
        const image = imageOf(event.target);
        if (!image) return;
        const bounds = image.getBoundingClientRect();
        setHint({ x: bounds.right - 28, y: bounds.top + 6 });
      }}
      onBlurCapture={() => setHint(undefined)}
      ref={root}
    >{children}</div>
    {hint && createPortal(<span aria-hidden className="pointer-events-none fixed z-[110] bg-background/90 p-1 text-foreground" style={{ left: hint.x, top: hint.y }}><ZoomInIcon className="size-4" /></span>, document.body)}
    {opened && <ImageViewer {...opened} onClose={() => setOpened(undefined)} returnFocus={returnFocus} />}
  </>;
}
