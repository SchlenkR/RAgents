import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "../PluginRegistry";
import { Badge, BadgeDisplayProvider, Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui";
import { RUN_PANEL_WORKSPACE_ID } from "./workspace-state";

const railButtonClass = "relative border border-transparent";

/** The toolbar at the right edge of the run panel: one button per sidebar tab that opens the sidebar with this tab or closes it again. */
export function RunPanelRail({ navigation, onClose, open, pendingTabIds, session, tabs }: {
  navigation: SessionNavigation;
  onClose: () => void;
  open: boolean;
  pendingTabIds: readonly string[];
  session: SessionContext;
  tabs: readonly WorkspaceTabContribution[];
}) {
  return <TooltipProvider><nav aria-label="Sidebar tabs" className="flex w-9 flex-none flex-col items-center gap-1 border-l border-border bg-shell py-1.5">
    {tabs.map((tab) => {
      const active = open && tab.id === navigation.activeTabId;
      const pending = pendingTabIds.includes(tab.id);
      return <Tooltip key={tab.id}>
        <TooltipTrigger
          aria-controls={RUN_PANEL_WORKSPACE_ID}
          aria-label={tab.label}
          aria-pressed={active}
          className={railButtonClass}
          onClick={() => active ? onClose() : navigation.openTab(tab.id)}
          render={<Button size="icon" variant="ghost" />}
        >
          <tab.Icon />
          <span className="absolute top-1 right-1"><BadgeDisplayProvider value="dot">
            {pending ? <Badge tone="info">New activity</Badge> : tab.Badge && <tab.Badge active={active} navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} />}
          </BadgeDisplayProvider></span>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>{pending ? `${tab.label} - new activity` : tab.label}</TooltipContent>
      </Tooltip>;
    })}
  </nav></TooltipProvider>;
}
