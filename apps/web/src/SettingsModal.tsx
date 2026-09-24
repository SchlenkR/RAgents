import { useAccess } from "./AccessContext";
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, CopyIcon, InfoIcon, SettingsIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Button, Card, Dialog, DialogContent, DialogTitle, Input, Spinner, Toggle, ToggleGroup, ToggleGroupItem } from "./ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Markdown } from "./chat/Markdown";
import { SourceCode } from "./SourceCode";
import { formatBytes } from "./lib/format";
import { ThemeSettings } from "./ThemeSettings";
import { TitleModelSettings } from "./TitleModelSettings";
import { modelDefaultsChangedEvent } from "./model-settings-events";
import {
  getSettings,
  getSettingsSkill,
  type SettingsAgentHook,
  type SettingsModel,
  type SettingsProfile,
  type SettingsResponse,
  type SettingsSkill,
  type SettingsSkillDetail,
  type SettingsSkillFile,
  type SettingsTool,
} from "./api";
import type { PluginRegistry } from "./PluginRegistry";
import {
  capabilityGroups,
  contributionFilters,
  countContributions,
  entryActionLabel,
  filterGroup,
  groupContributions,
  settingsForCategory,
  skillAudienceLabel,
  toolAvailabilityLabel,
  toolKindLabel,
  toolScopeLabel,
  functionSurfaceLabel,
  type ContributionFilter,
  type ContributionKind,
  type PluginGroup,
} from "./settings-contributions";

type SettingsPageSelection =
  | { kind: "models" | "appearance" | "runtime" | "plugins" }
  | { kind: "plugin"; id: string }
  | { kind: "capability"; id: ContributionKind };

const settingsAreas = [
  { id: "models", label: "Modelle" },
  { id: "appearance", label: "Darstellung" },
  { id: "plugins", label: "Plugins" },
  { id: "runtime", label: "Laufzeit" },
] as const;
const capabilities = contributionFilters.filter(
  (option): option is { id: ContributionKind; label: string } => option.id !== "all",
);

export const settingsPageClass = "mx-auto flex max-w-[1020px] flex-col gap-6 px-[clamp(20px,4vw,46px)] pt-7 pb-12 max-sm:px-3.5 max-sm:pt-5 max-sm:pb-9";
const pageTitleClass = "min-w-0 text-[1.08rem] font-semibold text-foreground";
const pageLeadClass = "mt-1.5 max-w-[780px] text-[0.76rem] leading-[1.55] text-muted-foreground";
const sectionCopyClass = "-mt-1 mb-0.5 text-[0.72rem] leading-normal text-muted-foreground";
const settingsPanelsClass = "grid gap-5";
const panelSectionClass = "gap-4 p-5.5 max-md:p-4";
const settingsAreaClass = "min-h-11 flex-none cursor-pointer border-b-2 border-transparent px-3.5 py-2.5 text-[0.8rem] focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-4 max-md:px-2.5 max-md:text-[0.75rem]";
const navigationItemClass = "flex min-h-[37px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[0.75rem] max-md:w-auto max-md:min-h-8 max-md:flex-none max-md:whitespace-nowrap";
const navigationItemActiveClass = "bg-primary/12 font-semibold text-primary";
const navigationItemQuietClass = "text-muted-foreground hover:bg-foreground/6 hover:text-foreground";
const navigationCountClass = "min-w-5 flex-shrink-0 rounded-full bg-current/11 px-1.5 py-px text-center text-[0.63rem] tabular-nums";
const loadStateClass = "flex min-h-full items-center justify-center gap-2 p-8 text-[0.78rem] text-muted-foreground";
const ownerLinkClass = "flex w-full min-w-0 cursor-pointer items-center justify-between gap-2.5 text-left font-semibold text-foreground [overflow-wrap:anywhere] hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";
const ownerLinkNoteClass = "flex-shrink-0 text-[0.7rem] font-normal text-primary";
const cardListClass = "grid gap-2";
const cardClass = "min-w-0 rounded-xl border border-border-soft bg-background/76 px-3.5 py-3";
const cardHeaderClass = "flex items-start justify-between gap-3";
const cardCopyClass = "grid min-w-0 gap-0.5";
const cardTitleClass = "truncate text-[0.78rem] text-foreground";
const cardNoteClass = "truncate text-[0.64rem] text-muted-foreground";
const cardCopyTextClass = "my-2 text-[0.7rem] leading-normal text-muted-foreground";
const chipClass = "flex-shrink-0 rounded-full bg-foreground/7 px-1.5 py-0.5 text-[0.62rem] font-medium text-muted-foreground";
const tagClass = "inline-flex items-center gap-1.5 rounded-full bg-foreground/7 px-1.5 py-0.5 text-[0.62rem] text-foreground";
const statusListClass = "flex flex-wrap justify-end gap-1";
const disclosureClass = "overflow-hidden rounded-xl border border-border-soft bg-background/76 open:[&>summary]:border-b open:[&>summary]:border-border-soft";
const summaryClass = "flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-foreground [&::-webkit-details-marker]:hidden";
const preClass = "m-0 overflow-auto rounded-lg border border-border-soft bg-foreground/4 font-mono text-[0.7rem] leading-[1.55] whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]";
const valueLabelClass = "text-[0.67rem] font-medium text-muted-foreground";

interface SettingsModalProps {
  onClose: () => void;
  registry: PluginRegistry;
}

type LoadState =
  | { status: "loading"; settings?: SettingsResponse }
  | { status: "ready"; settings: SettingsResponse }
  | { status: "failed"; error: string; settings?: SettingsResponse };

