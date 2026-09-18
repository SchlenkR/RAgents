import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactNode,
  type Ref,
  type WheelEventHandler,
} from "react";
import { useAccess } from "./AccessContext";
import { unrestrictedAccess, type AccessContext } from "../../../packages/ragents/src/access";
import { DETAIL_MODES } from "./chat/DetailModeSwitch";
import type { ChatAttachmentInput, DetailMode, Message, ToolInfo } from "./chat/types";
import type { SessionInfo } from "./api";
import type { ChatUserLocation } from "../../server/src/chat-context";
import type { ChatStartupStatus } from "../../server/src/chat-events";
import { CHAT_STEP_SCOPES, type ChatStepScope } from "../../server/src/plugin-support/chat-display-contract";
import type { StartOptionState } from "../../server/src/plugin-support/start-options-contract";
import {
  type ScriptStartEntry,
  type SkillStartEntry,
  type StartEntry,
} from "../../server/src/plugin-support/start-entries-contract";

export { CHAT_STEP_SCOPES };
export type {
  ChatStepScope,
  ScriptStartEntry,
  SkillStartEntry,
  StartEntry,
  StartOptionState,
};

export interface ChatDisplayPolicy {
  modes: Readonly<Record<ChatStepScope, DetailMode>>;
  stepsVisible: boolean;
  stepsExpandable: boolean;
  selectable: boolean;
}

export const defaultChatDisplayPolicy: ChatDisplayPolicy = Object.freeze({
  modes: Object.freeze({ coordinator: "grouped" as DetailMode, agents: "grouped" as DetailMode }),
  stepsVisible: true,
  stepsExpandable: true,
  selectable: false,
});

export interface StartOptionControlContext {
  option: StartOptionState;
  disabled: boolean;
  error: string | undefined;
  setValue: (value: unknown) => Promise<void>;
}

export interface StartOptionBadgeContext {
  option: StartOptionState;
  session: SessionContext;
}

