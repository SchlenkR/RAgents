import { useRef, useState } from "react";
import { startEntryDirectly } from "./chat/requests";
import { RunPreparationChat } from "./RunPreparationChat";
import { StartOptionPresetErrors, useStartOptions } from "./StartOptions";
import { DialogBody, DialogDescription, DialogHeader, DialogTitle, StartupNotice, type StartupNoticeState } from "./ui";
import { Modal } from "./ui/modal";
import type { EntryGuideContribution, JsonValue, PluginRegistry, SessionContext, SkillStartEntry, StartEntry } from "./PluginRegistry";

export const templateStarting: StartupNoticeState = { kind: "working", title: "Starting run", detail: "Starting the template." };
const optionsLoading: StartupNoticeState = { kind: "working", title: "Opening template", detail: "Loading the start options." };
const alertClass = "px-4 pb-3 type-body text-destructive [overflow-wrap:anywhere]";

type GuideOutcome =
  | { readonly kind: "start"; readonly value: JsonValue }
  | { readonly kind: "prepare"; readonly entry: SkillStartEntry; readonly prompt: string };

/** What a completed guide leads to: a run script starts with the value, a skill moves on to preparing the task it returned. */
export function guideOutcome(entry: StartEntry, value: JsonValue): GuideOutcome {
  if (entry.action === "script") return { kind: "start", value };
  if (typeof value !== "string" || !value.trim()) throw new Error(`The guide for ${entry.title} must return a non-empty task.`);
  return { kind: "prepare", entry, prompt: value };
}

type Step =
  | { readonly kind: "guide"; readonly starting: boolean; readonly error?: string }
  | Extract<GuideOutcome, { kind: "prepare" }>;

/** A template's guide as the only dialog over the page; X, Escape and the guide's Cancel close it and leave nothing open. */
export function StartEntryDialog({ entry, guide, registry, session, onClose, onStarted }: {
  entry: StartEntry;
  guide: EntryGuideContribution;
  registry: PluginRegistry;
  /** The draft whose accepted send or start opens the run. */
  session: SessionContext;
  onClose: () => void;
  onStarted: () => void;
}) {
  const startOptions = useStartOptions();
  const [step, setStep] = useState<Step>({ kind: "guide", starting: false });
  const [opened, setOpened] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const completing = useRef(false);
  if (!opened && !startOptions.pending && startOptions.presetErrors.length === 0) setOpened(true);

  const complete = (value: JsonValue) => {
    if (completing.current) return;
    const outcome = guideOutcome(entry, value);
    completing.current = true;
    if (outcome.kind === "prepare") {
      setStep(outcome);
      return;
    }
    setStep({ kind: "guide", starting: true });
    void startEntryDirectly(sessionRef.current.session.id, entry, outcome.value).then(onStarted, (cause: unknown) => {
      completing.current = false;
      setStep({ kind: "guide", starting: false, error: cause instanceof Error ? cause.message : String(cause) });
    });
  };

  const starting = step.kind === "guide" && step.starting;
  const notice = starting ? templateStarting : !opened && startOptions.presetErrors.length === 0 ? optionsLoading : undefined;
  return <Modal className="gap-0 p-0" onClose={onClose} scope="page" showCloseButton size="full">
    <DialogHeader className="pt-4 pr-12 pb-3 pl-4">
      <DialogTitle>{step.kind === "prepare" ? "Prepare task" : entry.title}</DialogTitle>
      <DialogDescription>{step.kind === "prepare" ? entry.title : entry.description}</DialogDescription>
    </DialogHeader>
    {step.kind === "guide" && step.error !== undefined && <p className={alertClass} role="alert">The run could not be started: {step.error}</p>}
    <StartOptionPresetErrors className={alertClass} />
    {step.kind === "prepare"
      ? <DialogBody className="overflow-hidden"><RunPreparationChat entry={step.entry} initialPrompt={step.prompt} registry={registry} sessionRef={sessionRef} /></DialogBody>
      : <DialogBody>
        {notice && <div className="grid flex-1 place-items-center p-6"><StartupNotice state={notice} /></div>}
        {opened && <div className={starting ? "hidden" : "contents"} inert={starting}>
          <guide.Guide entry={entry} onCancel={onClose} onComplete={complete} session={session} />
        </div>}
      </DialogBody>}
  </Modal>;
}
