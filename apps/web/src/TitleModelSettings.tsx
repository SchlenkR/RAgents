import { useEffect, useRef, useState } from "react";
import type { TitleModelSelection, TitleModelSettings as Settings } from "../../server/src/title-settings-contract";
import { useAccess } from "./AccessContext";
import { Alert, AlertDescription, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui";
import { requestTitleModelSettings, titleModelOptions, titleModelSettingsChangedEvent, titleSelectionFromKey, titleSelectionKey } from "./title-model-settings";

type LoadState = { status: "loading" } | { status: "failed"; error: string } | { status: "ready"; settings: Settings };
const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const noteClasses = "text-[0.76rem] leading-[1.5] text-muted-foreground";
const controlClasses = "w-[min(100%,420px)] min-w-0";

export function TitleModelSettings() {
  const access = useAccess();
  const readable = access.can("settings.read");
  const writable = access.can("settings.write");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<TitleModelSelection | null>();
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const dirty = state.status === "ready" && draft !== undefined && titleSelectionKey(draft) !== titleSelectionKey(state.settings.selection);

  useEffect(() => {
    const refresh = () => {
      if (!dirty && !saving.current) { setState({ status: "loading" }); setRetry((value) => value + 1); }
    };
    window.addEventListener(titleModelSettingsChangedEvent, refresh);
    return () => window.removeEventListener(titleModelSettingsChangedEvent, refresh);
  }, [dirty]);

  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    void requestTitleModelSettings({ signal: controller.signal }).then((settings) => {
      if (controller.signal.aborted) return;
      setState({ status: "ready", settings });
      setDraft(settings.selection);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setState({ status: "failed", error: messageOf(cause) });
    });
    return () => controller.abort();
  }, [readable, retry]);

  if (!readable) return null;
  if (state.status === "failed") return <Alert className="grid justify-items-start gap-2" variant="destructive">
    <AlertDescription>{state.error}</AlertDescription>
    <Button variant="outline" onClick={() => { setState({ status: "loading" }); setRetry((value) => value + 1); }}>Erneut laden</Button>
  </Alert>;
  if (state.status !== "ready" || draft === undefined) return <p className={noteClasses} role="status">Einstellungen für Überschriften werden geladen ...</p>;
  const { settings } = state;
  const save = async () => {
    if (!writable || saving.current || !dirty) return;
    saving.current = true;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await requestTitleModelSettings({ selection: draft });
      setState({ status: "ready", settings: saved });
      setDraft(saved.selection);
      setNotice(saved.selection === null ? "Automatische Überschriften sind deaktiviert." : "Modell für die nächsten automatischen Überschriften gespeichert.");
      window.dispatchEvent(new Event(titleModelSettingsChangedEvent));
    } catch (cause) { setError(messageOf(cause)); }
    finally { saving.current = false; setPending(false); }
  };

  const options = titleModelOptions(settings.models, draft, settings.models.length > 20 ? query : "");
  return <form aria-label="Modell für automatische Überschriften" className="flex min-w-0 flex-col items-start gap-3" onSubmit={(event) => {
    event.preventDefault();
    void save();
  }}>
    <p className={noteClasses}>Verdichtet den ersten Auftrag zu einer kurzen Titelzeile. Gilt für die nächsten automatisch erzeugten Titel.</p>
    {settings.models.length === 0 && <p className={noteClasses}>Der Anbieter bietet kein Modell für Überschriften an; automatische Überschriften bleiben aus.</p>}
    {!writable && <p className={noteClasses}>Du hast Lesezugriff auf diese Einstellungen.</p>}
    {settings.models.length > 20 && <Input aria-label="Modelle für Überschriften durchsuchen" className={controlClasses} disabled={!writable || pending}
      onChange={(event) => setQuery(event.target.value)} placeholder="Modell suchen ..." type="search" value={query} />}
    <Select disabled={!writable || pending} items={options} value={titleSelectionKey(draft)} onValueChange={(key) => {
      if (key === null) return;
      setDraft(titleSelectionFromKey(key, settings.models));
      setError(undefined);
      setNotice(undefined);
    }}>
      <SelectTrigger aria-label="Modell" className={controlClasses}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button disabled={!writable || pending || !dirty} type="submit">{pending ? "Wird gespeichert ..." : "Speichern"}</Button>
      {dirty && <Button variant="outline" disabled={pending} onClick={() => {
        setDraft(settings.selection); setError(undefined); setNotice(undefined);
      }}>Änderungen verwerfen</Button>}
      <span className={`${noteClasses} empty:hidden`} role="status">{notice ?? (dirty ? "Ungespeicherte Änderungen" : "")}</span>
    </div>
    {error && <p className="text-[0.76rem] text-destructive" role="alert">{error}</p>}
  </form>;
}
