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
    <Button variant="outline" onClick={() => { setState({ status: "loading" }); setRetry((value) => value + 1); }}>Reload</Button>
  </Alert>;
  if (state.status !== "ready" || draft === undefined) return <p className={noteClasses} role="status">Loading title settings ...</p>;
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
      setNotice(saved.selection === null ? "Automatic titles are turned off." : "Model saved for the next automatic titles.");
      window.dispatchEvent(new Event(titleModelSettingsChangedEvent));
    } catch (cause) { setError(messageOf(cause)); }
    finally { saving.current = false; setPending(false); }
  };

  const options = titleModelOptions(settings.models, draft, settings.models.length > 20 ? query : "");
  return <form aria-label="Model for automatic titles" className="flex min-w-0 flex-col items-start gap-3" onSubmit={(event) => {
    event.preventDefault();
    void save();
  }}>
    <p className={noteClasses}>Condenses the first task into a short title line. Applies to the next automatically generated titles.</p>
    {settings.models.length === 0 && <p className={noteClasses}>The provider offers no model for titles; automatic titles stay off.</p>}
    {!writable && <p className={noteClasses}>You have read access to these settings.</p>}
    {settings.models.length > 20 && <Input aria-label="Search title models" className={controlClasses} disabled={!writable || pending}
      onChange={(event) => setQuery(event.target.value)} placeholder="Search models ..." type="search" value={query} />}
    <Select disabled={!writable || pending} items={options} value={titleSelectionKey(draft)} onValueChange={(key) => {
      if (key === null) return;
      setDraft(titleSelectionFromKey(key, settings.models));
      setError(undefined);
      setNotice(undefined);
    }}>
      <SelectTrigger aria-label="Model" className={controlClasses}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button disabled={!writable || pending || !dirty} type="submit">{pending ? "Saving ..." : "Save"}</Button>
      {dirty && <Button variant="outline" disabled={pending} onClick={() => {
        setDraft(settings.selection); setError(undefined); setNotice(undefined);
      }}>Discard changes</Button>}
      <span className={`${noteClasses} empty:hidden`} role="status">{notice ?? (dirty ? "Unsaved changes" : "")}</span>
    </div>
    {error && <p className="text-[0.76rem] text-destructive" role="alert">{error}</p>}
  </form>;
}
