import { Radio } from "@base-ui/react/radio";
import { useSyncExternalStore } from "react";
import { useAccess } from "./AccessContext";
import { getPaletteStore, paletteOptions, parsePalette, type PaletteId } from "./palette";
import { useRunPanelHost } from "./run-panel/host";
import { settingsPageClass, settingsPageLeadClass, settingsPageTitleClass, settingsPanelClass, settingsPanelTitleClass } from "./settings-page";
import { getThemeStore, parseThemePreference, themeOptions, type ResolvedTheme } from "./theme";
import { Card, RadioGroup, ToggleGroup, ToggleGroupItem, cn } from "./ui";
import { focusRing } from "./ui/interaction";
import { getZoomStore, parseZoom, zoomSteps } from "./zoom";

const noteClasses = "text-sm leading-[1.6] text-muted-foreground";
const rowPanelClass = cn(settingsPanelClass, "flex-row flex-wrap items-center gap-5");
const panelTitleClass = cn(settingsPanelTitleClass, "mb-1.5");

export function ThemeSettings() {
  const access = useAccess();
  const store = getThemeStore();
  const { preference, appearance, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const writable = access.can("settings.write");
  const host = useRunPanelHost();
  return <div className={settingsPageClass}>
    <header>
      <h2 className={settingsPageTitleClass}>Appearance</h2>
      <p className={settingsPageLeadClass}>Palette, color scheme and size of the whole interface, the surface and the sidebar.</p>
    </header>
    <PaletteSettings appearance={appearance} writable={writable} />
    <section aria-labelledby="theme-settings-title">
      <Card className={rowPanelClass}>
        <div className="flex-[1_1_220px]">
          <h3 className={panelTitleClass} id="theme-settings-title">Color scheme</h3>
          <p className={noteClasses}>Light, dark, or the setting of your system.</p>
        </div>
        <ToggleGroup aria-label="Color scheme" className="flex-none max-sm:w-full" disabled={!writable} size="sm"
          value={[preference]}
          onValueChange={([value]) => { if (value && writable) store.setPreference(parseThemePreference(value)); }}>
          {themeOptions.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </Card>
    </section>
    <p className={noteClasses} role="status">
      {preference === "system" ? `Follows the system setting, which is currently ${appearance}.` : `The ${appearance} scheme is active.`}
      {" "}Changes apply immediately and are saved in this browser.
    </p>
    {!writable && <p className={noteClasses}>With your permissions, the appearance is read-only.</p>}
    {error && <p className="text-sm leading-[1.6] text-destructive" role="alert">{error}</p>}
    {host.kind === "browser" ? <ZoomSettings /> : <p className={noteClasses}>In VS Code, the setting ragents.zoom scales the interface.</p>}
  </div>;
}

function PaletteSettings({ appearance, writable }: { appearance: ResolvedTheme; writable: boolean }) {
  const store = getPaletteStore();
  const { palette, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <section aria-labelledby="palette-settings-title">
    <Card className={settingsPanelClass}>
      <div>
        <h3 className={panelTitleClass} id="palette-settings-title">Palette</h3>
        <p className={noteClasses}>Colors of every surface, control and text.</p>
      </div>
      <RadioGroup aria-labelledby="palette-settings-title" className="grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3" disabled={!writable} value={palette}
        onValueChange={(value) => { if (writable) store.setPalette(parsePalette(String(value))); }}>
        {paletteOptions.map((option) => <PaletteChoice key={option.value} appearance={appearance} label={option.label} description={option.description} palette={option.value} />)}
      </RadioGroup>
      {error && <p className="text-sm leading-[1.6] text-destructive" role="alert">{error}</p>}
    </Card>
  </section>;
}

interface PaletteChoiceProps {
  appearance: ResolvedTheme;
  description: string;
  label: string;
  palette: PaletteId;
}

function PaletteChoice({ appearance, description, label, palette }: PaletteChoiceProps) {
  return <Radio.Root value={palette}
    className={cn("flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-border-strong data-disabled:cursor-not-allowed data-disabled:opacity-60 selected:border-selected-border selected:ring-1 selected:ring-selected-border", focusRing)}>
    <span aria-hidden data-palette={palette} data-theme={appearance} className="flex h-[76px] overflow-hidden rounded-lg border border-border bg-background text-foreground">
      <span className="w-8 flex-none border-r border-border-soft bg-shell" />
      <span className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <span className="h-1.5 w-2/5 rounded-full bg-foreground" />
        <span className="h-1 w-full rounded-full bg-muted-foreground/60" />
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-8 rounded-sm bg-primary" />
          <span className="h-3 w-10 rounded-sm border border-code-border bg-code" />
          <span className="h-3 w-5 rounded-full bg-success-soft" />
          <span className="h-3 w-5 rounded-full bg-destructive-soft" />
        </span>
        <span className="h-3.5 rounded-sm border border-selected-border bg-selected" />
      </span>
    </span>
    <span>
      <span className="block text-sm font-semibold text-foreground">{label}</span>
      <span className="block text-xs text-muted-foreground">{description}</span>
    </span>
  </Radio.Root>;
}

function ZoomSettings() {
  const store = getZoomStore();
  const { zoom, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <section aria-labelledby="zoom-settings-title" className="flex flex-col gap-3">
    <Card className={rowPanelClass}>
      <div className="flex-[1_1_220px]">
        <h3 className={panelTitleClass} id="zoom-settings-title">Zoom</h3>
        <p className={noteClasses}>Scales text, controls, and spacing of the whole interface including mini-apps. Saved in this browser.</p>
      </div>
      <ToggleGroup aria-label="Zoom" className="flex-none max-sm:w-full" size="sm" value={[String(zoom)]}
        onValueChange={([value]) => { if (value) store.setZoom(parseZoom(value)); }}>
        {zoomSteps.map((step) => <ToggleGroupItem key={step} value={String(step)}>{step}%</ToggleGroupItem>)}
      </ToggleGroup>
    </Card>
    {error && <p className="text-sm leading-[1.6] text-destructive" role="alert">{error}</p>}
  </section>;
}
