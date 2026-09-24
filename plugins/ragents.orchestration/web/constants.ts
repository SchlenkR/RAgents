export const ORCHESTRATION_PLUGIN_ID = "ragents.orchestration";

/** Knopf in der Statusleiste: volle Leistenhöhe, keine Rundung, ruhige Fläche. */
export const statusControlClass = "flex h-full min-w-statusbar items-center justify-center self-stretch whitespace-nowrap px-2.5 text-[0.7rem] text-foreground hover:bg-primary/12 aria-expanded:bg-primary/12 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

/** Rahmen für die Plugin-Beiträge einer Actor-Karte; ein Beitrag bringt keine eigenen Abstaende mit. */
export const cardSectionsClass = "grid gap-2.5 border-t border-border-soft px-3 pt-2.5 pb-2.5 empty:hidden";
