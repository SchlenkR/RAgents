import { useAccess } from "./AccessContext";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { getStartOptions, setStartOption } from "./api";
import {
  choicePresentationFrom,
  type StartOptionState,
} from "../../server/src/plugin-support/start-options-contract";
import { ChoiceSelect } from "./ui";
import type { PluginRegistry, SessionContext, StartOptionControlContext } from "./PluginRegistry";
import { modelDefaultsChangedEvent } from "./model-settings-events";
import { useOfferedMachines, type OfferedMachines } from "./offered-machines";

export interface StartOptionsControl {
  readonly options: readonly StartOptionState[];
  readonly errors: ReadonlyMap<string, string>;
  readonly pending: boolean;
  /** The host's presets are still being applied; a run started now would not have them. */
  readonly applyingPresets: boolean;
  /** Why the host's presets did not apply; while there is one, the run must not start with the defaults instead. */
  readonly presetErrors: readonly string[];
  set: (optionId: string, value: unknown) => Promise<void>;
}

const inertControl: StartOptionsControl = Object.freeze({
  options: [],
  errors: new Map(),
  pending: false,
  applyingPresets: false,
  presetErrors: [],
  set: async () => undefined,
});

const presetsRefused: StartOptionsControl = Object.freeze({ ...inertControl, presetErrors: ["This user account cannot choose start options."] });

const StartOptionsContext = createContext<StartOptionsControl>(inertControl);

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** A preset applies only to options the run currently lets you choose; anything unknown is left alone. */
export const initialStartOptionUpdates = (
  options: readonly StartOptionState[],
  values: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] => options
  .filter((option) => option.selectable && !option.locked && Object.hasOwn(values, option.id))
  .map((option) => [option.id, values[option.id]] as const);

/** Why presets do not apply: while they wait for the options, the error loading them; afterwards the refusal of each preset option until it is set again. */
export const presetErrorsOf = (
  waiting: boolean,
  presetIds: readonly string[],
  errors: ReadonlyMap<string, string>,
): readonly string[] => {
  const loadError = errors.get("");
  if (waiting) return loadError === undefined ? [] : [loadError];
  return presetIds.flatMap((optionId) => errors.get(optionId) ?? []);
};

