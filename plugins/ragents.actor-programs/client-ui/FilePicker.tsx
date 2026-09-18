import React, { useEffect, useId, useRef, useState } from "react";
import { SourceCode } from "../../../apps/web/src/SourceCode";
import { Button, cn, Label, useFileInput } from "../../../apps/web/src/ui";
import type { FilePickerProps } from "./file-contracts";
import { fileSelection } from "./file-selection";

function FilePreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<{ file: File; url?: string; text?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    if (/^(image|video|audio)\//.test(file.type)) {
      const url = URL.createObjectURL(file);
      setPreview({ file, url });
      return () => { URL.revokeObjectURL(url); };
    }
    if (/^(text\/|application\/(json|xml)$)/.test(file.type) || /\.(txt|md|csv|json|xml|log)$/i.test(file.name)) {
      void file.slice(0, 100_000).text().then((text) => {
        if (active) setPreview({ file, text: text + (file.size > 100_000 ? "\nVorschau auf 100.000 Bytes gekürzt." : "") });
      }).catch((cause: unknown) => {
        if (active) setPreview({ file, error: cause instanceof Error ? cause.message : String(cause) });
      });
    }
    return () => { active = false; };
  }, [file]);
  if (preview?.file !== file) return null;
  if (preview.error) return <p className="text-sm text-destructive" role="alert">Vorschau fehlgeschlagen: {preview.error}</p>;
  if (preview.text !== undefined) return <div className="mt-3 max-h-56 overflow-auto rounded-md bg-muted"><SourceCode content={preview.text} path={file.name} /></div>;
  if (!preview.url) return null;
  if (file.type.startsWith("image/")) return <img alt={file.name} className="mt-3 block max-h-56 max-w-full rounded-md" src={preview.url} />;
  if (file.type.startsWith("video/")) return <video aria-label={file.name} className="mt-3 block max-h-56 max-w-full rounded-md" controls preload="metadata" src={preview.url} />;
  return <audio aria-label={file.name} className="mt-3 max-w-full" controls preload="metadata" src={preview.url} />;
}

export function FilePicker({ label, files, onChange, disabled, showPreview = true, ...options }: FilePickerProps) {
  const id = useId();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const blocked = disabled || pending;
  const change = async (next: () => File[]) => {
    if (disabled || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try { await onChange(next()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busy.current = false; setPending(false); }
  };
  const add = (incoming: File[]) => change(() => fileSelection(files, incoming, options));
  const fileInput = useFileInput({ disabled: blocked, onFiles: add });
  return <section aria-busy={pending} aria-label={label} className="min-w-0 text-sm">
    <div className={cn("grid gap-1.5 rounded-lg border border-dashed bg-muted/40 p-3", fileInput.dragging && "border-primary bg-background")} {...fileInput.dropProps}>
      <Label htmlFor={id}>{label}</Label>
      <input accept={options.accept} className="max-w-full min-w-0 text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-sm" disabled={blocked} id={id} multiple={options.multiple !== false} type="file" {...fileInput.inputProps} />
      <p className="text-xs text-muted-foreground">Dateien auswählen, hier hineinziehen oder bei fokussierter Dateiauswahl einfügen.</p>
      {options.accept && <p className="text-xs text-muted-foreground">Erlaubt: {options.accept}</p>}
    </div>
    {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
    {files.length > 0 && <ul className="mt-2 divide-y">{files.map((file, index) => <li className="py-2" key={`${file.name}:${file.size}:${file.lastModified}:${index}`}>
      <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words"><strong>{file.name}</strong> <small className="block text-muted-foreground">{new Intl.NumberFormat("de-DE").format(file.size)} Bytes</small></span>
        <Button aria-label={`${file.name} entfernen`} disabled={blocked} onClick={() => { void change(() => files.filter((_, position) => position !== index)); }} size="sm" variant="outline">Entfernen</Button></div>
      {showPreview && <FilePreview file={file} />}
    </li>)}</ul>}
  </section>;
}
