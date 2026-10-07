import { Radio } from "@base-ui/react/radio";
import { useSyncExternalStore } from "react";
import { PaletteIcon } from "lucide-react";
import { useAccess } from "./AccessContext";
import { getChoiceStore, useChoice } from "./appearance";
import { appearanceChoices, isAppearanceValue, paletteOptions, type AppearanceChoiceId, type ChoiceOption } from "./appearance-options";
import { getThemeStore, parseThemePreference, themeOptions, type ResolvedTheme } from "./theme";
import { Button, Popover, PopoverContent, PopoverTrigger, RadioGroup, ToggleGroup, ToggleGroupItem, cn } from "./ui";
import { focusRing } from "./ui/interaction";

export function SchemeToggle({ writable, className }: { writable: boolean; className?: string }) {
  const store = getThemeStore();
  const { preference } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <ToggleGroup aria-label="Color scheme" className={className} disabled={!writable} size="sm" value={[preference]}
    onValueChange={([value]) => { if (value && writable) store.setPreference(parseThemePreference(value)); }}>
    {themeOptions.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
  </ToggleGroup>;
}

export function ChoiceToggle({ id, writable, className }: { id: Exclude<AppearanceChoiceId, "palette">; writable: boolean; className?: string }) {
  const { value } = useChoice(id);
  const choice = appearanceChoices[id];
  return <ToggleGroup aria-label={choice.label} className={className} disabled={!writable} size="sm" value={[value]}
    onValueChange={([next]) => { if (next && writable && isAppearanceValue(id, next)) getChoiceStore(id).set(next); }}>
    {(choice.options as readonly ChoiceOption[]).map((option) => <ToggleGroupItem key={option.value} title={option.description} value={option.value}>{option.label}</ToggleGroupItem>)}
  </ToggleGroup>;
}

export function PaletteChoices({ writable, scheme, compact = false, labelledBy }: { writable: boolean; scheme: ResolvedTheme; compact?: boolean; labelledBy: string }) {
  const { value } = useChoice("palette");
  const store = getChoiceStore("palette");
  return <RadioGroup aria-labelledby={labelledBy} className={compact ? "grid-cols-2 gap-2" : "grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3"} disabled={!writable} value={value}
    onValueChange={(next) => { if (writable && isAppearanceValue("palette", next)) store.set(next); }}>
    {paletteOptions.map((option) => <PaletteChoice key={option.value} compact={compact} description={option.description} label={option.label} palette={option.value} scheme={scheme} />)}
  </RadioGroup>;
}

function PaletteChoice({ compact, description, label, palette, scheme }: { compact: boolean; description: string; label: string; palette: string; scheme: ResolvedTheme }) {
  return <Radio.Root value={palette} title={description}
    className={cn("flex cursor-pointer flex-col rounded-xl border border-border bg-card text-left transition-colors hover:border-border-strong data-disabled:cursor-not-allowed data-disabled:opacity-60 selected:border-selected-border selected:ring-1 selected:ring-selected-border", compact ? "gap-2 p-2" : "gap-3 p-3", focusRing)}>
    <span aria-hidden data-palette={palette} data-theme={scheme} className={cn("flex overflow-hidden rounded-lg border border-border bg-background text-foreground", compact ? "h-12" : "h-[76px]")}>
      <span className={cn("flex-none border-r border-border-soft bg-shell", compact ? "w-4" : "w-8")} />
      <span className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-1 p-2" : "gap-2 p-3")}>
        <span className="h-1.5 w-2/5 rounded-full bg-foreground" />
        {!compact && <span className="h-1 w-full rounded-full bg-muted-foreground/60" />}
        <span className="flex items-center gap-2">
          <span className="h-3 w-8 rounded-sm bg-primary" />
          <span className="h-3 w-10 rounded-sm border border-code-border bg-code" />
          {!compact && <span className="h-3 w-5 rounded-full bg-success-soft" />}
          {!compact && <span className="h-3 w-5 rounded-full bg-destructive-soft" />}
        </span>
        {!compact && <span className="h-3.5 rounded-sm border border-selected-border bg-selected" />}
      </span>
    </span>
    <span>
      <span className="block text-sm font-semibold text-foreground">{label}</span>
      {!compact && <span className="block text-xs text-muted-foreground">{description}</span>}
    </span>
  </Radio.Root>;
}

const quickRows = [
  { id: "corners", hint: "Radius of controls and panels" },
  { id: "codeStyle", hint: "How code in a sentence is drawn" },
  { id: "density", hint: "Padding of table rows" },
] as const;

/** The appearance within reach from the header: the same controls as Settings, Appearance, without leaving the run. */
export function AppearanceQuickSwitch() {
  return <Popover>
    <PopoverTrigger render={<Button aria-label="Appearance" className="self-center" size="icon-lg" title="Appearance" variant="ghost"><PaletteIcon /></Button>} />
    <PopoverContent align="end" aria-label="Appearance" className="w-90 max-w-[calc(100vw_-_2rem)] gap-4 p-4">
      <QuickSwitchControls />
    </PopoverContent>
  </Popover>;
}

function QuickSwitchControls() {
  const access = useAccess();
  const store = getThemeStore();
  const { appearance } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const writable = access.can("settings.write");
  return <>
    <section className="flex flex-col gap-2">
      <h3 className="type-label" id="quick-palette-title">Palette</h3>
      <PaletteChoices compact labelledBy="quick-palette-title" scheme={appearance} writable={writable} />
    </section>
    <section className="flex items-center justify-between gap-3">
      <h3 className="type-label">Color scheme</h3>
      <SchemeToggle writable={writable} />
    </section>
    {quickRows.map((row) => <section className="flex items-center justify-between gap-3" key={row.id}>
      <h3 className="type-label" title={row.hint}>{appearanceChoices[row.id].label}</h3>
      <ChoiceToggle id={row.id} writable={writable} />
    </section>)}
    {!writable && <p className="type-caption text-muted-foreground">With your permissions, the appearance is read-only.</p>}
  </>;
}
