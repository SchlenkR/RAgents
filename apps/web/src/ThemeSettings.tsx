import { useSyncExternalStore } from "react";
import { useAccess } from "./AccessContext";
import { ChoiceToggle, PaletteChoices, SchemeToggle } from "./AppearanceControls";
import { useChoice } from "./appearance";
import { appearanceChoices } from "./appearance-options";
import { useRunPanelHost } from "./run-panel/host";
import { settingsPageClass, settingsPageLeadClass, settingsPageTitleClass, settingsPanelClass, settingsPanelTitleClass } from "./settings-page";
import { getThemeStore, type ResolvedTheme } from "./theme";
import { Card, ToggleGroup, ToggleGroupItem, cn } from "./ui";
import { getZoomStore, parseZoom, zoomSteps } from "./zoom";

const noteClasses = "text-sm leading-[1.6] text-muted-foreground";
const rowPanelClass = cn(settingsPanelClass, "flex-row flex-wrap items-center gap-4");
const panelTitleClass = cn(settingsPanelTitleClass, "mb-2");
const choiceRows = [
  { id: "corners", description: "Corner radius of controls, cards and panels." },
  { id: "codeStyle", description: "Code inside a sentence, on a tinted background or as an outlined chip." },
  { id: "density", description: "Padding of the rows in tables and lists." },
] as const;

export function ThemeSettings() {
  const access = useAccess();
  const store = getThemeStore();
  const { preference, appearance, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const writable = access.can("settings.write");
  const host = useRunPanelHost();
  const shapeErrors = [useChoice("codeStyle").error, useChoice("corners").error, useChoice("density").error].filter((message) => message !== null);
  return <div className={settingsPageClass}>
    <header>
      <h2 className={settingsPageTitleClass}>Appearance</h2>
      <p className={settingsPageLeadClass}>Palette, color scheme, shapes and size of the whole interface, the surface and the sidebar.</p>
    </header>
    <PaletteSettings appearance={appearance} writable={writable} />
    <section aria-labelledby="theme-settings-title">
      <Card className={rowPanelClass}>
        <div className="flex-[1_1_220px]">
          <h3 className={panelTitleClass} id="theme-settings-title">Color scheme</h3>
          <p className={noteClasses}>{host.kind === "vscode" ? "Light, dark, or the color theme of VS Code." : "Light, dark, or the setting of your system."}</p>
        </div>
        <SchemeToggle className="flex-none max-sm:w-full" writable={writable} />
      </Card>
    </section>
    <section aria-labelledby="shape-settings-title">
      <Card className={settingsPanelClass}>
        <h3 className={panelTitleClass} id="shape-settings-title">Shape and spacing</h3>
        {choiceRows.map((row) => <div className="flex flex-wrap items-center gap-4" key={row.id}>
          <div className="flex-[1_1_220px]">
            <h4 className="type-item">{appearanceChoices[row.id].label}</h4>
            <p className={noteClasses}>{row.description}</p>
          </div>
          <ChoiceToggle className="flex-none max-sm:w-full" id={row.id} writable={writable} />
        </div>)}
      </Card>
    </section>
    <p className={noteClasses} role="status">
      {preference === "system" ? `Follows ${host.kind === "vscode" ? "VS Code" : "the system setting"}, which is currently ${appearance}.` : `The ${appearance} scheme is active.`}
      {" "}Changes apply immediately and are saved {host.kind === "vscode" ? "in the VS Code settings ragents.theme, ragents.palette, ragents.codeStyle, ragents.corners and ragents.density" : "in this browser"}.
    </p>
    {!writable && <p className={noteClasses}>With your permissions, the appearance is read-only.</p>}
    {[error, ...shapeErrors].map((message) => message && <p className="text-sm leading-[1.6] text-destructive" key={message} role="alert">{message}</p>)}
    {host.kind === "browser" ? <ZoomSettings /> : <p className={noteClasses}>In VS Code, the setting ragents.zoom scales the interface.</p>}
  </div>;
}

function PaletteSettings({ appearance, writable }: { appearance: ResolvedTheme; writable: boolean }) {
  const { error } = useChoice("palette");
  return <section aria-labelledby="palette-settings-title">
    <Card className={settingsPanelClass}>
      <div>
        <h3 className={panelTitleClass} id="palette-settings-title">Palette</h3>
        <p className={noteClasses}>Colors of every surface, control and text.</p>
      </div>
      <PaletteChoices labelledBy="palette-settings-title" scheme={appearance} writable={writable} />
      {error && <p className="text-sm leading-[1.6] text-destructive" role="alert">{error}</p>}
    </Card>
  </section>;
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
