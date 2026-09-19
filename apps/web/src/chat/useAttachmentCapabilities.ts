import { useEffect, useState } from "react";
import { coreContracts } from "@aicontainer/server/api/contracts";
import type { ChatAttachmentCapabilities } from "../../../server/src/chat-events";
import { rpc } from "../rpc";
import type { RpcClient } from "../rpc/client";

export async function getAttachmentCapabilities(runId: string, actor = "primary", signal?: AbortSignal, client: RpcClient = rpc): Promise<ChatAttachmentCapabilities> {
  const result = await client.call(coreContracts.chat.capabilities, { runId, actor }, { signal });
  if (typeof result.model !== "string" || !Array.isArray(result.input) || !result.input.every((entry) => typeof entry === "string")) {
    throw new Error("Ungültige Angaben zur Unterstützung für Anhänge");
  }
  return { model: result.model, input: result.input };
}

export function useAttachmentCapabilities(runId: string, actor = "primary", revision = "") {
  const [active, setActive] = useState(false);
  const key = JSON.stringify([runId, actor, revision]);
  const [result, setResult] = useState<{ key: string; capabilities?: ChatAttachmentCapabilities; error?: string }>();
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void getAttachmentCapabilities(runId, actor, controller.signal).then(
      (capabilities) => setResult({ key, capabilities }),
      (cause: unknown) => {
        if (!controller.signal.aborted) setResult({ key, error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
    return () => controller.abort();
  }, [active, actor, key, runId]);
  return {
    attachmentCapabilities: result?.key === key ? result.capabilities : undefined,
    attachmentCapabilitiesError: result?.key === key ? result.error : active ? "Anhänge werden geprüft ..." : undefined,
    onAttachmentsChange: setActive,
  };
}