/** Nothing presets what a template fixes; otherwise its start fails on the differing choice. */
export const withoutFixedStartOptions = (
  values: Readonly<Record<string, unknown>>,
  fixed: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> => Object.fromEntries(Object.entries(values).filter(([optionId]) => !fixed || !Object.hasOwn(fixed, optionId)));

export interface ShownStartOption {
  readonly option: StartOptionState;
  readonly fixed: boolean;
}

/** What a place shows: the selectable open options and every option the template fixes, with the template's value and not selectable. */
export const shownStartOptions = (
  options: readonly StartOptionState[],
  fixed: Readonly<Record<string, unknown>>,
): readonly ShownStartOption[] => options.flatMap((option): ShownStartOption[] => Object.hasOwn(fixed, option.id)
  ? [{ option: { ...option, value: fixed[option.id], selectable: false }, fixed: true }]
  : option.selectable && !option.locked ? [{ option, fixed: false }] : []);

const sameJson = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => sameJson(entry, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return left === right;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
};

/** What was chosen before the start differently from what the template fixes; such a start fails on the server. */
export const conflictingStartOptions = (
  options: readonly StartOptionState[],
  fixed: Readonly<Record<string, unknown>>,
): readonly StartOptionState[] => options.filter((option) => option.chosen && !option.locked
  && Object.hasOwn(fixed, option.id) && !sameJson(option.value, fixed[option.id]));

const noneFixed: Readonly<Record<string, unknown>> = Object.freeze({});

export function StartOptionsProvider({
  children,
  connected,
  initialValues,
  messageCount,
  sessionId,
}: PropsWithChildren<{
  connected: boolean;
  initialValues?: Readonly<Record<string, unknown>>;
  messageCount: number;
  sessionId: string;
}>) {
  const access = useAccess();
  const allowed = access.can("runs.create");
  const started = messageCount > 0;
  const [state, setState] = useState<{ sessionId: string; options: readonly StartOptionState[]; errors: ReadonlyMap<string, string>; pending: boolean; loadedStarted: boolean }>(
    () => ({ sessionId, options: [], errors: new Map(), pending: true, loadedStarted: false }),
  );
  const active = useRef<{ sessionId: string; pending: boolean; controller: AbortController } | null>(null);
  const outstanding = useRef<{ sessionId: string; values: Readonly<Record<string, unknown>> } | null>(
    initialValues ? { sessionId, values: initialValues } : null);
  const [applying, setApplying] = useState(outstanding.current !== null);
  const [presets, setPresets] = useState<{ sessionId: string; optionIds: readonly string[] }>();
  const saving = useRef<{ sessionId: string; done: Promise<void> } | null>(null);
  const [defaultsRevision, setDefaultsRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setDefaultsRevision((value) => value + 1);
    window.addEventListener(modelDefaultsChangedEvent, refresh);
    return () => window.removeEventListener(modelDefaultsChangedEvent, refresh);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const operation = { sessionId, pending: true, controller };
    active.current = operation;
    setState((current) => current.sessionId === sessionId ? { ...current, pending: true }
      : { sessionId, options: [], errors: new Map(), pending: true, loadedStarted: false });
    void (async () => {
      try {
        if (saving.current?.sessionId === sessionId) await saving.current.done;
        if (controller.signal.aborted) return;
        const options = await getStartOptions(sessionId, controller.signal);
        if (controller.signal.aborted) return;
        setState((current) => {
          const errors = new Map(current.errors);
          errors.delete("");
          return { sessionId, options, errors, pending: false, loadedStarted: started };
        });
      } catch (cause) {
        if (!controller.signal.aborted) setState((current) => ({ ...current, errors: new Map(current.errors).set("", messageOf(cause)), pending: false }));
      } finally {
        operation.pending = false;
      }
    })();
    return () => {
      controller.abort();
      if (active.current === operation) active.current = null;
    };
  }, [allowed, connected, sessionId, started, defaultsRevision]);

  const set = useCallback(async (optionId: string, value: unknown) => {
    const operation = active.current;
    if (!operation || operation.sessionId !== sessionId || operation.controller.signal.aborted) return;
    if (operation.pending || saving.current?.sessionId === sessionId) {
      setState((current) => ({ ...current, errors: new Map(current.errors).set(optionId, "The start options are still loading or saving. Please try again afterwards.") }));
      return;
    }
    operation.pending = true;
    setState((current) => {
      const errors = new Map(current.errors);
      errors.delete(optionId);
      return { ...current, errors, pending: true };
    });
    const done = (async () => {
      let saved = false;
      try {
        await setStartOption(sessionId, optionId, value);
        saved = true;
        if (active.current !== operation) return;
        const options = await getStartOptions(sessionId, operation.controller.signal);
        if (active.current === operation) setState((current) => ({ ...current, options }));
      } catch (cause) {
        if (active.current?.sessionId === sessionId && (!saved || active.current === operation)) {
          setState((current) => ({ ...current, errors: new Map(current.errors).set(optionId, messageOf(cause)) }));
        }
      } finally {
        if (active.current === operation) {
          operation.pending = false;
          setState((current) => ({ ...current, pending: false }));
        }
      }
    })();
    const save = { sessionId, done };
    saving.current = save;
    try { await done; }
    finally { if (saving.current === save) saving.current = null; }
  }, [sessionId]);

  useEffect(() => {
    const initial = outstanding.current;
    if (!initial) return;
    if (!allowed || initial.sessionId !== sessionId) {
      outstanding.current = null;
      setApplying(false);
      return;
    }
    // Presets wait until the options have loaded and no reload is under way.
    if (state.sessionId !== sessionId || state.pending || state.errors.has("") || active.current?.pending) return;
    outstanding.current = null;
    const updates = initialStartOptionUpdates(state.options, initial.values);
    setPresets({ sessionId, optionIds: updates.map(([optionId]) => optionId) });
    void (async () => {
      for (const [optionId, value] of updates) await set(optionId, value);
      setApplying(false);
    })();
  }, [allowed, sessionId, set, state]);

  // Until the server has answered after the first message, everything is locked; after that its locked applies.
  const control = useMemo<StartOptionsControl>(() => ({
    options: state.sessionId === sessionId ? state.options.map((option) => ({ ...option, locked: option.locked || (started && !state.loadedStarted) })) : [],
    errors: state.sessionId === sessionId ? state.errors : new Map(),
    pending: state.sessionId !== sessionId || state.pending || applying,
    applyingPresets: applying,
    presetErrors: state.sessionId === sessionId ? presetErrorsOf(applying, presets?.sessionId === sessionId ? presets.optionIds : [], state.errors) : [],
    set,
  }), [applying, presets, state, sessionId, started, set]);

  const preset = initialValues !== undefined && Object.keys(initialValues).length > 0;
  return <StartOptionsContext.Provider value={allowed ? control : preset ? presetsRefused : inertControl}>{children}</StartOptionsContext.Provider>;
}

