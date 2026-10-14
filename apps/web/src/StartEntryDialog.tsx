import { useRef, useState } from "react";
import type { ScriptParameters } from "../../server/src/plugin-support/actor-programs/script-parameters";
import { startEntryDirectly } from "./chat/requests";
import { ParameterForm } from "./ParameterForm";
import { RunPreparationChat } from "./RunPreparationChat";
import { StartOptionPresetErrors, useStartOptions } from "./StartOptions";
import { DialogBody, DialogDescription, DialogHeader, DialogTitle, StartupNotice, type StartupNoticeState } from "./ui";
import { Modal } from "./ui/modal";
import type { EntryGuideContribution, JsonValue, PluginRegistry, SessionContext, SkillStartEntry, StartEntry } from "./PluginRegistry";

export const templateStarting: StartupNoticeState = { kind: "working", title: "Starting run", detail: "Starting the template." };
const optionsLoading: StartupNoticeState = { kind: "working", title: "Opening template", detail: "Loading the start options." };
const alertClass = "px-4 pb-3 type-body text-destructive [overflow-wrap:anywhere]";

type GuideOutcome =
  | { readonly kind: "start"; readonly parameters: Readonly<Record<string, JsonValue>> }
  | { readonly kind: "prepare"; readonly entry: SkillStartEntry; readonly prompt: string };

/** What a completed guide leads to: a run script starts with the parameters, a skill moves on to preparing the task it returned. */
export function guideOutcome(entry: StartEntry, value: JsonValue): GuideOutcome {
  if (entry.action === "script") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`The guide for ${entry.title} must return the parameters of the script as an object.`);
    return { kind: "start", parameters: value };
  }
  if (typeof value !== "string" || !value.trim()) throw new Error(`The guide for ${entry.title} must return a non-empty task.`);
  return { kind: "prepare", entry, prompt: value };
}

/** What the dialog asks first: the template's guide, or for a run script without one a form of the parameters it declares. */
export type StartPrompt =
  | { readonly kind: "guide"; readonly guide: EntryGuideContribution }
  | { readonly kind: "form"; readonly parameters: ScriptParameters };

type Step =
  | { readonly kind: "ask"; readonly starting: boolean; readonly error?: string }
  | Extract<GuideOutcome, { kind: "prepare" }>;

/** A template's guide or parameter form as the only dialog over the page; X, Escape and its Cancel close it and leave nothing open. */
export function StartEntryDialog({ entry, prompt, registry, session, onClose, onStarted }: {
  entry: StartEntry;
  prompt: StartPrompt;
  registry: PluginRegistry;
  /** The draft whose accepted send or start opens the run. */
  session: SessionContext;
  onClose: () => void;
  onStarted: () => void;
}) {
  const startOptions = useStartOptions();
  const [step, setStep] = useState<Step>({ kind: "ask", starting: false });
  const [opened, setOpened] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const completing = useRef(false);
  if (!opened && !startOptions.pending && startOptions.presetErrors.length === 0) setOpened(true);

  const startScript = (parameters: Readonly<Record<string, unknown>>) => {
    if (completing.current) return;
    completing.current = true;
    setStep({ kind: "ask", starting: true });
    void startEntryDirectly(sessionRef.current.session.id, entry, parameters).then(onStarted, (cause: unknown) => {
      completing.current = false;
      setStep({ kind: "ask", starting: false, error: cause instanceof Error ? cause.message : String(cause) });
    });
  };
  const complete = (value: JsonValue) => {
    if (completing.current) return;
    const outcome = guideOutcome(entry, value);
    if (outcome.kind === "start") startScript(outcome.parameters);
    else {
      completing.current = true;
      setStep(outcome);
    }
  };

  const starting = step.kind === "ask" && step.starting;
  const notice = starting ? templateStarting : !opened && startOptions.presetErrors.length === 0 ? optionsLoading : undefined;
  return <Modal className="gap-0 p-0" onClose={onClose} scope="page" showCloseButton size="full">
    <DialogHeader className="pt-4 pr-12 pb-3 pl-4">
      <DialogTitle>{step.kind === "prepare" ? "Prepare task" : entry.title}</DialogTitle>
      <DialogDescription>{step.kind === "prepare" ? entry.title : entry.description}</DialogDescription>
    </DialogHeader>
    {step.kind === "ask" && step.error !== undefined && <p className={alertClass} role="alert">The run could not be started: {step.error}</p>}
    <StartOptionPresetErrors className={alertClass} />
    {step.kind === "prepare"
      ? <DialogBody className="overflow-hidden"><RunPreparationChat entry={step.entry} initialPrompt={step.prompt} registry={registry} sessionRef={sessionRef} /></DialogBody>
      : <DialogBody>
        {notice && <div className="grid flex-1 place-items-center p-6"><StartupNotice state={notice} /></div>}
        {opened && <div className={starting ? "hidden" : "contents"} inert={starting}>
          {prompt.kind === "guide"
            ? <prompt.guide.Guide entry={entry} onCancel={onClose} onComplete={complete} session={session} />
            : <div className="mx-auto w-full max-w-[820px] p-6 max-sm:p-4"><ParameterForm onCancel={onClose} onSubmit={startScript} parameters={prompt.parameters} /></div>}
        </div>}
      </DialogBody>}
  </Modal>;
}