export interface StartOptionContribution {
  id: string;
  placement?: "surface" | "composer";
  Control?: ComponentType<StartOptionControlContext>;
  Badge?: ComponentType<StartOptionBadgeContext>;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface EntryGuideContext {
  entry: StartEntry;
  session: SessionContext;
  /** A skill guide returns a draft for preparation; a script guide returns its start value. */
  onComplete: (result: JsonValue) => void;
  onCancel: () => void;
}

export interface EntryGuideContribution {
  id: string;
  Guide: ComponentType<EntryGuideContext>;
}

export interface ExtensionEvent {
  pluginId: string;
  type: string;
  payload?: unknown;
  at?: string;
}

export interface SessionContext {
  centerMode: "chat" | "workflow";
  connected: boolean;
  extensionEvents: readonly ExtensionEvent[];
  messages: Message[];
  actorConversations?: Readonly<Record<string, readonly Message[]>>;
  conversationError?: string;
  respond: (callId: string, payload: unknown) => Promise<void>;
  runView: unknown;
  running: boolean;
  startup?: ChatStartupStatus;
  send: (text: string, attachments?: ChatAttachmentInput[]) => Promise<void>;
  session: SessionInfo;
  /** Starts the run through a run script entry, without a message; the value becomes the script's start input. */
  start: (entryId: string, input: JsonValue | null) => Promise<void>;
  stop: () => Promise<void>;
}

export interface EntityReference {
  type: string;
  id: string;
}

export interface CanvasController {
  acceptSelection: (selection: EntityReference | undefined) => void;
  selection: EntityReference | undefined;
  selectionRevision: number;
  tabId: string;
}

export interface ChatSurfaceOptions {
  chatElementClassName?: string;
  chatScrollerRef?: (element: HTMLDivElement | null) => void;
  nodeRef?: Ref<HTMLDivElement>;
  onComposerWheel?: WheelEventHandler<HTMLElement>;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}

export interface CanvasCenterContext {
  runToolbarContainer: HTMLElement | null;
  toolbarContainer: HTMLElement | null;
  statusContainer: HTMLElement | null;
  cardSections: readonly CardSectionContribution[];
  canvasElements: readonly CanvasElementContribution[];
  navigation: SessionNavigation;
  onCenterModeChange: (mode: SessionContext["centerMode"]) => void;
  renderChat: (options?: ChatSurfaceOptions) => ReactNode;
  session: SessionContext;
  tabIds: readonly string[];
}

export interface CanvasContribution {
  Center: ComponentType<CanvasCenterContext>;
  /** Schmale Arbeitsspalte (column.html) mit demselben Kontext; ohne Beitrag zeigt die Spalte nur den Chat. */
  Column?: ComponentType<CanvasCenterContext>;
  tabId: string;
}

export interface CanvasElementDefinition {
  id: string;
  visible?: boolean;
  title?: string;
  width: number;
  height: number;
  collapsedHeight?: number;
  anchorActorId?: string;
  entity?: EntityReference;
  resizable?: {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
  };
  data?: unknown;
}

export interface CanvasElementContext {
  definition: CanvasElementDefinition;
  presentation?: "canvas" | "tiled";
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  navigation: SessionNavigation;
  session: SessionContext;
}

export interface CanvasElementContribution {
  id: string;
  order: number;
  select: (session: SessionContext) => readonly CanvasElementDefinition[];
  Element: ComponentType<CanvasElementContext>;
}

export interface NavigationTarget {
  tabId: string;
  selection?: unknown;
}

export interface SessionNavigation {
  activeTabId: string;
  openTab: (tabId: string, selection?: unknown) => void;
  revealEntity: (entity: EntityReference) => boolean;
  selectionFor: (tabId: string) => unknown;
}

export interface CardSectionContext {
  actor: unknown;
  navigation: SessionNavigation;
  session: SessionContext;
}

export interface CardSectionContribution {
  id: string;
  order: number;
  Section: ComponentType<CardSectionContext>;
}

export interface WorkspaceTabContext {
  active: boolean;
  navigation: SessionNavigation;
  selection: unknown;
  session: SessionContext;
}

export interface WorkspaceTabContribution {
  readRight?: string;
  id: string;
  label: string;
  order: number;
  Icon: ComponentType;
  Panel: ComponentType<WorkspaceTabContext>;
  Badge?: ComponentType<WorkspaceTabContext>;
  available?: (session: SessionContext) => boolean;
  keepMounted?: boolean;
}

export interface SessionHeaderContext {
  navigation: SessionNavigation;
  session: SessionContext;
}

export interface SessionHeaderContribution {
  readRight?: string;
  placement?: "header" | "canvas";
  id: string;
  order: number;
  Header: ComponentType<SessionHeaderContext>;
}

export interface SessionStatusContribution {
  readRight?: string;
  id: string;
  order: number;
  Status: ComponentType<SessionHeaderContext>;
}

/** A persistent application contribution in the overview or toolbar. */
export interface OverviewPanelContext {
  registry: PluginRegistry;
  userLocation?: ChatUserLocation;
  /** Whether this contribution is open. */
  open: boolean;
  /** Reports running work; overview entries appear on the corner button. */
  onBusy: (busy: boolean) => void;
  onOpen: () => void;
  onClose: () => void;
}

export interface OverviewPanelContribution {
  placement?: "overview" | "toolbar";
  id: string;
  order: number;
  /** Right a user needs to see the panel; without it the panel is shown to everyone. */
  readRight?: string;
  Panel: ComponentType<OverviewPanelContext>;
}

export interface SettingsContribution {
  category?: "models" | "appearance";
  readRight?: string;
  id: string;
  label: string;
  order?: number;
  Settings: ComponentType;
}

export interface ToolPresenterContext {
  navigation: SessionNavigation;
  session: SessionContext;
  tool: ToolInfo;
}

export interface ToolPresenterContribution {
  toolName: string;
  Inline?: ComponentType<ToolPresenterContext>;
  reveal?: (tool: ToolInfo, session: SessionContext) => NavigationTarget | undefined;
}

export interface EntityPresenterContribution {
  reveal: (entity: EntityReference, session: SessionContext) => NavigationTarget | undefined;
}

export interface SessionMetadataContext {
  placement: "header" | "list";
  session: SessionInfo;
}

export interface SessionMetadataContribution {
  id: string;
  order: number;
  Metadata: ComponentType<SessionMetadataContext>;
}

export interface AttentionState {
  active: true;
  label: string;
}

export interface AttentionContribution {
  id: string;
  assess: (session: SessionContext) => AttentionState | undefined;
}

export interface SessionProviderProps extends PropsWithChildren {
  navigation: SessionNavigation;
  session: SessionContext;
}

export interface WebPluginDescriptor {
  id: string;
}

export interface WebPlugin extends WebPluginDescriptor {
  activate?: (config: Readonly<Record<string, unknown>>) => WebPlugin;
  enabled?: (config: Readonly<Record<string, unknown>>) => boolean;
  brand?: ProductBrand;
  canvas?: CanvasContribution;
  canvasElements?: CanvasElementContribution[];
  cardSections?: CardSectionContribution[];
  chatDisplayPolicy?: ChatDisplayPolicy;
  startOptions?: StartOptionContribution[];
  needsRunView?: boolean;
  SessionProvider?: ComponentType<SessionProviderProps>;
  sessionHeaders?: SessionHeaderContribution[];
  sessionStatus?: SessionStatusContribution[];
  overviewPanels?: OverviewPanelContribution[];
  settings?: SettingsContribution[];
  workspaceTabs?: WorkspaceTabContribution[];
  workspaceTabsFor?: (session: SessionContext) => readonly WorkspaceTabContribution[];
  toolPresenters?: ToolPresenterContribution[];
  entityPresenters?: EntityPresenterContribution[];
  guides?: EntryGuideContribution[];
  sessionMetadata?: SessionMetadataContribution[];
  questionResponder?: (session: { id: string }, callId: string, payload: unknown) => Promise<void>;
  attention?: AttentionContribution[];
}

export interface ProductBrand {
  title: string;
  Logo?: ComponentType;
}

export interface ProductDescriptor {
  id: string;
  title: string;
}

export interface ProductProfile {
  brand?: ProductBrand;
  plugins: WebPlugin[];
  product: ProductDescriptor;
  startEntries: readonly StartEntry[];
}

export class PluginRegistry {
  readonly brand: ProductBrand;
  readonly canvas: CanvasContribution | undefined;
  readonly canvasElements: readonly CanvasElementContribution[];
  readonly cardSections: readonly CardSectionContribution[];
  readonly chatDisplayPolicy: ChatDisplayPolicy;
  readonly startOptions: ReadonlyMap<string, StartOptionContribution>;
  readonly activePlugins: readonly WebPlugin[];
  readonly plugins: readonly WebPlugin[];
  readonly workspaceTabs: readonly WorkspaceTabContribution[];
  readonly workspaceTabFactories: readonly NonNullable<WebPlugin["workspaceTabsFor"]>[];
  readonly toolPresenters: ReadonlyMap<string, ToolPresenterContribution>;
  readonly entityPresenters: readonly EntityPresenterContribution[];
  readonly needsRunView: boolean;
  readonly startEntries: readonly StartEntry[];
  readonly skillEntries: readonly SkillStartEntry[];
  readonly scriptEntries: readonly ScriptStartEntry[];
  readonly guides: ReadonlyMap<string, EntryGuideContribution>;
  readonly sessionHeaders: readonly SessionHeaderContribution[];
  readonly sessionStatus: readonly SessionStatusContribution[];
  readonly overviewPanels: readonly OverviewPanelContribution[];
  readonly settings: readonly (SettingsContribution & { owner: string })[];
  readonly sessionMetadata: readonly SessionMetadataContribution[];
  readonly questionResponder: WebPlugin["questionResponder"];
  readonly attention: readonly AttentionContribution[];

