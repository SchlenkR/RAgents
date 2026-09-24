import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";

export function useFileInput({ disabled, onFiles, onPasteText }: {
  disabled?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  onPasteText?: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const receive = (files: File[]) => { if (files.length) void onFiles(files); };

  return {
    inputRef,
    dragging,
    clearDragging: () => setDragging(false),
    inputProps: {
      ref: inputRef,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        receive(files);
      },
    },
    dropProps: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        setDragging(!disabled);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(false);
        receive(Array.from(event.dataTransfer.files));
      },
      onPaste: (event: ClipboardEvent<HTMLElement>) => {
        const files = Array.from(event.clipboardData.files);
        if (!files.length) return;
        event.preventDefault();
        receive(files);
        const text = event.clipboardData.getData("text/plain");
        if (text) onPasteText?.(text);
      },
    },
  };
}