export function SettingsModal({ onClose, registry }: SettingsModalProps) {
  const access = useAccess();
  const [selection, setSelection] = useState<SettingsPageSelection>({ kind: "models" });
  const catalogVisible = selection.kind === "plugins" || selection.kind === "plugin" || selection.kind === "capability";
  const activeArea = catalogVisible ? "plugins" : selection.kind;
  const [axis, setAxis] = useState<"plugin" | "capability">("plugin");
  const [lastPlugin, setLastPlugin] = useState<string | null>(null);
  const [lastCapability, setLastCapability] = useState<ContributionKind>("tools");
  const contentRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<ContributionFilter>("all");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [catalogRequested, setCatalogRequested] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (catalogVisible || selection.kind === "runtime") setCatalogRequested(true);
  }, [catalogVisible, selection.kind]);

  useEffect(() => {
    if (!catalogRequested) return;
    const controller = new AbortController();
    setState((current) => ({ status: "loading", settings: current.settings }));
    void getSettings(controller.signal)
      .then((settings) => { if (!controller.signal.aborted) setState({ status: "ready", settings }); })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ status: "failed", settings: current.settings, error: caught instanceof Error ? caught.message : String(caught) }));
      });
    return () => controller.abort();
  }, [catalogRequested, reload]);

  useEffect(() => {
    const changed = () => { if (catalogRequested) setReload((value) => value + 1); };
    window.addEventListener(modelDefaultsChangedEvent, changed);
    return () => window.removeEventListener(modelDefaultsChangedEvent, changed);
  }, [catalogRequested]);

  const settings = state.settings ?? null;
  const groups = useMemo(
    () => settings === null ? [] : groupContributions(settings, registry),
    [settings, registry],
  );
  const filtered = useMemo(
    () => groups.map((group) => filterGroup(group, filter, query)),
    [groups, filter, query],
  );
  const active = selection.kind === "plugin"
    ? filtered.find((group) => group.id === selection.id)
    : undefined;
  const modelSettings = settingsForCategory(registry.settings, "models", access.can);
  const appearanceSettings = settingsForCategory(registry.settings, "appearance", access.can);
  const capabilityResults = useMemo(
    () => capabilities.map((option) => ({ ...option, groups: capabilityGroups(groups, option.id, query) })),
    [groups, query],
  );
  const activeCapability = selection.kind === "capability"
    ? capabilityResults.find((option) => option.id === selection.id)
    : undefined;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [selection]);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const revealSelection = () => navigation.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [axis, selection, state.status]);

  function openPlugin(id: string) {
    setAxis("plugin");
    setLastPlugin(id);
    setSelection({ kind: "plugin", id });
  }

  function changeAxis(next: "plugin" | "capability") {
    setAxis(next);
    setSelection(next === "capability"
      ? { kind: "capability", id: lastCapability }
      : lastPlugin === null ? { kind: "plugins" } : { kind: "plugin", id: lastPlugin });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="mx-auto flex h-[calc(100vh-2*clamp(14px,4vh,42px))] max-h-none w-[min(1220px,calc(100vw-2*clamp(14px,4vw,58px)))] max-w-none min-h-0 min-w-0 flex-col gap-0 overflow-hidden rounded-xl bg-card p-0 shadow-[0_34px_90px_color-mix(in_srgb,var(--foreground)_45%,transparent)] max-md:h-[calc(100vh-16px)] max-md:w-[calc(100vw-16px)]" initialFocus={closeRef} scope="page" showCloseButton={false} size="full">
      <header className="grid flex-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3.5 py-2.5">
        <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--primary)_12%,var(--background))] text-primary"><SettingsIcon size={18} /></span>
        <span className="grid min-w-0 gap-px">
          <DialogTitle render={<strong />}>Einstellungen</DialogTitle>
          <span className="truncate text-[0.7rem] text-muted-foreground max-[520px]:hidden">Modelle und Darstellung anpassen</span>
        </span>
        <Button aria-label="Schließen" className="rounded-full" onClick={onClose} ref={closeRef} size="icon" variant="outline">
          <XIcon />
        </Button>
      </header>
      <nav aria-label="Einstellungsbereiche" className="flex flex-none gap-1 overflow-x-auto border-b border-border px-4.5 max-md:px-2">
        {settingsAreas.map((area) => <button
          aria-current={activeArea === area.id ? "page" : undefined}
          className={cn(settingsAreaClass, activeArea === area.id ? "border-b-primary font-bold text-primary" : "text-muted-foreground hover:text-foreground")}
          key={area.id}
          onClick={() => area.id === "plugins" ? changeAxis(axis) : setSelection({ kind: area.id })}
          type="button"
        >{area.label}</button>)}
      </nav>
      {catalogVisible && <div className="flex flex-none gap-1 border-b border-border-soft px-3.5 py-2.5">
        <ToggleGroup aria-label="Plugins ordnen" size="sm" spacing={0} value={[axis]} variant="outline"
          onValueChange={([value]) => { if (value) changeAxis(value === "capability" ? "capability" : "plugin"); }}>
          <ToggleGroupItem value="plugin">Nach Plugin</ToggleGroupItem>
          <ToggleGroupItem value="capability">Nach Fähigkeit</ToggleGroupItem>
        </ToggleGroup>
      </div>}
      <div className={cn("grid min-h-0 flex-1", catalogVisible ? "grid-cols-[230px_minmax(0,1fr)] max-[900px]:grid-cols-[190px_minmax(0,1fr)] max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]")}>
        {catalogVisible && <nav aria-label="Plugins durchsuchen" className="flex min-w-0 flex-col gap-[3px] overflow-y-auto border-r border-border-soft bg-background/72 px-2.5 py-4 max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b max-md:border-border-soft max-md:p-2" ref={navigationRef}>
          {axis === "plugin" && filtered.map((group) => {
            const count = countContributions(group);
            const selected = selection.kind === "plugin" && selection.id === group.id;
            const classNames = cn(navigationItemClass, selected ? navigationItemActiveClass : navigationItemQuietClass, count === 0 && "opacity-42");
            return (
              <button
                aria-current={selected ? "page" : undefined}
                className={classNames}
                key={group.id}
                onClick={() => openPlugin(group.id)}
                type="button"
              >
                {group.id}
                <span className={navigationCountClass}>{count}</span>
              </button>
            );
          })}
          {axis === "capability" && capabilityResults.map((option) => {
            const selected = selection.kind === "capability" && selection.id === option.id;
            const count = option.groups.reduce((sum, group) => sum + countContributions(group), 0);
            return (
              <button
                aria-current={selected ? "page" : undefined}
                className={cn(navigationItemClass, selected ? navigationItemActiveClass : navigationItemQuietClass)}
                key={option.id}
                onClick={() => {
                  setLastCapability(option.id);
                  setSelection({ kind: "capability", id: option.id });
                }}
                type="button"
              >
                {option.label}
                <span className={navigationCountClass}>{count}</span>
              </button>
            );
          })}
        </nav>}
        <div className="min-h-0 min-w-0 overflow-y-auto bg-app [scrollbar-width:thin]" ref={contentRef}>
          {selection.kind === "models" && <SettingsPage title="Modelle" description="Wähle Modell und Reasoning-Tiefe für die jeweiligen Aufgaben.">
            <div className={settingsPanelsClass}>
              <PluginSettings contributions={modelSettings} panel />
              {access.can("settings.read") && <SettingsSection panel title="Überschriften"><TitleModelSettings /></SettingsSection>}
            </div>
            {modelSettings.length === 0 && !access.can("settings.read") && <SettingsEmpty>Für deine Zugriffsrechte sind keine Modelleinstellungen verfügbar.</SettingsEmpty>}
          </SettingsPage>}
          {selection.kind === "appearance" && <div className="[&>:first-child]:pb-0">
            <ThemeSettings />
            {appearanceSettings.length > 0 && <div className={settingsPageClass}>
              <div className={settingsPanelsClass}><PluginSettings contributions={appearanceSettings} panel /></div>
            </div>}
          </div>}
          {(catalogVisible || selection.kind === "runtime") && settings !== null && state.status !== "ready" && <p className="border-b border-border-soft px-5 py-2.5 text-[0.72rem] text-muted-foreground" role={state.status === "failed" ? "alert" : "status"}>
            {state.status === "loading" ? "Katalog wird aktualisiert ..." : <>Katalog konnte nicht aktualisiert werden: {state.error} <Button onClick={() => setReload((value) => value + 1)} size="sm" variant="outline">Erneut laden</Button></>}
          </p>}
          {(catalogVisible || selection.kind === "runtime") && settings === null && state.status === "loading" && (
            <div className={loadStateClass}>
              <Spinner aria-hidden className="size-3" />
              Laufzeit und Plugins werden geladen.
            </div>
          )}
          {(catalogVisible || selection.kind === "runtime") && settings === null && state.status === "failed" && (
            <div className={cn(loadStateClass, "flex-col text-center text-destructive")} role="alert">
              <CircleAlertIcon size={14} />
              <strong className="text-[0.86rem] text-foreground">Katalog nicht erreichbar</strong>
              <span className="max-w-[560px]">{state.error}</span>
              <Button className="mt-1.5" onClick={() => setReload((value) => value + 1)} size="sm" variant="outline">Erneut laden</Button>
            </div>
          )}
          {settings !== null && selection.kind === "runtime" && <RuntimePage groups={groups} registry={registry} settings={settings} />}
          {settings !== null && selection.kind === "plugins" && <SettingsPage title="Plugins" description="Durchsuche die installierten Beiträge nach Plugin oder Fähigkeit. Wähle ein Plugin für seine Details.">
            <div className="grid gap-4">{groups.map((group) => <button className={ownerLinkClass} key={group.id} onClick={() => openPlugin(group.id)} type="button">
              {group.id}<span className={ownerLinkNoteClass}>{countContributions(group)} Beiträge</span>
            </button>)}</div>
          </SettingsPage>}
          {settings !== null && (selection.kind === "plugin" || selection.kind === "capability") && (
            <ContributionFilterBar filter={filter} onFilter={setFilter} onQuery={setQuery} query={query} showKinds={selection.kind === "plugin"} />
          )}
          {settings !== null && selection.kind === "plugin" && (
            active === undefined
              ? <div className={settingsPageClass}><SettingsEmpty>Dieses Plugin ist nicht mehr geladen.</SettingsEmpty></div>
              : <PluginPage group={active} key={active.id} settings={registry.settings} />
          )}
          {settings !== null && activeCapability !== undefined && (
            <SettingsPage title={activeCapability.label} description={`${activeCapability.groups.length} Plugins liefern passende Beiträge. Öffne ein Plugin für seine vollständigen Details.`}>
              {activeCapability.groups.length === 0 && <SettingsEmpty>Keine Beiträge gefunden. Wähle eine andere Fähigkeit oder ändere die Suche.</SettingsEmpty>}
              {activeCapability.groups.map((group) => (
                <PluginPage
                  group={group} key={`${activeCapability.id}:${group.id}`} settings={group.settings}
                  onOpenPlugin={() => { setFilter("all"); setQuery(""); openPlugin(group.id); }}
                />
              ))}
            </SettingsPage>
          )}
        </div>
      </div>
    </DialogContent>
    </Dialog>
  );
}

