import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "../PluginRegistry";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui";
import { RUN_PANEL_WORKSPACE_ID } from "./workspace-state";

/** Ein Zähler-Badge des Beitrags sitzt klein oben rechts am Knopf, der Punkt für Neues unten rechts. */
const railButtonClass = "relative aria-pressed:bg-accent aria-pressed:text-primary [&_[data-slot=badge]]:absolute [&_[data-slot=badge]]:-top-0.5 [&_[data-slot=badge]]:-right-0.5 [&_[data-slot=badge]]:h-3.5 [&_[data-slot=badge]]:min-w-3.5 [&_[data-slot=badge]]:px-1 [&_[data-slot=badge]]:py-0 [&_[data-slot=badge]]:text-[0.58rem] [&_[data-slot=badge]]:leading-none";

/** Die Symbolleiste am rechten Rand des Run-Panels: je Reiter der Leiste ein Knopf, der die Leiste mit diesem Reiter öffnet oder wieder schließt. */
export function RunPanelRail({ navigation, onClose, open, pendingTabIds, session, tabs }: {
  navigation: SessionNavigation;
  onClose: () => void;
  open: boolean;
  pendingTabIds: readonly string[];
  session: SessionContext;
  tabs: readonly WorkspaceTabContribution[];
}) {
  return <TooltipProvider><nav aria-label="Reiter der Leiste" className="flex w-9 flex-none flex-col items-center gap-1 border-l border-border bg-shell py-1.5">
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
          {tab.Badge && <tab.Badge active={active} navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} />}
          {pending && <span aria-hidden className="absolute right-1 bottom-1 size-1.5 rounded-full bg-primary" />}
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>{pending ? `${tab.label} - es gibt Neues` : tab.label}</TooltipContent>
      </Tooltip>;
    })}
  </nav></TooltipProvider>;
}