  constructor(
    readonly profile: ProductProfile,
    configurations?: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ) {
    assertUnique(profile.plugins, (plugin) => plugin.id, "Plugin");
    this.plugins = configurations === undefined
      ? [...profile.plugins]
      : profile.plugins.map((plugin) => activatePlugin(plugin, configurations.get(plugin.id) ?? {}));
    this.activePlugins = this.plugins.filter((plugin) =>
      plugin.enabled?.(configurations?.get(plugin.id) ?? {}) ?? true);
    const brands = [profile.brand, ...this.activePlugins.map((plugin) => plugin.brand)]
      .filter((brand): brand is ProductBrand => brand !== undefined);
    if (brands.length === 0) {
      throw new Error("Kein aktives Plugin liefert ein Branding; die Plugin-Liste enthält kein Produkt-Plugin");
    }
    if (brands.length > 1) throw new Error(`Das Produktprofil benötigt genau ein Branding, gefunden: ${brands.length}`);
    this.brand = brands[0];
    this.workspaceTabs = this.activePlugins
      .flatMap((plugin) => plugin.workspaceTabs ?? [])
      .sort(byTabOrder);
    assertUnique(this.workspaceTabs, (tab) => tab.id, "Arbeitsbereichs-Tab");
    this.workspaceTabFactories = this.activePlugins
      .flatMap((plugin) => plugin.workspaceTabsFor ? [plugin.workspaceTabsFor] : []);
    const canvases = this.activePlugins.flatMap((plugin) => plugin.canvas ? [plugin.canvas] : []);
    if (canvases.length > 1) throw new Error(`Mehrere Canvas-Beiträge registriert: ${canvases.length}`);
    this.canvas = canvases[0];
    this.canvasElements = this.activePlugins
      .flatMap((plugin) => plugin.canvasElements ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.canvasElements, (element) => element.id, "Canvas-Element-Beitrag");
    this.cardSections = this.activePlugins
      .flatMap((plugin) => plugin.cardSections ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.cardSections, (section) => section.id, "Karten-Abschnitt");
    if (this.canvas && !this.workspaceTabs.some((tab) => tab.id === this.canvas?.tabId)) {
      throw new Error(`Canvas-Tab ist nicht registriert: ${this.canvas.tabId}`);
    }
    this.needsRunView = this.activePlugins.some((plugin) => plugin.needsRunView);
    const chatPolicies = this.activePlugins.flatMap((plugin) => plugin.chatDisplayPolicy ? [plugin.chatDisplayPolicy] : []);
    if (chatPolicies.length > 1) throw new Error(`Mehrere Chat-Display-Policies registriert: ${chatPolicies.length}`);
    this.chatDisplayPolicy = chatPolicies[0] ?? defaultChatDisplayPolicy;
    const startOptions = this.activePlugins.flatMap((plugin) => plugin.startOptions ?? []);
    assertUnique(startOptions, (option) => option.id, "Startoption");
    this.startOptions = new Map(startOptions.map((option) => [option.id, option]));

    const toolPresenters = this.activePlugins.flatMap((plugin) => plugin.toolPresenters ?? []);
    assertUnique(toolPresenters, (presenter) => presenter.toolName, "Tool-Presenter");
    this.toolPresenters = new Map(toolPresenters.map((presenter) => [presenter.toolName, presenter]));
    this.entityPresenters = this.activePlugins.flatMap((plugin) => plugin.entityPresenters ?? []);
    const active = new Set(this.activePlugins.map((plugin) => plugin.id));
    this.startEntries = profile.startEntries.filter((entry) => active.has(entry.owner));
    assertUnique(this.startEntries, (entry) => entry.id, "Einstieg");
    this.skillEntries = this.startEntries.filter((entry): entry is SkillStartEntry => entry.action === "skill");
    this.scriptEntries = this.startEntries.filter((entry): entry is ScriptStartEntry => entry.action === "script");
    const guides = this.activePlugins.flatMap((plugin) => plugin.guides ?? []);
    assertUnique(guides, (guide) => guide.id, "Leitfaden");
    this.guides = new Map(guides.map((guide) => [guide.id, guide]));
    for (const entry of this.startEntries) {
      if (entry.guide !== undefined && !this.guides.has(entry.guide)) {
        throw new Error(`Einstieg ${entry.id} verlangt den Leitfaden ${entry.guide}, den kein aktives Plugin bereitstellt`);
      }
    }
    this.sessionHeaders = this.activePlugins
      .flatMap((plugin) => plugin.sessionHeaders ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.sessionHeaders, (header) => header.id, "Session-Kopfbeitrag");
    this.sessionStatus = this.activePlugins
      .flatMap((plugin) => plugin.sessionStatus ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.sessionStatus, (status) => status.id, "Session-Statusbeitrag");
    this.overviewPanels = this.activePlugins
      .flatMap((plugin) => plugin.overviewPanels ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.overviewPanels, (panel) => panel.id, "Übersichtsbeitrag");
    this.settings = this.activePlugins
      .flatMap((plugin) => (plugin.settings ?? []).map((contribution) => ({ ...contribution, owner: plugin.id })))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
    assertUnique(this.settings, (contribution) => contribution.id, "Einstellungsbeitrag");
    this.sessionMetadata = this.activePlugins
      .flatMap((plugin) => plugin.sessionMetadata ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.sessionMetadata, (metadata) => metadata.id, "Session-Metadaten");
    const responders = this.activePlugins
      .flatMap((plugin) => plugin.questionResponder ? [plugin.questionResponder] : []);
    if (responders.length > 1) throw new Error(`Mehrere Question-Responder registriert: ${responders.length}`);
    this.questionResponder = responders[0];
    this.attention = this.activePlugins.flatMap((plugin) => plugin.attention ?? []);
    assertUnique(this.attention, (contribution) => contribution.id, "Attention-Beitrag");
  }

