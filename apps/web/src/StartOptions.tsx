import { useAccess } from "./AccessContext";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { getStartOptions, setStartOption } from "./api";
import {
  choicePresentationFrom,
  type StartOptionState,
} from "../../server/src/plugin-support/start-options-contract";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui";
import type { PluginRegistry, SessionContext, StartOptionControlContext } from "./PluginRegistry";
import { modelDefaultsChangedEvent } from "./model-settings-events";

export interface StartOptionsControl {
  readonly options: readonly StartOptionState[];
  readonly errors: ReadonlyMap<string, string>;
  readonly pending: boolean;
  set: (optionId: string, value: unknown) => Promise<void>;
}

const inertControl: StartOptionsControl = Object.freeze({
  options: [],
  errors: new Map(),
  pending: false,
  set: async () => undefined,
});

const StartOptionsContext = createContext<StartOptionsControl>(inertControl);

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** Eine Vorbelegung gilt nur für Optionen, die der Run gerade wählen lässt; Unbekanntes bleibt liegen. */
export const initialStartOptionUpdates = (
  options: readonly StartOptionState[],
  values: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] => options
  .filter((option) => option.selectable && !option.locked && Object.hasOwn(values, option.id))
  .map((option) => [option.id, values[option.id]] as const);

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
  const allowed = access.can("runs.create") && access.can("runs.inspect");
  const started = messageCount > 0;
  const [state, setState] = useState<{ sessionId: string; options: readonly StartOptionState[]; errors: ReadonlyMap<string, string>; pending: boolean }>(
    () => ({ sessionId, options: [], errors: new Map(), pending: true }),
  );
  const active = useRef<{ sessionId: string; pending: boolean; controller: AbortController } | null>(null);
  const outstanding = useRef<{ sessionId: string; values: Readonly<Record<string, unknown>> } | null>(
    initialValues ? { sessionId, values: initialValues } : null);
  const [applying, setApplying] = useState(outstanding.current !== null);
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
      : { sessionId, options: [], errors: new Map(), pending: true });
    void (async () => {
      try {
        if (saving.current?.sessionId === sessionId) await saving.current.done;
        if (controller.signal.aborted) return;
        const options = await getStartOptions(sessionId, controller.signal);
        if (controller.signal.aborted) return;
        setState((current) => {
          const errors = new Map(current.errors);
          errors.delete("");
          return { sessionId, options, errors, pending: false };
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
      setState((current) => ({ ...current, errors: new Map(current.errors).set(optionId, "Die Startoptionen werden noch geladen oder gespeichert. Bitte versuche es danach erneut.") }));
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
    if (state.sessionId !== sessionId || state.pending) return;
    outstanding.current = null;
    void (async () => {
      for (const [optionId, value] of initialStartOptionUpdates(state.options, initial.values)) await set(optionId, value);
      setApplying(false);
    })();
  }, [allowed, sessionId, set, state]);

  const control = useMemo<StartOptionsControl>(() => ({
    options: state.sessionId === sessionId ? state.options.map((option) => ({ ...option, locked: option.locked || started })) : [],
    errors: state.sessionId === sessionId ? state.errors : new Map(),
    pending: state.sessionId !== sessionId || state.pending || applying,
    set,
  }), [applying, state, sessionId, started, set]);

  return <StartOptionsContext.Provider value={allowed ? control : inertControl}>{children}</StartOptionsContext.Provider>;
}

export const useStartOptions = () => useContext(StartOptionsContext);

const ChoiceControl = ({ disabled, error, option, setValue }: StartOptionControlContext) => {
  const parsed = useMemo(() => {
    try {
      const presentation = choicePresentationFrom(option.presentation, option.id);
      if (!presentation) {
        return { message: `Die Startoption ${option.id} hat weder eine Web-Komponente noch eine Auswahl-Darstellung` };
      }
      if (typeof option.value !== "string") return { message: `Der Wert der Startoption ${option.id} ist keine Kennung` };
      return { presentation, value: option.value };
    } catch (cause) {
      return { message: messageOf(cause) };
    }
  }, [option]);
  if ("message" in parsed) return <p className="text-[0.75rem] text-destructive" role="alert">{parsed.message}</p>;
  return (
    <div className="flex flex-col items-start gap-2">
      <Select disabled={disabled} items={parsed.presentation.options} value={parsed.value} onValueChange={(value) => { if (value !== null) void setValue(value); }}>
        <SelectTrigger aria-label={parsed.presentation.label} size="sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {parsed.presentation.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {error && <p className="text-[0.75rem] text-destructive" role="alert">{error}</p>}
    </div>
  );
};

export function StartOptionControls({ disabled, registry, placement = "surface" }: { disabled: boolean; registry: PluginRegistry; placement?: "surface" | "composer" }) {
  const access = useAccess();
  const control = useStartOptions();
  const loadError = control.errors.get("");
  if (!access.can("runs.create") || !access.can("runs.inspect")) return null;
  return (
    <>
      {placement === "surface" && loadError && <p className="text-[0.75rem] text-destructive" role="alert">{loadError}</p>}
      {control.options
        .filter((option) => option.selectable && !option.locked
          && (registry.startOptions.get(option.id)?.placement ?? "surface") === placement)
        .map((option) => {
          const Control = registry.startOptions.get(option.id)?.Control ?? ChoiceControl;
          return (
            <Control
              disabled={disabled || control.pending || !access.can("runs.write")}
              error={control.errors.get(option.id)}
              key={option.id}
              option={option}
              setValue={(value) => control.set(option.id, value)}
            />
          );
        })}
    </>
  );
}

export function StartOptionBadges({ registry, session }: { registry: PluginRegistry; session: SessionContext }) {
  const access = useAccess();
  const control = useStartOptions();
  if (!access.can("runs.inspect")) return null;
  return (
    <>
      {control.options.map((option) => {
        const Badge = registry.startOptions.get(option.id)?.Badge;
        return Badge ? <Badge key={option.id} option={option} session={session} /> : null;
      })}
    </>
  );
}
