import { useSyncExternalStore } from "react";
import { useAccess } from "./AccessContext";
import { useRunPanelHost } from "./run-panel/host";
import { getThemeStore, parseThemePreference, themeOptions } from "./theme";
import { Card, ToggleGroup, ToggleGroupItem } from "./ui";
import { getZoomStore, parseZoom, zoomSteps } from "./zoom";

const noteClasses = "text-sm leading-[1.6] text-muted-foreground";
const swatchClasses = "h-9 w-[14px] rounded-sm border border-border";

export function ThemeSettings() {
  const access = useAccess();
  const store = getThemeStore();
  const { preference, appearance, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const writable = access.can("settings.write");
  const host = useRunPanelHost();
  return <div className="mx-auto flex max-w-[1020px] flex-col gap-6 px-[clamp(20px,calc(var(--ragents-viewport-width,100vw)*0.04),46px)] pt-7 pb-12 max-sm:px-3.5 max-sm:pt-5 max-sm:pb-9">
    <header>
      <h2 className="text-[1.08rem] text-foreground">Appearance</h2>
      <p className="mt-2 max-w-[780px] text-xs leading-[1.55] text-muted-foreground">Colors and size of the whole interface, the surface and the sidebar.</p>
    </header>
    <section aria-labelledby="theme-settings-title">
      <Card className="flex-row flex-wrap items-center gap-5 p-6 max-sm:p-4">
        <div className="flex gap-1 rounded-lg border border-border bg-app p-2" aria-hidden="true">
          <span className={`${swatchClasses} bg-card`} />
          <span className={`${swatchClasses} bg-accent`} />
          <span className={`${swatchClasses} bg-primary`} />
        </div>
        <div className="flex-[1_1_220px]">
          <h3 className="mb-1.5 text-lg font-semibold" id="theme-settings-title">Schichtwerk</h3>
          <p className={noteClasses}>Matte surfaces and drawn outlines.</p>
        </div>
        <ToggleGroup aria-label="Schichtwerk color scheme" className="flex-none max-sm:w-full" disabled={!writable} size="sm"
          value={[preference]}
          onValueChange={([value]) => { if (value && writable) store.setPreference(parseThemePreference(value)); }}>
          {themeOptions.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </Card>
    </section>
    <p className={noteClasses} role="status">
      {preference === "system"
        ? `Follows the system setting. Schichtwerk ${appearance === "dark" ? "Dark" : "Light"} is currently active.`
        : `Schichtwerk ${appearance === "dark" ? "Dark" : "Light"} is active.`}
      {" "}Changes apply immediately and are saved in this browser.
    </p>
    {!writable && <p className={noteClasses}>With your permissions, the color scheme is read-only.</p>}
    {error && <p className="text-sm leading-[1.6] text-destructive" role="alert">{error}</p>}
    {host.kind === "browser" ? <ZoomSettings /> : <p className={noteClasses}>In VS Code, the setting ragents.zoom scales the interface.</p>}
  </div>;
}

function ZoomSettings() {
  const store = getZoomStore();
  const { zoom, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <section aria-labelledby="zoom-settings-title" className="flex flex-col gap-3">
    <Card className="flex-row flex-wrap items-center gap-5 p-6 max-sm:p-4">
      <div className="flex-[1_1_220px]">
        <h3 className="mb-1.5 text-lg font-semibold" id="zoom-settings-title">Zoom</h3>
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
