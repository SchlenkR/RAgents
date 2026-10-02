import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useAccess } from "./AccessContext";
import { unrestrictedAccess, type AccessContext } from "../../../packages/ragents/src/access";
import { DETAIL_MODES, type ChatAttachmentInput, type DetailMode, type Message, type PendingAction, type ToolInfo, type ChatStartupStatus } from "quassel";
import type { SessionInfo } from "./api";
import type { ChatUserLocation } from "../../server/src/chat-context";
import { CHAT_STEP_SCOPES, type ChatStepScope } from "../../server/src/plugin-support/chat-display-contract";
import type { StartOptionState } from "../../server/src/plugin-support/start-options-contract";
import type { OfferedMachines } from "./offered-machines";
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
  /** Which machines the host offers for new runs; an option with a machine choice shows only these. */
  machines: OfferedMachines;
}

export interface StartOptionBadgeContext {
  option: StartOptionState;
  session: SessionContext;
}

export interface StartOptionContribution {
  id: string;
  placement?: "page" | "composer";
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

export interface PluginEvent {
  pluginId: string;
  type: string;
  payload?: unknown;
  at?: string;
}

export interface SessionContext {
  connected: boolean;
  pluginEvents: readonly PluginEvent[];
  messages: Message[];
  actorConversations?: Readonly<Record<string, readonly Message[]>>;
  conversationError?: string;
  runView: unknown;
  running: boolean;
  startup?: ChatStartupStatus;
  /** With entryId the message starts the run through this skill template and the start options it fixes. */
  send: (text: string, attachments?: ChatAttachmentInput[], entryId?: string) => Promise<void>;
  session: SessionInfo;
  /** Starts the run through a run script entry, without a message; the value becomes the script's start input. */
  start: (entryId: string, input: JsonValue | null) => Promise<void>;
}

export interface EntityReference {
  type: string;
  id: string;
}

/** The selected actor or mini-app, reported as the current run location. */
export interface SurfaceController {
  acceptSelection: (selection: EntityReference | undefined) => void;
  selection: EntityReference | undefined;
}

export interface ChatDisplayOptions {
  autoFocus?: boolean;
  chatElementClassName?: string;
  chatScrollerRef?: (element: HTMLDivElement | null) => void;
  toolbarLeft?: ReactNode;
  /** Shown instead of the history while set; the input stays usable. */
  notice?: ReactNode;
}

export interface SurfaceCenterContext {
  autoFocusChat?: boolean;
  onAutoFocusChatSettled?: () => void;
  toolbarContainer: HTMLElement | null;
  statusContainer: HTMLElement | null;
  cardSections: readonly CardSectionContribution[];
  surfaceElements: readonly SurfaceElementContribution[];
  navigation: SessionNavigation;
  renderChat: (options?: ChatDisplayOptions) => ReactNode;
  session: SessionContext;
  tabIds: readonly string[];
}

export interface SurfaceContribution {
  RunPanel: ComponentType<SurfaceCenterContext>;
}

export interface SurfaceElementDefinition {
  id: string;
  visible?: boolean;
  title?: string;
  anchorActorId?: string;
  entity?: EntityReference;
  data?: unknown;
}

export interface SurfaceElementContext {
  definition: SurfaceElementDefinition;
  navigation: SessionNavigation;
  session: SessionContext;
}

export interface SurfaceElementContribution {
  id: string;
  order: number;
  select: (session: SessionContext) => readonly SurfaceElementDefinition[];
  Element: ComponentType<SurfaceElementContext>;
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
  hosts?: readonly ("browser" | "vscode")[];
  readRight?: string;
  id: string;
  label: string;
  order: number;
  Icon: ComponentType;
  Panel: ComponentType<WorkspaceTabContext>;
  Header?: ComponentType<WorkspaceTabContext>;
  Badge?: ComponentType<WorkspaceTabContext>;
  available?: (session: SessionContext) => boolean;
  /** The tab needs the run's workspace and is missing where the viewer cannot reach it. */
  requiresWorkspace?: boolean;
  keepMounted?: boolean;
}

export interface SessionHeaderContext {
  navigation: SessionNavigation;
  session: SessionContext;
}

export interface SessionHeaderContribution {
  /** In the run details popover (default) or in the run's title bar next to Share. */
  placement?: "details" | "bar";
  readRight?: string;
  /** The contribution needs the run's workspace and is missing where the viewer cannot reach it. */
  requiresWorkspace?: boolean;
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

/** A persistent application contribution in the overview, in the toolbar, or in the main area while no run is open (idle). */
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

/** Run metadata in the run header; the run list draws its lines from the server's listDetail. */
export interface SessionMetadataContext {
  session: SessionInfo;
}

export interface SessionMetadataContribution {
  id: string;
  order: number;
  Metadata: ComponentType<SessionMetadataContext>;
}

/** How a waiting action is shown by the plugin that owns it. */
export interface ActionViewContext {
  action: PendingAction;
  text: string;
  session: SessionContext;
}

export interface ActionViewContribution {
  owner: string;
  View: ComponentType<ActionViewContext>;
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
  surface?: SurfaceContribution;
  surfaceElements?: SurfaceElementContribution[];
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
  actionViews?: ActionViewContribution[];
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
  /** The template the start selection shows first instead of New chat; the server names it only if it also delivers it. */
  defaultStartEntry?: string;
}

/** The interface shows a run the server has not listed yet as reachable; the server checks every access itself. */
export const workspaceAccessible = (session: SessionInfo): boolean => session.workspaceAccessible !== false;

export class PluginRegistry {
  readonly brand: ProductBrand;
  readonly surface: SurfaceContribution | undefined;
  readonly surfaceElements: readonly SurfaceElementContribution[];
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
  readonly defaultStartEntry: string | undefined;
  readonly skillEntries: readonly SkillStartEntry[];
  readonly scriptEntries: readonly ScriptStartEntry[];
  readonly guides: ReadonlyMap<string, EntryGuideContribution>;
  readonly sessionHeaders: readonly SessionHeaderContribution[];
  readonly sessionStatus: readonly SessionStatusContribution[];
  readonly overviewPanels: readonly OverviewPanelContribution[];
  readonly settings: readonly (SettingsContribution & { owner: string })[];
  readonly sessionMetadata: readonly SessionMetadataContribution[];
  readonly actionViews: ReadonlyMap<string, ActionViewContribution>;
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
      throw new Error("No active plugin provides branding; the plugin list contains no product plugin");
    }
    if (brands.length > 1) throw new Error(`The profile needs exactly one branding, found: ${brands.length}`);
    this.brand = brands[0];
    this.workspaceTabs = this.activePlugins
      .flatMap((plugin) => plugin.workspaceTabs ?? [])
      .sort(byTabOrder);
    assertUnique(this.workspaceTabs, (tab) => tab.id, "Sidebar tab");
    this.workspaceTabFactories = this.activePlugins
      .flatMap((plugin) => plugin.workspaceTabsFor ? [plugin.workspaceTabsFor] : []);
    const surfaces = this.activePlugins.flatMap((plugin) => plugin.surface ? [plugin.surface] : []);
    if (surfaces.length > 1) throw new Error(`Multiple surface contributions registered: ${surfaces.length}`);
    this.surface = surfaces[0];
    this.surfaceElements = this.activePlugins
      .flatMap((plugin) => plugin.surfaceElements ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.surfaceElements, (element) => element.id, "Surface element contribution");
    this.cardSections = this.activePlugins
      .flatMap((plugin) => plugin.cardSections ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.cardSections, (section) => section.id, "Card section");
    this.needsRunView = this.activePlugins.some((plugin) => plugin.needsRunView);
    const chatPolicies = this.activePlugins.flatMap((plugin) => plugin.chatDisplayPolicy ? [plugin.chatDisplayPolicy] : []);
    if (chatPolicies.length > 1) throw new Error(`Multiple chat display policies registered: ${chatPolicies.length}`);
    this.chatDisplayPolicy = chatPolicies[0] ?? defaultChatDisplayPolicy;
    const startOptions = this.activePlugins.flatMap((plugin) => plugin.startOptions ?? []);
    assertUnique(startOptions, (option) => option.id, "Start option");
    this.startOptions = new Map(startOptions.map((option) => [option.id, option]));

