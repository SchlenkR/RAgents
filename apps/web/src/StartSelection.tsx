import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useModalController, type ModalController } from "./ui/modal-controller";
import { useStartOptions } from "./StartOptions";
import { useAccess } from "./AccessContext";
import { canStartEntry } from "../../../packages/ragents/src/access";
import { startEntryDirectly } from "./chat/requests";
import { RunPreparationChat } from "./RunPreparationChat";
import { StartSection, StartTiles, startTileCount } from "./StartTiles";
import type { ConnectionEntry } from "./panel/contract";
import type { JsonValue, PluginRegistry, SessionContext, StartEntry } from "./PluginRegistry";

const tileOf = (entry: StartEntry, guided: boolean, technical: boolean): ConnectionEntry => ({
  id: entry.id,
  title: entry.title,
  description: entry.description,
  kind: entry.action,
  category: entry.category ?? (technical ? "Run scripts" : "Workflows"),
  ...(guided ? { guided: true } : {}),
});

/** The start selection of a draft: the same tiles as Start in VS Code; New chat opens the empty run, a template starts right away or after its guide. */
export function StartSelection({ registry, session, initialEntryId, onOpen }: {
  registry: PluginRegistry;
  session: SessionContext;
  initialEntryId?: string;
  /** The draft becomes the open run, as an empty chat or after a template starts. */
  onOpen: () => void;
}) {
  const access = useAccess();
  const modal = useModalController();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const launching = useRef(false);
  const openedInitialEntry = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const startOptions = useStartOptions();
  const disabled = pending || startOptions.pending;
  const technical = access.can("runs.inspect");
  const free = access.can("runs.create");
  const entries = registry.startEntries.filter((entry) => canStartEntry(access, entry.id) && (entry.action === "script" || free));
  const tiles = entries.map((entry) => tileOf(entry, registry.guideFor(entry) !== undefined, technical));
  const defaultEntry = entries.some((entry) => entry.id === registry.defaultStartEntry) ? registry.defaultStartEntry : undefined;

  const launch = useCallback(async (entry: StartEntry, value: JsonValue | null) => {
    if (launching.current || !canStartEntry(access, entry.id)) return;
    launching.current = true;
    setPending(true);
    setError(undefined);
    try {
      await startEntryDirectly(sessionRef.current.session.id, entry, value);
      onOpen();
    } catch (cause) {
      setError(`${entry.title}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      launching.current = false;
      setPending(false);
    }
  }, [access, onOpen]);

  const open = useCallback((entryId: string) => {
    const entry = registry.startEntries.find((candidate) => candidate.id === entryId);
    if (!entry || !canStartEntry(access, entry.id)) {
      setError("This template is not available in the current profile.");
      return;
    }
    openStartEntry(entry, registry, modal, sessionRef, launch);
  }, [access, launch, modal, registry]);

  useEffect(() => {
    if (!initialEntryId || disabled || openedInitialEntry.current) return;
    openedInitialEntry.current = true;
    open(initialEntryId);
  }, [disabled, initialEntryId, open]);

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-10 pt-6 pb-5 max-md:px-3 max-md:pt-11 max-md:pb-4">
    <section aria-label="Start selection" className="mx-auto grid w-full max-w-composer grid-cols-1 gap-1.5">
      <StartSection count={startTileCount(tiles, defaultEntry, free)} title="New" />
      {error && <p className="text-[0.8rem] text-destructive" role="alert">{error}</p>}
      {tiles.length === 0 && !free
        ? <p className="text-[0.75rem] text-muted-foreground" role="status">No template is shared with this user account.</p>
        : <StartTiles defaultEntry={defaultEntry} disabled={disabled} entries={tiles} label="Templates" onNewChat={free ? onOpen : undefined} onStart={open} />}
    </section>
  </div>;
}

/** Opens a template: its guide asks first, a skill with a guide then moves to the preparation chat, everything else starts right away. */
export function openStartEntry(entry: StartEntry, registry: PluginRegistry, modal: ModalController,
  sessionRef: RefObject<SessionContext>, launch: (entry: StartEntry, value: JsonValue | null) => Promise<void>) {
  const guide = registry.guideFor(entry);
  if (!guide) { void launch(entry, null); return; }
  let completed = false;
  modal.open({ title: entry.title, subtitle: entry.description,
    render: (controller) => <guide.Guide entry={entry} session={sessionRef.current}
      onCancel={controller.back} onComplete={(value) => {
        if (completed) return;
        if (entry.action === "script") {
          completed = true;
          controller.back();
          void launch(entry, value);
          return;
        }
        if (typeof value !== "string" || !value.trim()) throw new Error(`The guide for ${entry.title} must return a non-empty task.`);
        const prompt = value;
        completed = true;
        controller.back();
        modal.open({ title: "Prepare task", subtitle: entry.title,
          render: () => <RunPreparationChat entry={entry} initialPrompt={prompt} registry={registry} sessionRef={sessionRef} /> });
      }} />,
  });
}
