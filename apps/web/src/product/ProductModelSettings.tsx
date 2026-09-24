import { useEffect, useRef, useState } from "react";
import { useAccess } from "../AccessContext";
import { Alert, AlertAction, AlertDescription, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui";
import { thinkingLabel } from "../lib/labels";
import type { ProductModelDraft, ProductModelSettings as Settings } from "@ragents/host/plugin-support/product-model-settings-contract";
import { modelDraftOf, requestProductModelSettings } from "./model-settings";
import { modelDefaultsChangedEvent } from "../model-settings-events";

const profileLabels: Record<string, { title: string; description: string }> = {
  coordinator: { title: "Run-Koordinator", description: "Die Vorgabe beim Start einer neuen Unterhaltung." },
  relay: { title: "Vermittler", description: "Agenten, die Nachrichten und Ergebnisse weitergeben." },
  standard: { title: "Agenten", description: "Die Vorgabe für weitere Agenten im Run." },
  reviewer: { title: "Prüfung", description: "Die Vorgabe für Agenten mit Prüfauftrag." },
};

type LoadState = { status: "loading" } | { status: "failed"; error: string }
  | { status: "ready"; settings: Settings };
const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

const noteClass = "text-[0.8rem] leading-[1.5] text-muted-foreground";
const triggerClass = "w-full min-w-0 max-w-full";

export function ProductModelSettings({ pluginId }: { pluginId: string }) {
  const access = useAccess();
  const readable = access.can("settings.read");
  const writable = access.can("settings.write");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<ProductModelDraft>();
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [retry, setRetry] = useState(0);
  const dirty = state.status === "ready" && draft !== undefined
    && JSON.stringify(draft) !== JSON.stringify(modelDraftOf(state.settings));
  useEffect(() => {
    const refresh = () => { if (!dirty && !saving.current) setRetry((value) => value + 1); };
    window.addEventListener(modelDefaultsChangedEvent, refresh);
    return () => window.removeEventListener(modelDefaultsChangedEvent, refresh);
  }, [dirty]);
  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    void requestProductModelSettings(pluginId, { signal: controller.signal }).then((settings) => {
      if (controller.signal.aborted) return;
      setState({ status: "ready", settings });
      setDraft(modelDraftOf(settings));
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setState({ status: "failed", error: messageOf(cause) });
    });
    return () => controller.abort();
  }, [pluginId, readable, retry]);

  if (!readable) return null;
  if (state.status === "failed") return <Alert variant="destructive">
    <AlertDescription>{state.error}</AlertDescription>
    <AlertAction><Button onClick={() => setRetry((value) => value + 1)} size="sm" variant="outline">Erneut laden</Button></AlertAction>
  </Alert>;
  if (state.status !== "ready" || !draft) return <p role="status">Modellvorgaben werden geladen ...</p>;
  const { settings } = state;
  const change = (name: string, model: string, thinking: ProductModelDraft["profiles"][number]["thinking"]) => {
    setDraft({ profiles: draft.profiles.map((profile) => profile.name === name ? { ...profile, model, thinking } : profile) });
    setError(undefined);
    setNotice(undefined);
  };
  const save = async () => {
    if (!writable || saving.current || !dirty) return;
    saving.current = true;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await requestProductModelSettings(pluginId, { draft });
      setState({ status: "ready", settings: saved });
      setDraft(modelDraftOf(saved));
      setNotice("Vorgaben gespeichert. Sie gelten für neue Actors und noch nicht gestartete Runs.");
      window.dispatchEvent(new Event(modelDefaultsChangedEvent));
    } catch (cause) { setError(messageOf(cause)); }
    finally { saving.current = false; setPending(false); }
  };
  return <form className="grid min-w-0 gap-4.5" aria-label="Modellvorgaben für neue Runs und Agenten" onSubmit={(event) => {
    event.preventDefault();
    void save();
  }}>
    <p className={noteClass}>Für dieses Produktprofil gespeichert. Bereits angelegte Actors behalten ihr Modell.
      Eine ausdrücklich gewählte Modellauswahl im Run hat Vorrang.</p>
    {!writable && <p className={noteClass}>Du hast Lesezugriff auf diese Einstellungen.</p>}
    <div className="grid gap-4">
      {settings.profiles.map((profile) => {
        const value = draft.profiles.find((entry) => entry.name === profile.name)!;
        const metadata = settings.models.find((model) => model.provider === profile.provider && model.id === value.model)!;
        const label = profileLabels[profile.name] ?? { title: profile.name, description: profile.description };
        const modelOptions = settings.models.filter((model) => model.provider === profile.provider).map((model) => ({ value: model.id, label: model.label }));
        const thinkingOptions = metadata.thinking.map((thinking) => ({ value: thinking, label: thinkingLabel(thinking) }));
        return <fieldset className="min-w-0 border-t border-border-soft pt-4 first:border-t-0 first:pt-0" key={profile.name} disabled={!writable || pending}>
          <legend className="float-left w-full text-[0.9rem] font-semibold">{label.title}</legend>
          <p className="clear-both mt-0.5 mb-3 text-[0.8rem] text-muted-foreground">{label.description}</p>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(125px,180px)] gap-3 max-sm:grid-cols-[minmax(0,1fr)]">
            <Select disabled={!writable || pending} items={modelOptions} value={value.model}
              onValueChange={(model) => {
                if (model === null) return;
                const next = settings.models.find((entry) => entry.id === model && entry.provider === profile.provider)!;
                const thinking = next.thinking.includes(value.thinking) ? value.thinking : next.thinking[0]!;
                change(profile.name, model, thinking);
                if (thinking !== value.thinking) setNotice(`Für ${label.title} wurde die verfügbare Reasoning-Stufe ${thinkingLabel(thinking)} gewählt. Prüfe sie vor dem Speichern.`);
              }}>
              <SelectTrigger aria-label="Modell" className={triggerClass}><SelectValue /></SelectTrigger>
              <SelectContent>{modelOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select disabled={!writable || pending || metadata.thinking.length < 2} items={thinkingOptions} value={value.thinking}
              onValueChange={(thinking) => {
                const level = metadata.thinking.find((entry) => entry === thinking);
                if (level) change(profile.name, value.model, level);
              }}>
              <SelectTrigger aria-label="Reasoning" className={triggerClass}><SelectValue /></SelectTrigger>
              <SelectContent>{thinkingOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </fieldset>;
      })}
    </div>
    <div className="flex flex-wrap items-center gap-2.5">
      <Button type="submit" disabled={!writable || pending || !dirty}>{pending ? "Wird gespeichert ..." : "Vorgaben speichern"}</Button>
      {dirty && <Button disabled={pending} variant="outline" onClick={() => {
        setDraft(modelDraftOf(settings)); setError(undefined); setNotice(undefined);
      }}>Änderungen verwerfen</Button>}
      <span className={`${noteClass} basis-full`} role="status">{notice ?? (dirty ? "Ungespeicherte Änderungen" : "")}</span>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </form>;
}