    const toolPresenters = this.activePlugins.flatMap((plugin) => plugin.toolPresenters ?? []);
    assertUnique(toolPresenters, (presenter) => presenter.toolName, "Tool presenter");
    this.toolPresenters = new Map(toolPresenters.map((presenter) => [presenter.toolName, presenter]));
    this.entityPresenters = this.activePlugins.flatMap((plugin) => plugin.entityPresenters ?? []);
    const active = new Set(this.activePlugins.map((plugin) => plugin.id));
    this.startEntries = profile.startEntries.filter((entry) => active.has(entry.owner));
    assertUnique(this.startEntries, (entry) => entry.id, "Template");
    if (profile.defaultStartEntry !== undefined && !this.startEntries.some((entry) => entry.id === profile.defaultStartEntry)) {
      throw new Error(`The default template ${profile.defaultStartEntry} is not a template of an active plugin`);
    }
    this.defaultStartEntry = profile.defaultStartEntry;
    this.skillEntries = this.startEntries.filter((entry): entry is SkillStartEntry => entry.action === "skill");
    this.scriptEntries = this.startEntries.filter((entry): entry is ScriptStartEntry => entry.action === "script");
    const guides = this.activePlugins.flatMap((plugin) => plugin.guides ?? []);
    assertUnique(guides, (guide) => guide.id, "Guide");
    this.guides = new Map(guides.map((guide) => [guide.id, guide]));
    for (const entry of this.startEntries) {
      if (entry.guide !== undefined && !this.guides.has(entry.guide)) {
        throw new Error(`Template ${entry.id} requires the guide ${entry.guide}, which no active plugin provides`);
      }
    }
    this.sessionHeaders = this.activePlugins
      .flatMap((plugin) => plugin.sessionHeaders ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.sessionHeaders, (header) => header.id, "Session header contribution");
    this.sessionStatus = this.activePlugins
      .flatMap((plugin) => plugin.sessionStatus ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.sessionStatus, (status) => status.id, "Session status contribution");
    this.overviewPanels = this.activePlugins
      .flatMap((plugin) => plugin.overviewPanels ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.overviewPanels, (panel) => panel.id, "Overview contribution");
    this.settings = this.activePlugins
      .flatMap((plugin) => (plugin.settings ?? []).map((contribution) => ({ ...contribution, owner: plugin.id })))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
    assertUnique(this.settings, (contribution) => contribution.id, "Settings contribution");
    this.sessionMetadata = this.activePlugins
      .flatMap((plugin) => plugin.sessionMetadata ?? [])
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    assertUnique(this.sessionMetadata, (metadata) => metadata.id, "Session metadata");
    const actionViews = this.activePlugins.flatMap((plugin) => plugin.actionViews ?? []);
    assertUnique(actionViews, (view) => view.owner, "Action view");
    this.actionViews = new Map(actionViews.map((view) => [view.owner, view]));
    this.attention = this.activePlugins.flatMap((plugin) => plugin.attention ?? []);
    assertUnique(this.attention, (contribution) => contribution.id, "Attention contribution");
  }