export const useStartOptions = () => useContext(StartOptionsContext);

/** The presets that did not apply, shown where the run would start; it cannot start like this. */
export function StartOptionPresetErrors({ className }: { className: string }) {
  const { presetErrors } = useStartOptions();
  return <>{presetErrors.map((error, index) => <p className={className} key={index} role="alert">The run cannot start as prepared: {error}</p>)}</>;
}

const ChoiceControl = ({ disabled, error, option, setValue }: StartOptionControlContext) => {
  const parsed = useMemo(() => {
    try {
      const presentation = choicePresentationFrom(option.presentation, option.id);
      if (!presentation) {
        return { message: `The start option ${option.id} has neither a web component nor a choice presentation` };
      }
      if (typeof option.value !== "string") return { message: `The value of the start option ${option.id} is not an identifier` };
      return { presentation, value: option.value };
    } catch (cause) {
      return { message: messageOf(cause) };
    }
  }, [option]);
  if ("message" in parsed) return <p className="text-[0.75rem] text-destructive" role="alert">{parsed.message}</p>;
  return (
    <div className="flex flex-col items-start gap-2">
      <ChoiceSelect label={parsed.presentation.label} disabled={disabled} size="sm" options={parsed.presentation.options} value={parsed.value} onValueChange={(value) => { void setValue(value); }} />
      {error && <p className="text-[0.75rem] text-destructive" role="alert">{error}</p>}
    </div>
  );
};

const unchangeable = async () => undefined;

function FixedStartOption({ conflict, machines, option, registry }: { conflict: boolean; machines: OfferedMachines; option: StartOptionState; registry: PluginRegistry }) {
  const Control = registry.startOptions.get(option.id)?.Control ?? ChoiceControl;
  return <span className="contents" data-start-option-fixed={option.id} title="Set by the template">
    <Control disabled error={conflict ? "A different value is chosen; the template sets this one." : undefined} machines={machines} option={option} setValue={unchangeable} />
  </span>;
}

/** The start options of a place; what the chosen template fixes is shown with its value instead of as a choice. */
export function StartOptionControls({ disabled, registry, placement = "page", fixed = noneFixed }: {
  disabled: boolean;
  registry: PluginRegistry;
  placement?: "page" | "composer";
  fixed?: Readonly<Record<string, unknown>>;
}) {
  const access = useAccess();
  const control = useStartOptions();
  const machines = useOfferedMachines();
  const loadError = control.errors.get("");
  if (!access.can("runs.create")) return null;
  const here = control.options.filter((option) => (registry.startOptions.get(option.id)?.placement ?? "page") === placement);
  const conflicts = new Set(conflictingStartOptions(here, fixed).map((option) => option.id));
  return (
    <>
      {placement === "page" && loadError && <p className="text-[0.75rem] text-destructive" role="alert">{loadError}</p>}
      {shownStartOptions(here, fixed).map(({ option, fixed: isFixed }) => {
        if (isFixed) return <FixedStartOption conflict={conflicts.has(option.id)} key={option.id} machines={machines} option={option} registry={registry} />;
        const Control = registry.startOptions.get(option.id)?.Control ?? ChoiceControl;
        return (
          <Control
            disabled={disabled || control.pending || !access.can("runs.write")}
            error={control.errors.get(option.id)}
            key={option.id}
            machines={machines}
            option={option}
            setValue={(value) => control.set(option.id, value)}
          />
        );
      })}
    </>
  );
}

export function StartOptionBadges({ registry, session }: { registry: PluginRegistry; session: SessionContext }) {
  const control = useStartOptions();
  return (
    <>
      {control.options.map((option) => {
        const Badge = registry.startOptions.get(option.id)?.Badge;
        return Badge ? <Badge key={option.id} option={option} session={session} /> : null;
      })}
    </>
  );
}
