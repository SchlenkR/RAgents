import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useAccess } from "../AccessContext";
import { Overview } from "../Overview";
import type { OverviewPanelContext, PluginRegistry } from "../PluginRegistry";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import { Button } from "../ui";

export function PanelContributions({ registry, userLocation, placement = "toolbar" }: { registry: PluginRegistry; userLocation: ChatUserLocation; placement?: "toolbar" | "idle" }) {
  const access = useAccess();
  const [open, setOpen] = useState<string>();
  const [overviewActivated, setOverviewActivated] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const reportBusy = useCallback((id: string, value: boolean) => setBusy((current) => {
    if (current.has(id) === value) return current;
    const next = new Set(current);
    if (value) next.add(id);
    else next.delete(id);
    return next;
  }), []);
  const panels = registry.overviewPanels.filter((panel) => panel.readRight === undefined || access.can(panel.readRight));
  const overview = placement === "idle" ? [] : panels.filter((panel) => (panel.placement ?? "overview") === "overview");
  const openOverview = () => { setOverviewActivated(true); setOpen("overview"); };
  return <>
    {overview.length > 0 && <Button onClick={() => open === "overview" ? setOpen(undefined) : openOverview()} variant="ghost">{busy.size ? "Overview (working)" : "Overview"}</Button>}
    {panels.filter((panel) => panel.placement === placement).slice(0, placement === "idle" ? 1 : undefined).map(({ id, Panel, placement }) =>
      <Contribution id={id} key={id} onBusy={reportBusy} onClose={() => setOpen(undefined)} onOpen={() => setOpen(id)}
        open={placement === "idle" || open === id} Panel={Panel} registry={registry} userLocation={userLocation} />)}
    {overviewActivated && overview.length > 0 && <Overview onBusy={reportBusy} onClose={() => setOpen(undefined)} onOpen={openOverview}
      open={open === "overview"} panels={overview} registry={registry} />}
  </>;
}

function Contribution({ id, onBusy, Panel, ...context }: Omit<OverviewPanelContext, "onBusy"> & {
  id: string;
  onBusy: (id: string, busy: boolean) => void;
  Panel: ComponentType<OverviewPanelContext>;
}) {
  const report = useCallback((busy: boolean) => onBusy(id, busy), [id, onBusy]);
  useEffect(() => () => onBusy(id, false), [id, onBusy]);
  return <Panel {...context} onBusy={report} />;
}