  registeredTabs(session: SessionContext, access: AccessContext = unrestrictedAccess): readonly WorkspaceTabContribution[] {
    if (this.workspaceTabFactories.length === 0) return this.workspaceTabs.filter((tab) => !tab.readRight || access.can(tab.readRight));
    const contributed = this.workspaceTabFactories.flatMap((factory) => factory(session));
    const tabs = [...this.workspaceTabs, ...contributed].sort(byTabOrder);
    assertUnique(tabs, (tab) => tab.id, "Sidebar tab");
    return tabs.filter((tab) => !tab.readRight || access.can(tab.readRight));
  }

  availableTabs(session: SessionContext, access: AccessContext = unrestrictedAccess): readonly WorkspaceTabContribution[] {
    return this.registeredTabs(session, access)
      .filter((tab) => (!tab.requiresWorkspace || workspaceAccessible(session.session)) && (tab.available?.(session) ?? true));
  }

  headersFor(session: SessionContext, access: AccessContext): readonly SessionHeaderContribution[] {
    return this.sessionHeaders.filter((entry) => (!entry.readRight || access.can(entry.readRight))
      && (!entry.requiresWorkspace || workspaceAccessible(session.session)));
  }

  guideFor(entry: StartEntry): EntryGuideContribution | undefined {
    return entry.guide === undefined ? undefined : this.guides.get(entry.guide);
  }

  presenterFor(tool: ToolInfo): ToolPresenterContribution | undefined {
    return this.toolPresenters.get(tool.name);
  }

