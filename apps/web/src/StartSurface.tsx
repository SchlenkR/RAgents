import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { BookIcon, CodeIcon } from "lucide-react";
import { Button, Input, ListDetail, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Toggle, type ListDetailItem } from "./ui";
import { useModalController, type ModalController } from "./ui/modal-controller";
import { ChatInputToolbar } from "./chat/ChatInputToolbar";
import { DetailModeSwitch } from "./chat/DetailModeSwitch";
import { FixedStartOptions, StartOptionControls, useStartOptions } from "./StartOptions";
import { useAttachmentCapabilities } from "./chat/useAttachmentCapabilities";
import { useAccess } from "./AccessContext";
import { canStartEntry } from "../../../packages/ragents/src/access";
import { RunPreparationChat } from "./RunPreparationChat";
import { useChatSteps, type JsonValue, type ScriptStartEntry, type PluginRegistry,
  type SkillStartEntry, type StartEntry, type SessionContext } from "./PluginRegistry";

const byOrder = (left: StartEntry, right: StartEntry) => (left.order ?? Number.MAX_SAFE_INTEGER)
  - (right.order ?? Number.MAX_SAFE_INTEGER) || left.title.localeCompare(right.title, "de-DE");
const kindLabel = (entry: StartEntry) => entry.action === "skill" ? "Skill" : "Run-Script";
const entryIcon = (entry: StartEntry) => entry.action === "skill" ? <BookIcon size={18} /> : <CodeIcon size={18} />;

