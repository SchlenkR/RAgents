import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "cn";
import type { RunPreparationMessage } from "../../server/src/run-preparation-contract";
import { Button } from "./ui";
import { ChatInputToolbar, type ChatInputHandle, ChatMessages, ChatPanel, type ChatAttachmentInput, type Message } from "quassel";
import { useAttachmentCapabilities } from "./chat/useAttachmentCapabilities";
import type { PluginRegistry, SessionContext, SkillStartEntry } from "./PluginRegistry";
import { ChatViewSwitches, useChatViewSettings } from "./chat-view-settings";
import { StartOptionControls, conflictingStartOptions, useStartOptions } from "./StartOptions";
import { discussRun, preparedRunInput } from "./run-preparation";

const composerPlacement = "flex min-h-0 min-w-0 flex-1 *:flex-1 max-md:[&_[data-chat=composer]]:px-2 max-md:[&_[data-chat=composer]]:pb-2";
/** Without a conversation the composer sits in the middle; a flat window puts it back at the bottom. */
const emptyComposerPlacement = "[&_[data-chat=composer]]:top-1/2 [&_[data-chat=composer]]:bottom-auto [&_[data-chat=composer]]:-translate-y-1/2 [@media(max-height:600px)]:[&_[data-chat=composer]]:top-auto [@media(max-height:600px)]:[&_[data-chat=composer]]:bottom-0 [@media(max-height:600px)]:[&_[data-chat=composer]]:translate-y-0";

type PreparationEntry = { message: RunPreparationMessage; at: string };

const entryNow = (message: RunPreparationMessage): PreparationEntry => ({ message, at: new Date().toISOString() });

/** The task of a skill template is shaped here; the run starts through the template and with what it fixes. */
export function RunPreparationChat({ initialPrompt, entry, registry, sessionRef }: {
  initialPrompt: string;
  entry: SkillStartEntry;
  registry: PluginRegistry;
  sessionRef: RefObject<SessionContext>;
}) {
  const skillName = entry.skill;
  const fixed = entry.fixedStartOptions;
  const [history, setHistory] = useState<PreparationEntry[]>([]);
  const [pendingEntry, setPendingEntry] = useState<PreparationEntry>();
  const [operation, setOperation] = useState<"preparing" | "starting">();
  const [draft, setDraft] = useState(initialPrompt);
  const [hasAttachments, setHasAttachments] = useState(false);
  const composer = useRef<ChatInputHandle>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const chatView = useChatViewSettings(sessionRef.current.session.id, "preparation", "coordinator");
  const options = useStartOptions();
  const sessionId = sessionRef.current.session.id;
  const attachments = useAttachmentCapabilities(sessionId, "primary", JSON.stringify(options.options.map(({ id, value }) => [id, value])));
  useEffect(() => {
    mounted.current = true;
    composer.current?.focus();
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);

  const discuss = async (text: string, files?: ChatAttachmentInput[]) => {
    if (submitting.current) throw new Error("The previous request is still running.");
    submitting.current = true;
    const controller = new AbortController();
    active.current = controller;
    const question = entryNow({ role: "user", text, ...(files?.length ? { attachments: files } : {}) });
    const next = [...history, question];
    setOperation("preparing");
    setPendingEntry(question);
    try {
      const answer = await discussRun(sessionId, next.map(({ message }) => message), controller.signal, skillName);
      if (!mounted.current || controller.signal.aborted) return;
      if (answer.kind === "start") {
        setOperation("starting");
        await sessionRef.current.send(answer.input.text, answer.input.attachments, entry.id);
      } else {
        setHistory([...next, entryNow({ role: "assistant", text: answer.text })]);
      }
    } catch (cause) {
      if (controller.signal.aborted) throw new Error("Discussion stopped. Your input is kept.");
      throw cause;
    } finally {
      active.current = null;
      submitting.current = false;
      if (mounted.current) { setOperation(undefined); setPendingEntry(undefined); }
    }
  };
  const createRun = async (text: string, files?: ChatAttachmentInput[]) => {
    if (submitting.current) throw new Error("The previous request is still running.");
    submitting.current = true;
    setOperation("starting");
    try {
      const input = preparedRunInput(history.map(({ message }) => message), text, files, skillName);
      await sessionRef.current.send(input.text, input.attachments, entry.id);
    } finally {
      submitting.current = false;
      if (mounted.current) setOperation(undefined);
    }
  };
  const messages: Message[] = [...history, ...(pendingEntry ? [pendingEntry] : [])].map(({ message, at }, index) => ({
    key: `preparation-${index}`, role: message.role, text: message.text, closed: true, at,
    attachments: message.attachments?.map((file) => ({ name: file.name, mediaType: file.mediaType,
      size: Math.floor(file.data.length * 3 / 4) - (file.data.endsWith("==") ? 2 : file.data.endsWith("=") ? 1 : 0),
      url: `data:${file.mediaType};base64,${file.data}` })),
  }));
  const busy = operation !== undefined || options.pending;
  const conflicts = conflictingStartOptions(options.options, fixed ?? {});
  const adoptTemplate = async () => {
    for (const option of conflicts) await options.set(option.id, fixed?.[option.id]);
  };

  return <section aria-label="Discuss task" className={cn(composerPlacement, messages.length === 0 && emptyComposerPlacement)} data-preparation={messages.length === 0 ? "empty" : "active"}>
    <ChatPanel composer={<div>
      <ChatInputToolbar {...attachments} disabled={operation === "starting"} sendDisabled={busy}
        initialValue={initialPrompt} onDraftChange={setDraft} onAttachmentsChange={setHasAttachments} handleRef={composer}
        rows={3} maxRows={8} running={operation === "preparing"} onStop={() => active.current?.abort()} onSend={discuss}
        texts={{ placeholder: "Additions or questions about the task ...", send: "Discuss task", stop: "Stop discussion" }}
        toolbarLeft={<ChatViewSwitches settings={chatView} />}
        toolbarRight={<StartOptionControls disabled={busy} fixed={fixed} placement="composer" registry={registry} />} />
      {conflicts.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5" data-start-option-conflicts="" role="alert">
        <span className="text-[0.75rem] text-destructive">Before the template was opened, {conflicts.length === 1 ? "one start option was" : `${conflicts.length} start options were`} set differently than the template requires. The run cannot be created like this.</span>
        <Button disabled={busy} size="sm" variant="outline" onClick={() => { void adoptTemplate(); }}>Apply template values</Button>
      </div>}
      <div className="my-3 flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[0.75rem] text-muted-foreground">Give your go in the chat to start, or choose "Create run".</span>
        <Button disabled={busy || conflicts.length > 0 || (!history.length && !draft.trim() && !hasAttachments)}
          onClick={() => { void composer.current?.submit(createRun, { allowEmpty: history.length > 0 }); }}>
          {operation === "starting" ? "Creating run ..." : "Create run"}
        </Button>
      </div>
      <div aria-label="Start options" className="flex flex-wrap items-center gap-x-3 gap-y-2 empty:hidden"><StartOptionControls disabled={busy} fixed={fixed} registry={registry} /></div>
    </div>}>
      {messages.length > 0 && <ChatMessages detailMode={chatView.detailMode} messages={messages} running={operation === "preparing"} showTimestamps={chatView.showTimestamps} stepsExpandable={chatView.stepsExpandable} />}
    </ChatPanel>
  </section>;
}