  actionViewFor(owner: string | null): ActionViewContribution | undefined {
    return owner === null ? undefined : this.actionViews.get(owner);
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
    throw new Error(`Plugin configuration for ${pluginId} has no routePrefix`);
  }
  if (config.routePrefix !== expected) {
    throw new Error(
      `Plugin configuration for ${pluginId} has a wrong routePrefix: `
      + `${String(config.routePrefix)} instead of ${expected}`,
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
    throw new Error(`Plugin configuration for ${pluginId} has no chatSteps object`);
  }
  const { modes, stepsVisible, stepsExpandable, selectable } = raw as Record<string, unknown>;
  if (typeof stepsVisible !== "boolean" || typeof stepsExpandable !== "boolean" || typeof selectable !== "boolean") {
    throw new Error(
      `chatSteps of ${pluginId} needs the boolean fields stepsVisible, stepsExpandable and selectable`,
    );
  }
  if (typeof modes !== "object" || modes === null || Array.isArray(modes)) {
    throw new Error(`chatSteps of ${pluginId} has no modes object`);
  }
  const entries = CHAT_STEP_SCOPES.map((scope) => {
    const mode = (modes as Record<string, unknown>)[scope];
    if (!DETAIL_MODES.includes(mode as DetailMode)) {
      throw new Error(
        `chatSteps.modes.${scope} of ${pluginId} must be one of the values ${DETAIL_MODES.join(", ")}, `
        + `not ${String(mode)}`,
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

/** display distinguishes places that show the same chat (surface, inspector, pop-out); each remembers its detail level. */
export function useChatSteps(runId?: string, actorId = "primary", display?: string): ChatStepsControl {
  const control = useContext(ChatStepsContext);
  const identity = runId === undefined ? undefined : JSON.stringify(display === undefined ? [runId, actorId] : [runId, actorId, display]);
  return useMemo(() => ({
    selectable: control.selectable,
    stepsExpandable: control.stepsExpandable,
    mode: (scope: ChatStepScope) => control.mode(scope, identity),
    setMode: (scope: ChatStepScope, mode: DetailMode) => control.setMode(scope, mode, identity),
  }), [control, identity]);
}

const SurfaceControllerContext = createContext<SurfaceController | undefined>(undefined);

export function SurfaceControllerProvider({ children, value }: PropsWithChildren<{ value: SurfaceController }>) {
  return <SurfaceControllerContext.Provider value={value}>{children}</SurfaceControllerContext.Provider>;
}

export const useSurfaceController = () => useContext(SurfaceControllerContext);

const ToolRendererContext = createContext<(tool: ToolInfo) => ReactNode>(() => undefined);

export const useToolRenderer = () => useContext(ToolRendererContext);

const ActionRendererContext = createContext<(action: PendingAction, text: string) => ReactNode>(() => undefined);

export const useActionRenderer = () => useContext(ActionRendererContext);

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
  const renderAction = useMemo(() => (action: PendingAction, text: string) => {
    const View = registry.actionViewFor(action.owner)?.View;
    return View ? <View action={action} session={session} text={text} /> : undefined;
  }, [registry, session]);
  const content = registry.activePlugins.reduceRight<ReactNode>((content, plugin) => {
    if (!plugin.SessionProvider) return content;
    return createElement(plugin.SessionProvider, { key: plugin.id, navigation, session }, content);
  }, children);
  return (
    <ToolRendererContext.Provider value={renderTool}>
      <ActionRendererContext.Provider value={renderAction}>{content}</ActionRendererContext.Provider>
    </ToolRendererContext.Provider>
  );
}

const byTabOrder = (left: WorkspaceTabContribution, right: WorkspaceTabContribution): number =>
  left.order - right.order || left.id.localeCompare(right.id);

const assertUnique = <T,>(values: readonly T[], keyOf: (value: T) => string, label: string) => {
  const keys = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (!key) throw new Error(`${label} without ID`);
    if (keys.has(key)) throw new Error(`${label} registered twice: ${key}`);
    keys.add(key);
  }
};

const activatePlugin = (plugin: WebPlugin, config: Readonly<Record<string, unknown>>): WebPlugin => {
  let activated: WebPlugin;
  try {
    activated = plugin.activate?.(config) ?? plugin;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`Plugin activation failed: ${plugin.id}: ${message}`);
  }
  if (activated.id !== plugin.id) {
    throw new Error(`Plugin activation changed the descriptor: ${plugin.id}`);
  }
  return activated;
};
