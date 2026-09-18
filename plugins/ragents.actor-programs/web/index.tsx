import {
  pluginRoutePrefixFrom,
  type SessionProviderProps,
  type WebPlugin,
  type WebPluginDescriptor,
} from "@aicontainer/web/PluginRegistry";
import { createActorProgramsApi } from "./api";
import { ORCHESTRATION_TAB_ID } from "@aicontainer/plugins/ragents.orchestration/web/constants";
import {
  actorProgramApps,
  RUN_TOOLS_TAB_ID,
  ActorProgramsHeader,
  ActorProgramsProvider,
  ToolsBadge,
  ToolsPanel,
} from "./AppsPanel";
import { FullscreenHost } from "./FullscreenHost";
import {
  ActorProgramCanvasElement,
  ActorProgramToolCardSection,
  actorProgramCanvasElements,
} from "./EmbeddedApps";

export const ACTOR_PROGRAMS_PLUGIN_ID = "ragents.actor-programs";

function IconTools() {
  return (
    <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
      <path d="M14.5 6.5 17.5 3.5l3 3-3 3" />
      <path d="m9.5 17.5-3 3-3-3 3-3" />
      <path d="M13 5H9a4 4 0 0 0-4 4v5.5M11 19h4a4 4 0 0 0 4-4V9.5" />
    </svg>
  );
}

const configuredPlugin = (descriptor: WebPluginDescriptor, routePrefix: string): WebPlugin => {
  const api = createActorProgramsApi(routePrefix);

  function Provider({ children, session }: SessionProviderProps) {
    return (
      <ActorProgramsProvider api={api} session={session}>
        {children}
        <FullscreenHost session={session} />
      </ActorProgramsProvider>
    );
  }

  return {
    ...descriptor,
    needsRunView: true,
    SessionProvider: Provider,
    sessionHeaders: [{
      id: "ragents.actor-programs.quick-list",
      placement: "canvas",
      order: 250,
      Header: ActorProgramsHeader,
    }],
    cardSections: [{
      id: "ragents.actor-programs.tools",
      order: 400,
      Section: ActorProgramToolCardSection,
    }],
    canvasElements: [{
      id: "ragents.actor-programs.apps",
      order: 400,
      select: actorProgramCanvasElements,
      Element: ActorProgramCanvasElement,
    }],
    entityPresenters: [{
      reveal: (entity, session) => {
        if (entity.type !== "run-app") return undefined;
        const entry = actorProgramApps(session).find((app) => app.id === entity.id);
        if (!entry || entry.app.visible === false) return undefined;
        return { tabId: ORCHESTRATION_TAB_ID, selection: entity };
      },
    }],
    workspaceTabs: [
      {
        readRight: "runs.inspect",
        id: RUN_TOOLS_TAB_ID,
        label: "Funktionen",
        order: 251,
        Icon: IconTools,
        Panel: ToolsPanel,
        Badge: ToolsBadge,
      },
    ],
  };
};

const descriptor: WebPluginDescriptor = { id: ACTOR_PROGRAMS_PLUGIN_ID };

export const webPlugin: WebPlugin = {
  ...descriptor,
  activate: (config) => configuredPlugin(descriptor, pluginRoutePrefixFrom(descriptor.id, config)),
};