export function StartSurface({ registry, session, initialEntryId }: {
  registry: PluginRegistry;
  session: SessionContext;
  initialEntryId?: string;
}) {
  const access = useAccess();
  const canCreate = access.can("runs.create");
  const modal = useModalController();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const launching = useRef(false);
  const openedInitialEntry = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const steps = useChatSteps(session.session.id, "preparation");
  const startOptions = useStartOptions();
  const attachments = useAttachmentCapabilities(session.session.id, "primary", JSON.stringify(startOptions.options.map(({ id, value }) => [id, value])));
  const disabled = pending || startOptions.pending;

  const run = useCallback(async (entry: ScriptStartEntry, value: JsonValue | null) => {
    if (launching.current || !canStartEntry(access, entry.id)) return;
    launching.current = true;
    setPending(true);
    setError(undefined);
    try {
      await sessionRef.current.start(entry.id, value);
    } catch (cause) {
      setError(`${entry.title}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      launching.current = false;
      setPending(false);
    }
  }, [access]);

  useEffect(() => {
    if (!initialEntryId || disabled || openedInitialEntry.current) return;
    openedInitialEntry.current = true;
    const entry = registry.startEntries.find((candidate) => candidate.id === initialEntryId);
    if (!entry || !canStartEntry(access, entry.id)) {
      setError("Dieser Einstieg ist im aktuellen Profil nicht verfügbar.");
      return;
    }
    openStartEntry(entry, registry, modal, sessionRef, run);
  }, [access, disabled, initialEntryId, modal, registry, run]);

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-hidden px-10 pt-6 pb-5 max-md:gap-4.5 max-md:px-3 max-md:pt-11 max-md:pb-4">
    {canCreate && <section aria-label="Auftrag" className="mx-auto flex w-full max-w-composer min-w-0 flex-none flex-col gap-2">
      <ChatInputToolbar {...attachments} disabled={pending} sendDisabled={disabled} maxRows={8} onSend={session.send} rows={3}
        texts={{ placeholder: "Dein Auftrag ...", send: "Run erstellen" }}
        toolbarLeft={steps.selectable ? <DetailModeSwitch mode={steps.mode("coordinator")} onChange={(mode) => steps.setMode("coordinator", mode)} /> : undefined}
        toolbarRight={<StartOptionControls disabled={disabled} placement="composer" registry={registry} />} />
      <div aria-label="Startoptionen" className="flex flex-wrap items-center gap-x-3 gap-y-2 empty:hidden"><StartOptionControls disabled={disabled} registry={registry} /></div>
    </section>}
    {error && <p className="text-[0.8rem] text-destructive" role="alert">{error}</p>}
    <StartEntryLibrary skills={canCreate ? registry.skillEntries.filter((entry) => canStartEntry(access, entry.id)) : []}
      scripts={registry.scriptEntries.filter((entry) => canStartEntry(access, entry.id))} launchDisabled={disabled} technical={access.can("runs.inspect")}
      hasGuide={(entry) => registry.guideFor(entry) !== undefined}
      fixedOptions={(entry) => entry.fixedStartOptions && <FixedStartOptions fixed={entry.fixedStartOptions} registry={registry} />}
      onOpen={(entry) => openStartEntry(entry, registry, modal, sessionRef, run)} />
  </div>;
}

export function openStartEntry(entry: StartEntry, registry: PluginRegistry, modal: ModalController,
  sessionRef: RefObject<SessionContext>, run: (entry: ScriptStartEntry, value: JsonValue | null) => Promise<void>) {
  const proceed = (value: JsonValue | null) => {
    if (entry.action === "script") { void run(entry, value); return; }
    if (value !== null && (typeof value !== "string" || !value.trim())) {
      throw new Error(`Der Leitfaden für ${entry.title} muss einen nicht leeren Auftrag liefern.`);
    }
    modal.open({ title: "Auftrag vorbereiten", subtitle: entry.title,
      render: () => <RunPreparationChat entry={entry} initialPrompt={value ?? entry.prompt}
        registry={registry} sessionRef={sessionRef} /> });
  };
  const guide = registry.guideFor(entry);
  if (!guide) { proceed(null); return; }
  let completed = false;
  modal.open({ title: entry.title, subtitle: entry.description,
    render: (controller) => <guide.Guide entry={entry} session={sessionRef.current}
      onCancel={controller.back} onComplete={(value) => {
        if (completed) return;
        if (entry.action === "skill" && (typeof value !== "string" || !value.trim())) {
          throw new Error(`Der Leitfaden für ${entry.title} muss einen nicht leeren Auftrag liefern.`);
        }
        completed = true;
        controller.back();
        proceed(value);
      }} />,
  });
}

export function StartEntryLibrary({ skills, scripts, launchDisabled, onOpen, hasGuide, fixedOptions, technical = true }: {
  skills: readonly SkillStartEntry[];
  scripts: readonly ScriptStartEntry[];
  launchDisabled: boolean;
  onOpen: (entry: StartEntry) => void;
  hasGuide: (entry: StartEntry) => boolean;
  /** Was die Vorlage an Startoptionen festlegt; die Vorschau zeigt es fest statt zur Wahl. */
  fixedOptions?: (entry: StartEntry) => ReactNode;
  technical?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const sorted = useMemo(() => [...[...skills].sort(byOrder), ...[...scripts].sort(byOrder)], [skills, scripts]);
  const tags = [...new Set(sorted.flatMap((entry) => entry.tags ?? []))].sort((a, b) => a.localeCompare(b, "de-DE"));
  const filtered = sorted.filter((entry) => (!tag || entry.tags?.includes(tag))
    && `${entry.title} ${entry.description} ${entry.category ?? kindLabel(entry)} ${entry.owner} ${(entry.tags ?? []).join(" ")}`
      .toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
  const selected = filtered.find((entry) => entry.id === selectedId) ?? filtered[0];
  const guided = selected && hasGuide(selected);
  const tagOptions = [{ value: "", label: "Alle Schlagworte" }, ...tags.map((value) => ({ value, label: value }))];
  const items: ListDetailItem[] = filtered.map((entry) => ({ id: entry.id, title: entry.title,
    description: entry.description, group: entry.category ?? (technical ? "Run-Scripts" : "Abläufe"),
    icon: entryIcon(entry), meta: technical ? kindLabel(entry) : undefined, tone: entry.action === "skill" ? "purple" : "success" }));

  return <ListDetail className="min-h-0 flex-1" label="Skills und Abläufe" detailLabel="Vorschau" items={items}
    selectedId={selected?.id} onSelect={setSelectedId}
    emptyState={<p role="status">Kein passender Skill oder Ablauf.</p>}
    toolbar={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <Input aria-label="Skills und Abläufe durchsuchen" className="w-auto max-w-[560px] flex-[1_1_220px]" onChange={(event) => setQuery(event.target.value)}
        placeholder="Skills und Abläufe suchen ..." type="search" value={query} />
      <Select items={tagOptions} value={tag} onValueChange={(value) => setTag(value ?? "")}>
        <SelectTrigger aria-label="Schlagwort" size="sm"><SelectValue /></SelectTrigger>
        <SelectContent>{tagOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      <span className="ml-auto text-[0.75rem] text-muted-foreground" role="status">{filtered.length} Einträge</span>
    </div>}
    detailHeader={selected && <>{technical && <p className="flex items-center gap-2 text-[0.75rem] font-semibold">{entryIcon(selected)}{kindLabel(selected)}</p>}<h2 className="mt-2 text-lg font-semibold">{selected.title}</h2><p className="mt-1.5 text-muted-foreground">{selected.description}</p></>}
    detailFooter={selected && <><Button disabled={selected.action === "script" && launchDisabled} onClick={() => onOpen(selected)}>
      {guided ? "Einrichten" : selected.action === "skill" ? "In Auftrag übernehmen" : technical ? "Aufbauen" : "Starten"}
    </Button><span className="text-[0.75rem] text-muted-foreground">{!technical ? guided ? "Wähle die Angaben für diesen Ablauf." : "Startet den ausgewählten Ablauf." : selected.action === "skill" ? guided
      ? "Angaben klären und danach den Auftrag vorbereiten." : "Auftrag im nächsten Schritt besprechen oder direkt starten."
      : guided ? "Öffnet zuerst einen Leitfaden." : !selected.coordinator ? "Startet ohne Koordinator." : "Startet einen neuen Run."}</span></>}
  >
    {selected && <>
      <h3 className="mb-2 text-base font-semibold">{selected.action === "skill" ? "Der Auftrag" : "Was beim Start passiert"}</h3>
      <p className="leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.action === "skill" ? selected.prompt
        : guided ? "Der Leitfaden klärt die Angaben für diesen Ablauf. Danach wird der Run aufgebaut."
        : "Der vorbereitete Ablauf wird gestartet."}</p>
      {selected.fixedStartOptions && <div aria-label="Von der Vorlage festgelegt" className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 empty:hidden">{fixedOptions?.(selected)}</div>}
      <div aria-label="Schlagworte" className="mt-6 flex flex-wrap gap-1.5">{selected.tags?.map((value) => <Toggle key={value} pressed={tag === value}
        onPressedChange={() => setTag(tag === value ? "" : value)} size="sm" variant="outline">{value}</Toggle>)}</div>
      {technical && <p className="mt-4 text-[0.75rem] text-muted-foreground">{selected.owner}</p>}
    </>}
  </ListDetail>;
}
