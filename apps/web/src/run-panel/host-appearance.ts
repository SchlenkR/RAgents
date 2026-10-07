import { applyAppearance, getChoiceStore } from "../appearance";
import { appearanceChoiceIds, type AppearanceChoiceId } from "../appearance-options";
import type { ThemePreference, ResolvedTheme } from "../theme";
import type { RunPanelHost } from "./host";
import type { RunPanelScheme } from "./host-contract";
import type { RunPanelLocation } from "./run-panel-location";

export const preferenceOfScheme = (scheme: RunPanelScheme): ThemePreference => scheme === "auto" ? "system" : scheme;
export const schemeOfPreference = (preference: ThemePreference): RunPanelScheme => preference === "system" ? "auto" : preference;

interface ThemeControl {
  getSnapshot(): { preference: ThemePreference };
  subscribe(listener: () => void): () => void;
  setPreference(preference: ThemePreference): void;
}

interface EditorScheme {
  set(theme: ResolvedTheme): void;
}

/** Takes the host's settings over and reports every change the user makes in the panel back; the host keeps the setting, the browser storage is only a cache. */
export function bindHostAppearance({ host, location, theme, editor }: {
  host: RunPanelHost;
  location: RunPanelLocation;
  theme: ThemeControl;
  editor: EditorScheme | undefined;
}): () => void {
  let applying = false;
  let managed = location.scheme !== undefined;
  const apply = (change: () => void) => {
    applying = true;
    try { change(); } finally { applying = false; }
  };
  const applyScheme = (scheme: RunPanelScheme, current: ResolvedTheme) => apply(() => {
    editor?.set(current);
    theme.setPreference(preferenceOfScheme(scheme));
  });

  if (location.scheme !== undefined) applyScheme(location.scheme, location.theme ?? "dark");
  else if (location.theme !== undefined) apply(() => theme.setPreference(location.theme!));
  apply(() => applyAppearance(location.looks));

  const unsubscribers = [
    host.onCommand((message) => {
      if (message.type === "theme") {
        if (!managed) apply(() => theme.setPreference(message.theme));
      } else if (message.type === "appearance") {
        managed = true;
        applyScheme(message.scheme, message.theme);
        apply(() => applyAppearance(message));
      }
    }),
  ];

  if (host.kind === "vscode") {
    let preference = theme.getSnapshot().preference;
    unsubscribers.push(theme.subscribe(() => {
      const next = theme.getSnapshot().preference;
      if (next === preference) return;
      preference = next;
      if (!applying) host.notify({ type: "appearanceChanged", scheme: schemeOfPreference(next) });
    }));
    for (const id of appearanceChoiceIds) unsubscribers.push(reportChoice(host, id, () => applying));
  }
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

function reportChoice(host: RunPanelHost, id: AppearanceChoiceId, applying: () => boolean): () => void {
  const store = getChoiceStore(id);
  let last: string = store.getSnapshot().value;
  return store.subscribe(() => {
    const next: string = store.getSnapshot().value;
    if (next === last) return;
    last = next;
    if (!applying()) host.notify({ type: "appearanceChanged", [id]: next });
  });
}
