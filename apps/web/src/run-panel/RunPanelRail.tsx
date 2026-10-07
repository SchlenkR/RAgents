import type { ReactNode } from "react";
import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "../PluginRegistry";
import { Badge, BadgeDisplayProvider, Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui";
import { RUN_PANEL_WORKSPACE_ID } from "./workspace-state";

/** A rail button's badge as a dot on its corner; it sits beside the button so the button keeps the shared icon-only look. */
export function RailBadge({ children }: { children: ReactNode }) {
  return <span className="pointer-events-none absolute top-1 right-1"><BadgeDisplayProvider value="dot">{children}</BadgeDisplayProvider></span>;
}

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
        <div className="relative flex">
          <TooltipTrigger
            aria-controls={RUN_PANEL_WORKSPACE_ID}
            aria-label={tab.label}
            aria-pressed={active}
            onClick={() => active ? onClose() : navigation.openTab(tab.id)}
            render={<Button size="icon" variant="ghost" />}
          >
            <tab.Icon />
          </TooltipTrigger>
          <RailBadge>
            {pending ? <Badge tone="info">New activity</Badge> : tab.Badge && <tab.Badge active={active} navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} />}
          </RailBadge>
        </div>
        <TooltipContent side="left" sideOffset={8}>{pending ? `${tab.label} - new activity` : tab.label}</TooltipContent>
      </Tooltip>;
    })}
  </nav></TooltipProvider>;
}