  registeredTabs(session: SessionContext, access: AccessContext = unrestrictedAccess): readonly WorkspaceTabContribution[] {
    if (this.workspaceTabFactories.length === 0) return this.workspaceTabs.filter((tab) => !tab.readRight || access.can(tab.readRight));
    const contributed = this.workspaceTabFactories.flatMap((factory) => factory(session));
    const tabs = [...this.workspaceTabs, ...contributed].sort(byTabOrder);
    assertUnique(tabs, (tab) => tab.id, "Arbeitsbereichs-Tab");
    return tabs.filter((tab) => !tab.readRight || access.can(tab.readRight));
  }

  availableTabs(session: SessionContext, access: AccessContext = unrestrictedAccess): readonly WorkspaceTabContribution[] {
    return this.registeredTabs(session, access).filter((tab) => tab.available?.(session) ?? true);
  }

  guideFor(entry: StartEntry): EntryGuideContribution | undefined {
    return entry.guide === undefined ? undefined : this.guides.get(entry.guide);
  }

  presenterFor(tool: ToolInfo): ToolPresenterContribution | undefined {
    return this.toolPresenters.get(tool.name);
  }

  targetForEntity(entity: EntityReference, session: SessionContext): NavigationTarget | undefined {
    return this.entityPresenters
      .map((presenter) => presenter.reveal(entity, session))
      .find((target) => target !== undefined);
  }
}

export const pluginRoutePrefixFrom = (
  pluginId: string,
  config: Readonly<Record<string, unknown>>,
): string => {
  const expected = `/api/plugins/${pluginId}`;
  if (config.routePrefix === undefined) {
    throw new Error(`Plugin-Konfiguration für ${pluginId} enthält keinen routePrefix`);
  }
  if (config.routePrefix !== expected) {
    throw new Error(
      `Plugin-Konfiguration für ${pluginId} enthält einen falschen routePrefix: `
      + `${String(config.routePrefix)} statt ${expected}`,
    );
  }
  return config.routePrefix;
};

export const chatDisplayPolicyFrom = (
  pluginId: string,
  config: Readonly<Record<string, unknown>>,
): ChatDisplayPolicy => {
  const raw = config.chatSteps;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Plugin-Konfiguration für ${pluginId} enthält kein chatSteps-Objekt`);
  }
  const { modes, stepsVisible, stepsExpandable, selectable } = raw as Record<string, unknown>;
  if (typeof stepsVisible !== "boolean" || typeof stepsExpandable !== "boolean" || typeof selectable !== "boolean") {
    throw new Error(
      `chatSteps von ${pluginId} braucht boolesche Felder stepsVisible, stepsExpandable und selectable`,
    );
  }
  if (typeof modes !== "object" || modes === null || Array.isArray(modes)) {
    throw new Error(`chatSteps von ${pluginId} enthält kein modes-Objekt`);
  }
  const entries = CHAT_STEP_SCOPES.map((scope) => {
    const mode = (modes as Record<string, unknown>)[scope];
    if (!DETAIL_MODES.includes(mode as DetailMode)) {
      throw new Error(
        `chatSteps.modes.${scope} von ${pluginId} muss einer der Werte ${DETAIL_MODES.join(", ")} sein, `
        + `nicht ${String(mode)}`,
      );
    }
    return [scope, mode as DetailMode] as const;
  });
  return {
    modes: Object.fromEntries(entries) as Record<ChatStepScope, DetailMode>,
    stepsVisible,
    stepsExpandable,
    selectable,
  };
};

export interface ChatStepsControl {
  readonly selectable: boolean;
  readonly stepsExpandable: boolean;
  mode: (scope: ChatStepScope, identity?: string) => DetailMode;
  setMode: (scope: ChatStepScope, mode: DetailMode, identity?: string) => void;
}

const storageKeyFor = (scope: ChatStepScope, prefix: string) => `${prefix}.${scope}`;

const storedModes = (prefix: string): Partial<Record<ChatStepScope, DetailMode>> =>
  Object.fromEntries(
    CHAT_STEP_SCOPES
      .map((scope) => [scope, window.localStorage.getItem(storageKeyFor(scope, prefix))] as const)
      .filter(([, stored]) => stored !== null && DETAIL_MODES.includes(stored as DetailMode)),
  );

const PUBLIC_DETAIL_MODES: readonly DetailMode[] = ["off", "current", "icons", "chips"];

const defaultChatStepsControl: ChatStepsControl = {
  selectable: false,
  stepsExpandable: defaultChatDisplayPolicy.stepsExpandable,
  mode: (scope) => defaultChatDisplayPolicy.modes[scope],
  setMode: () => {},
};

const ChatStepsContext = createContext<ChatStepsControl>(defaultChatStepsControl);

export function ChatStepsProvider({ children, policy, storageKeyPrefix = "ragents.chat-steps" }: PropsWithChildren<{
  policy: ChatDisplayPolicy;
  storageKeyPrefix?: string;
}>) {
  const access = useAccess();
  const trace = access.can("runs.inspect") || access.can("runs.trace");
  const [chosen, setChosen] = useState<Partial<Record<string, DetailMode>>>(
    () => trace && policy.selectable ? storedModes(storageKeyPrefix) : {});
  const control = useMemo<ChatStepsControl>(() => ({
    selectable: trace && policy.selectable && policy.stepsVisible,
    stepsExpandable: trace && policy.stepsExpandable,
    mode: (scope, identity) => {
      if (!policy.stepsVisible) return "off";
      if (!trace) return PUBLIC_DETAIL_MODES.includes(policy.modes[scope]) ? policy.modes[scope] : "current";
      const key = identity === undefined ? scope : `chat.${encodeURIComponent(identity)}`;
      const stored = identity !== undefined && typeof window !== "undefined" ? window.localStorage.getItem(`${storageKeyPrefix}.${key}`) : undefined;
      return chosen[key] ?? (stored && DETAIL_MODES.includes(stored as DetailMode) ? stored as DetailMode : undefined) ?? policy.modes[scope];
    },
    setMode: (scope, mode, identity) => {
      const key = identity === undefined ? scope : `chat.${encodeURIComponent(identity)}`;
      window.localStorage.setItem(`${storageKeyPrefix}.${key}`, mode);
      setChosen((current) => ({ ...current, [key]: mode }));
    },
  }), [trace, policy, chosen, storageKeyPrefix]);
  return <ChatStepsContext.Provider value={control}>{children}</ChatStepsContext.Provider>;
}

export function primaryChatActor(view: unknown): string {
  return view !== null && typeof view === "object" && "primaryActorId" in view && typeof view.primaryActorId === "string" ? view.primaryActorId : "primary";
}

/** surface unterscheidet Anzeigeflächen desselben Chats (Canvas, Inspector, Popout); jede merkt sich ihren Detailgrad. */
export function useChatSteps(runId?: string, actorId = "primary", surface?: string): ChatStepsControl {
  const control = useContext(ChatStepsContext);
  const identity = runId === undefined ? undefined : JSON.stringify(surface === undefined ? [runId, actorId] : [runId, actorId, surface]);
  return useMemo(() => ({
    selectable: control.selectable,
    stepsExpandable: control.stepsExpandable,
    mode: (scope: ChatStepScope) => control.mode(scope, identity),
    setMode: (scope: ChatStepScope, mode: DetailMode) => control.setMode(scope, mode, identity),
  }), [control, identity]);
}

const CanvasControllerContext = createContext<CanvasController | undefined>(undefined);

export function CanvasControllerProvider({ children, value }: PropsWithChildren<{ value: CanvasController }>) {
  return <CanvasControllerContext.Provider value={value}>{children}</CanvasControllerContext.Provider>;
}

export const useCanvasController = () => useContext(CanvasControllerContext);

const ToolRendererContext = createContext<(tool: ToolInfo) => ReactNode>(() => undefined);

export const useToolRenderer = () => useContext(ToolRendererContext);

export function PluginSessionProviders({
  children,
  navigation,
  registry,
  session,
}: PropsWithChildren<{
  navigation: SessionNavigation;
  registry: PluginRegistry;
  session: SessionContext;
}>) {
  const renderTool = useMemo(() => (tool: ToolInfo) => {
    const Inline = registry.presenterFor(tool)?.Inline;
    return Inline ? <Inline navigation={navigation} session={session} tool={tool} /> : undefined;
  }, [registry, navigation, session]);
  const content = registry.activePlugins.reduceRight<ReactNode>((content, plugin) => {
    if (!plugin.SessionProvider) return content;
    return createElement(plugin.SessionProvider, { key: plugin.id, navigation, session }, content);
  }, children);
  return <ToolRendererContext.Provider value={renderTool}>{content}</ToolRendererContext.Provider>;
}

const byTabOrder = (left: WorkspaceTabContribution, right: WorkspaceTabContribution): number =>
  left.order - right.order || left.id.localeCompare(right.id);

const assertUnique = <T,>(values: readonly T[], keyOf: (value: T) => string, label: string) => {
  const keys = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (!key) throw new Error(`${label} ohne ID`);
    if (keys.has(key)) throw new Error(`${label} doppelt registriert: ${key}`);
    keys.add(key);
  }
};

const activatePlugin = (plugin: WebPlugin, config: Readonly<Record<string, unknown>>): WebPlugin => {
  let activated: WebPlugin;
  try {
    activated = plugin.activate?.(config) ?? plugin;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`Plugin-Aktivierung fehlgeschlagen: ${plugin.id}: ${message}`);
  }
  if (activated.id !== plugin.id) {
    throw new Error(`Plugin-Aktivierung hat den Descriptor verändert: ${plugin.id}`);
  }
  return activated;
};
