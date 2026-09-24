import { useSyncExternalStore } from "react";
import { useAccess } from "./AccessContext";
import { getThemeStore, parseThemePreference, themeOptions } from "./theme";
import { Card, ToggleGroup, ToggleGroupItem } from "./ui";

const noteClasses = "text-sm leading-[1.6] text-muted-foreground";
const swatchClasses = "h-9 w-[14px] rounded-sm border border-border";

export function ThemeSettings() {
  const access = useAccess();
  const store = getThemeStore();
  const { preference, appearance, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const writable = access.can("settings.write");
  return <div className="mx-auto flex max-w-[1020px] flex-col gap-6 px-[clamp(20px,4vw,46px)] pt-7 pb-12 max-sm:px-3.5 max-sm:pt-5 max-sm:pb-9">
    <header>
      <h2 className="text-[1.08rem] text-foreground">Darstellung</h2>
      <p className="mt-2 max-w-[780px] text-xs leading-[1.55] text-muted-foreground">Farben für die gesamte Oberfläche, die Fläche und die Leiste.</p>
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
          <p className={noteClasses}>Matte Flächen und gezeichnete Konturen.</p>
        </div>
        <ToggleGroup aria-label="Schichtwerk-Farbschema" className="flex-none max-sm:w-full" disabled={!writable} size="sm" spacing={0}
          value={[preference]} variant="outline"
          onValueChange={([value]) => { if (value && writable) store.setPreference(parseThemePreference(value)); }}>
          {themeOptions.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </Card>
    </section>
    <p className={noteClasses} role="status">
      {preference === "system"
        ? `Folgt der Systemeinstellung. Aktuell ist Schichtwerk ${appearance === "dark" ? "Dunkel" : "Hell"} aktiv.`
        : `Schichtwerk ${appearance === "dark" ? "Dunkel" : "Hell"} ist aktiv.`}
      {" "}Änderungen gelten sofort und werden in diesem Browser gespeichert.
    </p>
    {!writable && <p className={noteClasses}>Die Darstellung ist mit deinen Rechten nur lesbar.</p>}
    {error && <p className="text-sm leading-[1.6] text-destructive" role="alert">{error}</p>}
  </div>;
}
