import { DetailRow, Label, Switch } from "@ragents/web/ui";
import type { StartOptionBadgeContext, StartOptionControlContext } from "@ragents/web/PluginRegistry";

export function SandboxControl({ option, disabled, error, setValue }: StartOptionControlContext) {
  const forced = (option.presentation as { forced?: boolean } | null)?.forced === true;
  return (
    <div className="flex flex-col gap-1">
      <Label className="flex items-center gap-2">
        <Switch checked={forced || option.value === true} disabled={disabled || forced} onCheckedChange={(checked) => void setValue(checked)} />
        Sandbox protection
      </Label>
      {forced && <span className="text-xs text-muted-foreground">Required by the server or your permissions.</span>}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function SandboxBadge({ option }: StartOptionBadgeContext) {
  const forced = (option.presentation as { forced?: boolean } | null)?.forced === true;
  return <DetailRow label="Sandbox">
    {forced || option.value === true
      ? "Commands run isolated from other work on this machine."
      : "Commands run without isolation from other work on this machine."}
  </DetailRow>;
}
