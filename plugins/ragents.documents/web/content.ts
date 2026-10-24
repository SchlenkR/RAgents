import { useCallback, useEffect, useState } from "react";
import { rpc } from "@ragents/web/rpc";
import { workspaceContracts } from "@ragents/plugins/ragents.workspace/contract";
import { DOCUMENTS_ALIAS, documentsContracts } from "../contract";
import type { RunDocument } from "./DocumentViewer";

export type DocumentContent = { text: string } | { blob: Blob };

interface ContentState {
  key: string;
  loaded?: { bytes: Uint8Array; content: DocumentContent };
  pending: boolean;
  error?: string;
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

export const sameBytes = (left: Uint8Array | undefined, right: Uint8Array): boolean =>
  left !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);

export const useDocumentContent = (entry: RunDocument | undefined) => {
  const [state, setState] = useState<ContentState>();
  const [revision, setRevision] = useState(0);
  const [watchError, setWatchError] = useState<string>();
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const url = entry?.content === undefined ? entry?.contentUrl : undefined;
  const key = JSON.stringify([entry?.id, entry?.base?.runId, entry?.format]);
  const format = entry?.format;
  const version = entry?.version;
  const runId = entry?.base?.runId;
  const root = entry?.base?.folder.startsWith("/") ? undefined : entry?.base?.root;

  useEffect(() => {
    if (url === undefined) return;
    setWatchError(undefined);
    const visible = () => { if (document.visibilityState !== "hidden") reload(); };
    const changed = () => { setWatchError(undefined); visible(); };
    const unsubscribe = runId === undefined ? undefined : root === DOCUMENTS_ALIAS
      ? rpc.subscribe(documentsContracts.changed, { runId }, (message) => "error" in message ? setWatchError(message.error) : changed(), setWatchError)
      : root === "" ? rpc.subscribe(workspaceContracts.channels.browse, { runId, root: "workspace" }, changed, setWatchError) : undefined;
    const connected = rpc.onConnected(() => {
      if (rpc.status.kind === "connected") {
        const channel = root === DOCUMENTS_ALIAS ? documentsContracts.changed.id : workspaceContracts.channels.browse.id;
        setWatchError(rpc.status.channelErrors?.find((error) => error.channel === channel)?.message);
      }
      visible();
    });
    const timer = unsubscribe === undefined ? window.setInterval(visible, 30000) : undefined;
    document.addEventListener("visibilitychange", visible);
    return () => {
      unsubscribe?.();
      connected();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [reload, root, runId, url]);

  useEffect(() => {
    if (url === undefined || document.visibilityState === "hidden") return;
    const controller = new AbortController();
    let alive = true;
    setState((current) => ({ ...(current?.key === key ? current : { key }), pending: true, error: undefined }));
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
          throw new Error(typeof body?.error === "string" ? body.error : `Status ${response.status}`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const content = format === "image" || format === "binary"
          ? { blob: new Blob([bytes], { type: response.headers.get("content-type") ?? "application/octet-stream" }) }
          : { text: new TextDecoder().decode(bytes) };
        if (alive) setState((current) => ({
          key,
          loaded: current?.key === key && sameBytes(current.loaded?.bytes, bytes) ? current.loaded : { bytes, content },
          pending: false,
        }));
      })
      .catch((cause: unknown) => {
        if (alive) setState((current) => ({ ...(current?.key === key ? current : { key }), pending: false, error: messageOf(cause) }));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [format, key, revision, url, version]);

  const current = state?.key === key ? state : undefined;
  return {
    content: entry?.content !== undefined ? { text: entry.content } : current?.loaded?.content,
    pending: url !== undefined && (current === undefined || current.pending),
    error: current?.error ?? watchError,
    reload,
  };
};

export const useBlobAddress = (blob: Blob | undefined, image: boolean): { url?: string; error?: string } => {
  const [address, setAddress] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    if (blob === undefined) return;
    let alive = true;
    let published = false;
    const url = URL.createObjectURL(blob);
    const ready = () => {
      if (!alive) return;
      published = true;
      setAddress({ url });
    };
    if (image) {
      const preview = new Image();
      preview.src = url;
      void preview.decode().then(ready, (cause: unknown) => {
        if (alive) setAddress((current) => ({ ...current, error: messageOf(cause) }));
        URL.revokeObjectURL(url);
      });
    } else ready();
    return () => {
      alive = false;
      if (!published) URL.revokeObjectURL(url);
    };
  }, [blob, image]);
  useEffect(() => {
    const url = address.url;
    return () => { if (url !== undefined) URL.revokeObjectURL(url); };
  }, [address.url]);
  return address;
};