function ContributionFilterBar({ filter, onFilter, onQuery, query, showKinds }: {
  showKinds: boolean;
  filter: ContributionFilter;
  onFilter: (filter: ContributionFilter) => void;
  onQuery: (query: string) => void;
  query: string;
}) {
  return (
    <div className="sticky top-0 z-[2] grid gap-2.5 border-b border-border-soft bg-background/92 px-[clamp(20px,4vw,46px)] py-3 backdrop-blur-[6px] max-md:px-3.5">
      {showKinds && <div aria-label="Beitragsarten" className="flex flex-wrap gap-1.5" role="group">
        {contributionFilters.map((option) => (
          <Toggle key={option.id} pressed={filter === option.id} onPressedChange={() => onFilter(option.id)} size="sm" variant="outline">
            {option.label}
          </Toggle>
        ))}
      </div>}
      <label className="grid gap-1.5">
        <span className="text-[0.67rem] font-medium text-muted-foreground">Beiträge durchsuchen</span>
        <Input
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Kennung, Name, Titel oder Beschreibung"
          type="search"
          value={query}
        />
      </label>
    </div>
  );
}

function RuntimePage({ groups, registry, settings }: {
  groups: readonly PluginGroup[];
  registry: PluginRegistry;
  settings: SettingsResponse;
}) {
  const workspace = settings.runtime.workspace;
  const documents = settings.runtime.documents;
  const internalHooks = settings.agentHooks.filter((hook) => hook.kind === "internal");
  return (
    <SettingsPage
      description={`Die Werte stammen aus der aktuell laufenden ${registry.brand.title}-Instanz. Konfigurationswerte mit Geheimnissen werden vom Server nicht ausgeliefert.`}
      title="Laufzeit"
    >
      <div className="grid grid-cols-4 gap-2.5 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
        <SettingsFact label="Produkt" value={settings.product.title} detail={settings.product.id} />
        <SettingsFact label="Profil" value={settings.runtime.profile} detail={settings.product.id} />
        <SettingsFact label="Workspace-Modus" value={settings.runtime.workspaceMode} detail="je Run" />
        <SettingsFact label="Modelle" value={String(settings.models.length)} detail={`${settings.profiles.length} Profile`} />
        <SettingsFact label="Plugins" value={String(groups.length)} detail={`${settings.tools.length} Funktionen`} />
      </div>
      <SettingsSection title="Laufzeit und Arbeitsverzeichnisse">
        <SettingsValue label="Working Directory" value={settings.runtime.host.workingDirectory} copy />
        <SettingsValue
          label="Host"
          value={`${settings.runtime.host.mode === "native" ? "Lokal" : "Container"} / ${settings.runtime.host.platform}`}
        />
        <SettingsValue label="Datenverzeichnis" value={settings.runtime.dataDirectory} copy />
        <SettingsValue
          label="Konfigurationsdatei"
          value={settings.runtime.configFile ?? "keine geladen"}
          copy={settings.runtime.configFile !== null}
        />
        <SettingsValue label="Workspace-Muster je Run" value={workspace.directoryPattern} copy />
        <SettingsValue
          label="Dateiablage je Run"
          value={documents?.directoryPattern ?? "kein Dokumentenstore geladen"}
          copy={documents !== null}
        />
      </SettingsSection>
      <SettingsNote>
        Ein Agent kann innerhalb eines Runs ein eigenes Rollenprompt erhalten. Dieses run-spezifische Prompt ist kein
        statischer Modellwert und wird deshalb nicht in dieser Produktübersicht dargestellt.
      </SettingsNote>
      <SettingsSection count={settings.models.length} title="Verfügbare Modelle">
        <p className={sectionCopyClass}>
          Modelle sind auswählbare Laufzeitziele. Profile bündeln Modell, Treiber, Denktiefe und Ausführungsgrenzen.
        </p>
        <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
          {settings.models.map((model) => <ModelCard key={modelKey(model)} model={model} />)}
        </div>
      </SettingsSection>
      <SettingsSection count={settings.profiles.length} title="Profile">
        <p className={sectionCopyClass}>
          Retries gelten pro Agenten-Turn nach technischen Fehlern. Die erste Ausführung zählt nicht als Retry.
          Nicht replay-sichere oder terminal blockierte Turns werden nicht erneut ausgeführt.
        </p>
        <div className={cardListClass}>
          {settings.profiles.map((profile) => <ProfileCard key={profile.name} profile={profile} />)}
        </div>
      </SettingsSection>
      <SettingsSection title="Zusammengesetzter Produkt-Systemprompt">
        <p className={sectionCopyClass}>
          {settings.systemPrompt.composition} Der endgültige Agentenprompt ist run-spezifisch und deshalb keine feste
          Modelleinstellung.
        </p>
        <PromptCode content={settings.systemPrompt.content} copyLabel="Produkt-Systemprompt kopieren" />
      </SettingsSection>
      <SettingsSection count={settings.systemPrompt.runtimeContracts.length} title="RAgents-Laufzeitverträge">
        <div className={cardListClass}>
          {settings.systemPrompt.runtimeContracts.map((contract) => (
            <details className={disclosureClass} key={contract.audience}>
              <summary className={summaryClass}>
                <span className={cardCopyClass}>
                  <strong className={cardTitleClass}>{contract.audience === "coordinator" ? "Koordinator" : "Agent"}</strong>
                  <small className={cardNoteClass}>Wird zur Laufzeit ergänzt</small>
                </span>
              </summary>
              <PromptCode content={contract.content} copyLabel={`${contract.audience} Laufzeitvertrag kopieren`} />
            </details>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection count={internalHooks.length} title="Interne Hooks">
        <p className={sectionCopyClass}>
          Diese Hooks gehören der Agentenlaufzeit selbst und stammen aus keinem Plugin. Hooks eines Plugins
          stehen auf der Seite ihres Plugins.
        </p>
        {internalHooks.length === 0
          ? <SettingsEmpty>Kein interner Hook registriert.</SettingsEmpty>
          : (
            <div className={cardListClass}>
              {internalHooks.map((hook) => (
                <HookCard hook={hook} key={hook.id} />
              ))}
            </div>
          )}
      </SettingsSection>
    </SettingsPage>
  );
}

function PluginSettings({ contributions, panel }: { contributions: PluginRegistry["settings"]; panel?: boolean }) {
  const access = useAccess();
  return contributions.filter((item) => !item.readRight || access.can(item.readRight)).map(({ id, label, Settings }) => (
    <SettingsSection key={id} panel={panel} title={label}>
      <Settings />
    </SettingsSection>
  ));
}

function PluginPage({ group, settings, onOpenPlugin }: {
  group: PluginGroup;
  settings: PluginRegistry["settings"];
  onOpenPlugin?: () => void;
}) {
  const [selectedSkill, setSelectedSkill] = useState<SettingsSkill | null>(null);
  if (selectedSkill) return <SkillDetail onBack={() => setSelectedSkill(null)} skill={selectedSkill} />;
  const publicConfig = group.clientConfig === undefined ? undefined : sanitizedValue(group.clientConfig);
  const publicConfigText = publicConfig === undefined ? undefined : JSON.stringify(publicConfig, null, 2) ?? "{}";
  const contributions = settings.filter((contribution) => contribution.owner === group.id);
  const empty = contributions.length === 0 && countContributions(group) === 0 && group.web.state === "hidden";
  return (
    <div className={onOpenPlugin ? "flex min-w-0 flex-col gap-4.5 border-t border-border pt-5.5" : settingsPageClass}>
      <header>
        <div className="flex items-center justify-between gap-3">
          {onOpenPlugin
            ? <button className={ownerLinkClass} onClick={onOpenPlugin} type="button">{group.id}<span className={ownerLinkNoteClass}>Plugin öffnen</span></button>
            : <h2 className={`${pageTitleClass} truncate font-mono`}>{group.id}</h2>}
          {!onOpenPlugin && <span className={statusListClass}>
            <StatusBadge active={group.serverRegistered} label={group.serverRegistered ? "Server registriert" : "Server unbekannt"} />
            <StatusBadge active={group.webActive} label={group.webActive ? "Web aktiv" : "Web inaktiv"} />
          </span>}
        </div>
        {!onOpenPlugin && <p className={pageLeadClass}>Abhängigkeiten: {group.requires.length === 0 ? "keine" : group.requires.join(", ")}</p>}
      </header>
      <PluginSettings contributions={contributions} />
      {group.tools.length > 0 && (
        <SettingsSection count={group.tools.length} title="Funktionen">
          <div className={cardListClass}>
            {group.tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
          </div>
        </SettingsSection>
      )}
      {group.prompts.length > 0 && (
        <SettingsSection count={group.prompts.length} title="Prompts">
          <div className={cardListClass}>
            {group.prompts.map((contribution) => (
              <details className={disclosureClass} key={contribution.id}>
                <summary className={summaryClass}>
                  <span className={cardCopyClass}>
                    <strong className={cardTitleClass}>{contribution.id}</strong>
                    <small className={cardNoteClass}>{contribution.owner}</small>
                  </span>
                  <span className={chipClass}>Reihenfolge {contribution.order}</span>
                </summary>
                <PromptCode content={contribution.content} copyLabel={`${contribution.id} kopieren`} />
              </details>
            ))}
          </div>
        </SettingsSection>
      )}
      {group.startEntries.length > 0 && (
        <SettingsSection count={group.startEntries.length} title="Vorlagen">
          <p className={sectionCopyClass}>
            Was das Plugin auf die Startseite legt. Ein Skill öffnet einen bearbeitbaren Auftrag;
            ein Run-Script baut den Run selbst auf, bevor
            der Chat beginnt. Nennt eine Vorlage einen Leitfaden, öffnet der Klick zuerst dessen Dialog.
          </p>
          <div className={cardListClass}>
            {group.startEntries.map((entry) => (
              <article className={cardClass} key={entry.id}>
                <header className={cardHeaderClass}>
                  <span className={cardCopyClass}>
                    <strong className={cardTitleClass}>{entry.title}</strong>
                    <small className={cardNoteClass}>{entry.owner} / {entry.id}</small>
                  </span>
                  <span className={chipClass}>{entryActionLabel(entry)}</span>
                  {entry.action === "skill" && <CopyButton label={`${entry.title} kopieren`} text={entry.prompt} />}
                </header>
                <p className={cardCopyTextClass}>{entry.description}</p>
                {entry.action === "skill" && <p className={cardCopyTextClass}>Kategorie: {entry.category}</p>}
                {entry.action === "skill" && <pre className={`${preClass} max-h-[180px] px-3 py-2.5`}>{entry.prompt}</pre>}
                {entry.action === "skill" && (
                  <p className={cardCopyTextClass}>
                    Skill <code>{entry.skill}</code>
                    {entry.guide ? <> · Leitfaden <code>{entry.guide}</code></> : " · ohne Leitfaden"}
                  </p>
                )}
                {entry.action === "script" && (
                  <p className={cardCopyTextClass}>
                    {entry.coordinator ? "Mit Koordinator" : "Ohne Koordinator, das Script wählt den Primary-Actor"}
                    {entry.guide ? <> · Leitfaden <code>{entry.guide}</code></> : " · ohne Leitfaden"}
                  </p>
                )}
              </article>
            ))}
          </div>
        </SettingsSection>
      )}
      {group.skills.length > 0 && (
        <SettingsSection count={group.skills.length} title="Skills">
          <div className={cardListClass}>
            {group.skills.map((skill) => (
              <button
                className={cn(cardClass, "group relative grid w-full cursor-pointer gap-2 pr-[34px] text-left hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_6%,var(--background))] focus-visible:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] focus-visible:bg-[color-mix(in_srgb,var(--primary)_6%,var(--background))]")}
                key={skill.id}
                onClick={() => setSelectedSkill(skill)}
                type="button"
              >
                <header className={cardCopyClass}>
                  <strong className={cardTitleClass}>{skill.id}</strong>
                  <small className={cardNoteClass}>{skill.owner}</small>
                </header>
                <span className={statusListClass}>
                  {skill.audiences.map((audience) => (
                    <StatusBadge active key={audience} label={skillAudienceLabel(audience)} />
                  ))}
                </span>
                <span className="grid min-w-0 gap-[3px]">
                  {skill.paths.map((path) => <code className="truncate font-mono text-[0.66rem] text-muted-foreground" key={path} title={path}>{path}</code>)}
                </span>
                <span aria-hidden className="absolute top-1/2 right-3 flex -translate-y-1/2 text-muted-foreground group-hover:text-primary group-focus-visible:text-primary"><ChevronRightIcon size={13} /></span>
              </button>
            ))}
          </div>
        </SettingsSection>
      )}
      {group.hooks.length > 0 && (
        <SettingsSection count={group.hooks.length} title="Hooks">
          <div className={cardListClass}>
            {group.hooks.map((hook) => (
              <HookCard hook={hook} key={hook.id} />
            ))}
          </div>
        </SettingsSection>
      )}
      {(group.configuration.length > 0 || publicConfigText !== undefined) && (
        <SettingsSection count={group.configuration.length} title="Konfiguration">
          <p className={sectionCopyClass}>
            Angezeigt werden die Herkunft der Konfigurationsschlüssel und die öffentliche Client-Konfiguration,
            niemals geheime Werte.
          </p>
          {group.configuration.length > 0 && (
            <div className="grid gap-1.5 rounded-lg border border-border-soft bg-background/68 px-2.5 py-2">
              <span className={valueLabelClass}>Konfigurationsquellen</span>
              <div className="flex flex-wrap gap-1.5">
                {group.configuration.map((entry) => (
                  <span className={tagClass} key={entry.key}>
                    <code className="font-mono">{entry.key}</code>
                    <small className="text-[0.59rem] text-muted-foreground">{entry.secret ? `${entry.source} (geheim)` : entry.source}</small>
                  </span>
                ))}
              </div>
            </div>
          )}
          {publicConfigText !== undefined && (
            <PromptCode content={publicConfigText} copyLabel={`${group.id} Client-Konfiguration kopieren`} />
          )}
        </SettingsSection>
      )}
      {group.web.state !== "hidden" && (
        <SettingsSection
          count={group.web.state === "contributions" ? group.web.contributions.length : undefined}
          title="Web"
        >
          {group.web.state === "none" && <SettingsEmpty>Kein Web-Modul</SettingsEmpty>}
          {group.web.state === "withoutContributions" && <SettingsEmpty>Web-Modul ohne Beiträge</SettingsEmpty>}
          {group.web.state === "contributions" && (
            <div className="grid gap-[7px]">
              {group.web.contributions.map((contribution) => (
                <article className="grid min-w-0 gap-1.5 rounded-lg border border-border-soft bg-background/68 px-3 py-2.5" key={contribution.kind}>
                  <header className="flex items-center justify-between gap-2.5">
                    <strong className="text-[0.73rem] text-foreground">{contribution.kind}</strong>
                    <span className={chipClass}>{contribution.count}</span>
                  </header>
                  {contribution.details.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {contribution.details.map((detail) => (
                        <span className={tagClass} key={detail}><code className="font-mono">{detail}</code></span>
                      ))}
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </SettingsSection>
      )}
      {empty && <SettingsEmpty>Keine Beiträge entsprechen Filter und Suche.</SettingsEmpty>}
    </div>
  );
}

type SkillLoadState =
  | { status: "loading" }
  | { status: "ready"; detail: SettingsSkillDetail }
  | { status: "failed"; error: string };

function SkillDetail({ onBack, skill }: { onBack: () => void; skill: SettingsSkill }) {
  const [state, setState] = useState<SkillLoadState>({ status: "loading" });
  const [activeFile, setActiveFile] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setActiveFile(null);
    void getSettingsSkill(skill.id, controller.signal)
      .then((detail) => setState({ status: "ready", detail }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "failed", error: caught instanceof Error ? caught.message : String(caught) });
      });
    return () => controller.abort();
  }, [skill.id]);

  const files = state.status === "ready" ? state.detail.files : [];
  const active = files.find((file) => skillFileKey(file) === activeFile) ?? files[0];

  return (
    <div className={settingsPageClass}>
      <header className="grid justify-items-start gap-2.5">
        <Button aria-label="Zurück zu den Beiträgen" className="rounded-full" onClick={onBack} size="icon" variant="outline"><ArrowLeftIcon /></Button>
        <span className="grid gap-1">
          <h2 className={pageTitleClass}>{skill.id}</h2>
          <p className="text-[0.73rem] text-muted-foreground">{skill.owner}{files.length > 0 && ` / ${files.length} ${files.length === 1 ? "Datei" : "Dateien"}`}</p>
        </span>
      </header>
      <SettingsSection title="Verfügbarkeit">
        <SettingsValue label="Zielgruppe" value={skill.audiences.map(skillAudienceLabel).join(", ")} />
      </SettingsSection>
      <SettingsSection title="Registrierte Pfade">
        {skill.paths.map((path) => <SettingsValue copy key={path} label="Pfad" value={path} />)}
      </SettingsSection>
      {state.status === "loading" && (
        <div className={loadStateClass}>
          <Spinner aria-hidden className="size-3" />
          Skill wird gelesen.
        </div>
      )}
      {state.status === "failed" && (
        <div className={cn(loadStateClass, "flex-col text-center text-destructive")} role="alert">
          <CircleAlertIcon size={14} />
          <strong className="text-[0.86rem] text-foreground">Skill nicht lesbar</strong>
          <span className="max-w-[560px]">{state.error}</span>
        </div>
      )}
      {state.status === "ready" && files.length === 0 && (
        <SettingsEmpty>Der Skill-Pfad enthält keine Dateien.</SettingsEmpty>
      )}
      {files.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((file) => (
            <Toggle key={skillFileKey(file)} pressed={file === active} onPressedChange={() => setActiveFile(skillFileKey(file))} size="sm" variant="outline">
              {file.path}
            </Toggle>
          ))}
        </div>
      )}
      {active && <SkillDocument file={active} />}
    </div>
  );
}

function SkillDocument({ file }: { file: SettingsSkillFile }) {
  return (
    <article className="min-w-0 rounded-xl border border-border-soft bg-background/76">
      <header className="flex items-center justify-between gap-3 border-b border-border-soft px-3 py-2.5">
        <span className={cardCopyClass}>
          <strong className={cardTitleClass}>{file.path}</strong>
          <small className="text-[0.63rem] text-muted-foreground">{formatBytes(file.bytes)}</small>
        </span>
        {file.content !== null && <CopyButton label={`${file.path} kopieren`} text={skillFileText(file)} />}
      </header>
      {file.frontMatter !== null && (
        <details className={cn(disclosureClass, "mt-3 mr-3 ml-3")}>
          <summary className={summaryClass}>
            <span className={cardCopyClass}>
              <strong className={cardTitleClass}>Frontmatter</strong>
              <small className={cardNoteClass}>Kopfdaten, die die Agentenlaufzeit aus der Datei liest</small>
            </span>
          </summary>
          <PromptCode content={file.frontMatter} copyLabel="Frontmatter kopieren" />
        </details>
      )}
      {file.content === null
        ? <SettingsEmpty className="m-3">Diese Datei ist nicht als Text darstellbar.</SettingsEmpty>
        : file.path.toLowerCase().endsWith(".md")
          ? <div className="px-4.5 pt-4 pb-5 text-[0.79rem] leading-[1.62] text-foreground"><Markdown text={file.content} /></div>
          : <div className="overflow-auto"><SourceCode className="px-4 pt-4 pb-5 text-[0.7rem] leading-[1.55]" content={file.content} path={file.path} /></div>}
    </article>
  );
}

function ModelCard({ model }: { model: SettingsModel }) {
  return (
    <article className={cn(cardClass, "grid gap-[3px] px-3.5 py-3")}>
      <strong className="truncate text-[0.79rem]">{model.label}</strong>
      <span className="truncate text-[0.67rem] text-muted-foreground">{model.provider} / {model.model}</span>
      <small className="truncate text-[0.67rem] text-muted-foreground">Treiber: {model.driver}</small>
    </article>
  );
}

function ProfileCard({ profile }: { profile: SettingsProfile }) {
  const details = profile.driver === "agent"
    ? [
        profile.driver,
        profile.provider,
        profile.model,
        ...(profile.thinking ? [`Denktiefe ${profile.thinking}`] : []),
      ]
    : [profile.driver];
  return (
    <article className={cardClass}>
      <header className={cardHeaderClass}>
        <span className={cardCopyClass}>
          <strong className={cardTitleClass}>{profile.name}</strong>
          <small className={cardNoteClass}>{details.join(" / ")}</small>
        </span>
      </header>
      <p className={cardCopyTextClass}>{profile.description}</p>
      <footer className="flex flex-wrap gap-x-3 gap-y-1.5 text-[0.64rem] text-muted-foreground">
        <span>{profile.turnTimeoutMs === null ? "Kein Turn-Timeout" : `Turn-Timeout ${formatDuration(profile.turnTimeoutMs)}`}</span>
        <span>{profile.isolateWorkspace ? "Eigener Agenten-Workspace" : "Gemeinsamer Run-Workspace"}</span>
      </footer>
    </article>
  );
}

function HookCard({ hook }: { hook: SettingsAgentHook }) {
  return (
    <article className={cn(cardClass, "grid gap-2")}>
      <header className={cardHeaderClass}>
        <span className={cardCopyClass}>
          <strong className={cardTitleClass}>{hook.id}</strong>
          <small className={cardNoteClass}>{hook.owner}</small>
        </span>
        <StatusBadge active label={hook.kind === "internal" ? "Intern" : "Plugin-Beitrag"} />
      </header>
      <SettingsValue label="Auflösung je Agent" value={hook.resolvesPerAgent ? "Ja" : "Nein"} />
      {hook.factories.length > 0 && (
        <SettingsValue
          label="Factories"
          value={hook.factories
            .map((factory) => `${factory.name} (${factory.scope})`)
            .join(", ")}
        />
      )}
    </article>
  );
}

function ToolCard({ tool }: { tool: SettingsTool }) {
  return (
    <article className={cn(cardClass, "grid gap-2.5")}>
      <header className={cardHeaderClass}>
        <span className={cardCopyClass}>
          <strong className={cardTitleClass}>{tool.name}</strong>
          <small className={cardNoteClass}>{tool.id}</small>
        </span>
        <span className={statusListClass}>
          <span className={cn(chipClass, "bg-primary/12 text-primary")}>{toolKindLabel(tool.kind)}</span>
          <span className={chipClass}>{toolAvailabilityLabel(tool.availability)}</span>
          <span className={chipClass}>{functionSurfaceLabel(tool.nativeTool)}</span>
        </span>
      </header>
      <p className={cn(cardCopyTextClass, "my-0")}>{tool.description}</p>
      <dl className="grid grid-cols-2 gap-1.5 max-md:grid-cols-1">
        {[["Eigentümer", tool.owner], ["Herkunft", tool.source], ["Scope", toolScopeLabel(tool.scope)], ["Verfügbarkeit", tool.availabilityDetail]].map(([label, value]) => (
          <div className="grid min-w-0 gap-0.5 rounded-lg border border-border-soft bg-background/68 px-2 py-1.5" key={label}>
            <dt className="text-[0.61rem] text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-[0.68rem] text-foreground [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function SettingsPage({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return (
    <div className={settingsPageClass}>
      <header>
        <h2 className={pageTitleClass}>{title}</h2>
        <p className={pageLeadClass}>{description}</p>
      </header>
      {children}
    </div>
  );
}

function SettingsSection({ children, count, panel, title }: { children: ReactNode; count?: number; panel?: boolean; title: string }) {
  const body = (
    <>
      <header className="flex min-h-6 items-center gap-2">
        <h3 className={cn("text-[0.79rem] font-bold tracking-[0.015em] text-foreground", panel && "text-[0.94rem]")}>{title}</h3>
        {count !== undefined && <span className="min-w-5 rounded-full bg-foreground/7 px-1.5 py-px text-center text-[0.62rem] text-muted-foreground">{count}</span>}
      </header>
      {children}
    </>
  );
  if (panel) return <Card className={panelSectionClass}>{body}</Card>;
  return <section className="grid gap-2.5">{body}</section>;
}

function SettingsFact({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <article className="grid min-w-0 gap-[3px] rounded-xl border border-border-soft bg-background/78 px-3.5 py-3">
      <span className="text-[0.62rem] text-muted-foreground uppercase">{label}</span>
      <strong className="truncate text-[0.91rem] text-foreground">{value}</strong>
      <small className="truncate text-[0.66rem] text-muted-foreground">{detail}</small>
    </article>
  );
}

function SettingsValue({ copy = false, label, value }: { copy?: boolean; label: string; value: string }) {
  return (
    <div className="grid min-h-[38px] grid-cols-[minmax(130px,0.28fr)_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border-soft bg-background/68 px-2.5 py-1.5 max-[520px]:grid-cols-[minmax(0,1fr)_auto]">
      <span className={cn(valueLabelClass, "max-[520px]:col-span-full")}>{label}</span>
      <code className="min-w-0 truncate font-mono text-[0.7rem] text-foreground" title={value}>{value}</code>
      {copy && <CopyButton label={`${label} kopieren`} text={value} />}
    </div>
  );
}

function PromptCode({ content, copyLabel }: { content: string; copyLabel: string }) {
  return (
    <div className="relative min-w-0">
      <CopyButton className="absolute top-2 right-2 z-1" label={copyLabel} text={content} />
      <pre className={`${preClass} max-h-[520px] px-3 pt-11 pb-3`}>{content}</pre>
    </div>
  );
}

function CopyButton({ className, label, text }: { className?: string; label: string; text: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [status]);
  const copy = () => {
    if (!navigator.clipboard) {
      setStatus("failed");
      return;
    }
    void navigator.clipboard.writeText(text)
      .then(() => setStatus("copied"))
      .catch(() => setStatus("failed"));
  };
  const statusLabel = status === "copied" ? "Kopiert" : status === "failed" ? "Nicht kopiert" : "Kopieren";
  return (
    <Button
      aria-label={label}
      className={cn("flex-shrink-0", className)}
      onClick={copy}
      size="sm"
      title={statusLabel}
      variant="outline"
    >
      {status === "copied" ? <CheckIcon /> : status === "failed" ? <CircleAlertIcon /> : <CopyIcon />}
      <span className="max-[520px]:hidden">{statusLabel}</span>
    </Button>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return <span className={cn(chipClass, active && "bg-primary/12 text-primary")}>{label}</span>;
}

function SettingsNote({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--primary)_22%,var(--border))] bg-primary/6 px-3 py-2.5 text-[0.71rem] leading-normal text-muted-foreground [&>svg]:mt-px [&>svg]:flex-shrink-0 [&>svg]:text-primary"><InfoIcon size={15} />{children}</p>;
}

function SettingsEmpty({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("rounded-lg border border-dashed border-border p-4.5 text-center text-[0.72rem] text-muted-foreground", className)}>{children}</p>;
}

const modelKey = (model: SettingsModel) => `${model.driver}/${model.provider ?? ""}/${model.model ?? ""}`;

const skillFileKey = (file: SettingsSkillFile) => `${file.root}/${file.path}`;

const skillFileText = (file: SettingsSkillFile) =>
  file.frontMatter === null ? file.content ?? "" : `---\n${file.frontMatter}\n---\n\n${file.content ?? ""}`;

const formatDuration = (milliseconds: number) => {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toLocaleString("de-DE")} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toLocaleString("de-DE")} min`;
  return `${(minutes / 60).toLocaleString("de-DE")} h`;
};

const sensitiveKey = (key: string) => /secret|token|password|credential|api.?key|authorization|cookie/i.test(key);

const sanitizedValue = (value: unknown, key = ""): unknown => {
  if (key && sensitiveKey(key)) return "[ausgeblendet]";
  if (Array.isArray(value)) return value.map((entry) => sanitizedValue(entry));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizedValue(entryValue, entryKey)]),
  );
};
