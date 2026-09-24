import { useEffect, useRef, useState } from "react";

export function useChatAction() {
  const pending = useRef(false);
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (status !== "done") return;
    const timer = window.setTimeout(() => setStatus("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [status]);
  const invoke = async (action: () => void | Promise<void>, failureLabel: string) => {
    if (pending.current) return;
    pending.current = true;
    setError(undefined);
    setStatus("pending");
    try {
      await action();
      setStatus("done");
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure);
      setError(`${failureLabel}: ${detail}`);
      setStatus("idle");
    } finally {
      pending.current = false;
    }
  };
  return { status, error, invoke };
}

export async function copyChatText(text: string, unavailable: string) {
  if (!navigator.clipboard) throw new Error(unavailable);
  await navigator.clipboard.writeText(text);
}
