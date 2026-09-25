import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "../PluginRegistry";
import { Button } from "../ui";
import { mountedTabs } from "../WorkspacePanel";
import { RUN_PANEL_WORKSPACE_ID } from "./workspace-state";

/** Die Leiste als Pop-out über Chat und Bühne des Run-Panels, bei zwei Bereichen nur über dem rechten; abgedunkelter Rest, Klick daneben, Escape und X schließen, besuchte keepMounted-Reiter bleiben montiert. */
export function RunPanelWorkspace({ navigation, onClose, open, session, tabs }: {
  navigation: SessionNavigation;
  onClose: () => void;
  open: boolean;
  session: SessionContext;
  tabs: readonly WorkspaceTabContribution[];
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [visited, setVisited] = useState<readonly string[]>([]);
  const activeTabId = open ? navigation.activeTabId : undefined;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  useEffect(() => {
    if (activeTabId === undefined) return;
    setVisited((current) => current.includes(activeTabId) ? current : [...current, activeTabId]);
    const section = sectionRef.current;
    if (section && !section.contains(document.activeElement)) section.focus({ preventScroll: true });
  }, [activeTabId]);

  return <>
    {open && <div aria-hidden className="absolute inset-0 z-[60] bg-backdrop duration-200 animate-in fade-in-0" onClick={onClose} />}
    <section
      aria-label="Leiste"
      className="absolute inset-2 z-[70] flex flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 animate-in fade-in-0 zoom-in-95 @min-[960px]/chat-content:left-[40%]"
      hidden={!open}
      id={RUN_PANEL_WORKSPACE_ID}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
      ref={sectionRef}
      tabIndex={-1}
    >
      <header className="flex h-8 flex-none items-center gap-2 border-b border-border px-2.5">
        <h2 className="min-w-0 flex-1 truncate text-[0.76rem] font-semibold">{activeTab?.label}</h2>
        <Button aria-label="Leiste schließen" onClick={onClose} size="icon-xs" title="Leiste schließen" variant="ghost"><XIcon /></Button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mountedTabs(tabs, activeTabId, visited).map((tab) => <div className={cn("absolute inset-0 flex min-h-0 flex-col", tab.id !== activeTabId && "pointer-events-none invisible")} key={tab.id}>
          <tab.Panel active={tab.id === activeTabId} navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} />
        </div>)}
      </div>
    </section>
  </>;
}
