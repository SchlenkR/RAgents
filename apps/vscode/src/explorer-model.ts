import type { ActorSummary, AppSummary, ArtifactSummary, RunSummary } from "./run-model";
import type { ConnectionStatus } from "./store";
import type { WorkspaceClientStatus } from "./workspace-client";

/** Was der Baum zeigt, ohne VS-Code-Typen: der Adapter macht daraus TreeItems. */
export type ExplorerNode =
  | { kind: "notice"; id: string; label: string; description?: string; icon: string; command?: string; tooltip?: string }
  | { kind: "run"; id: string; run: RunSummary; selected: boolean; label: string; description: string; icon: string; color: string | undefined; tooltip: string }
  | { kind: "section"; id: string; runId: string; section: "actors" | "apps" | "artifacts"; label: string; description: string; icon: string }
  | { kind: "journal"; id: string; runId: string; label: string; description: string; icon: string }
  | { kind: "actor"; id: string; runId: string; actor: ActorSummary; label: string; description: string; icon: string; color: string | undefined; tooltip: string }
  | { kind: "app"; id: string; runId: string; app: AppSummary; placement: "column" | "center"; label: string; description: string; icon: string; tooltip: string }
  | { kind: "artifact"; id: string; runId: string; artifact: ArtifactSummary; label: string; description: string; icon: string };

export interface ExplorerState {
  status: ConnectionStatus;
  streamMessage: string | undefined;
  serverUrl: string;
  runs: readonly RunSummary[];
  selectedRunId: string | undefined;
  centerElements: (runId: string) => ReadonlySet<string>;
  workspaceClient: WorkspaceClientStatus;
}

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

const runStateLabel = (run: RunSummary): string => {
  switch (run.state) {
    case "running": return run.activeActors > 0 ? `${run.activeActors} aktiv` : "läuft";
    case "waiting": return "wartet";
    case "ended": return "beendet";
    case "idle": return "ruht";
  }
};

const runColor = (run: RunSummary): string | undefined => {
  switch (run.state) {
    case "running": return "charts.green";
    case "waiting": return "charts.orange";
    case "ended": return "disabledForeground";
    case "idle": return "charts.blue";
  }
};

const actorStatusLabel = (actor: ActorSummary): string => {
  switch (actor.status) {
    case "running": return "arbeitet";
    case "waiting": return plural(actor.pendingInputs, "Auftrag wartet", "Aufträge warten");
    case "stopped": return "gestoppt";
    case "idle": return "bereit";
  }
};

const actorIcon = (actor: ActorSummary): string => actor.role === "coordinator" ? "sparkle" : actor.role === "agent" ? "hubot" : "code";

const roleLabel = (actor: ActorSummary): string => actor.role === "coordinator" ? "Koordinator" : actor.role === "agent" ? "LLM-Agent" : "TypeScript-Actor";

const questionSuffix = (questions: number): string => questions > 0 ? ` \u00b7 ${plural(questions, "Rückfrage", "Rückfragen")}` : "";

export const rootNodes = (state: ExplorerState): ExplorerNode[] => {
  const status = state.status;
  if (status.kind === "connecting") return [{ kind: "notice", id: "notice:connecting", label: "Verbindet ...", description: state.serverUrl, icon: "sync~spin" }];
  if (status.kind === "unreachable") return [
    { kind: "notice", id: "notice:unreachable", label: "Server nicht erreichbar", description: state.serverUrl, icon: "debug-disconnect", tooltip: status.message },
    { kind: "notice", id: "notice:reconnect", label: "Erneut verbinden", description: "sonst alle 5 s von selbst", icon: "refresh", command: "ragents.connect", tooltip: status.message },
  ];
  if (status.kind === "login-required") return [
    { kind: "notice", id: "notice:login", label: "Anmeldung erforderlich", description: state.serverUrl, icon: "lock", tooltip: status.tokenGate ? "Der Server verlangt einen Zugangstoken." : "Der Server verlangt Benutzer und Passwort." },
    { kind: "notice", id: "notice:login-command", label: status.tokenGate ? "Zugangstoken eingeben" : "Anmelden", icon: "sign-in", command: "ragents.login" },
  ];
  if (status.kind === "forbidden") return [{ kind: "notice", id: "notice:forbidden", label: "Kein Zugriff", description: status.message, icon: "error", tooltip: status.message }];
  const nodes: ExplorerNode[] = state.runs.map((run) => ({
    kind: "run",
    id: `run:${run.id}`,
    run,
    selected: run.id === state.selectedRunId,
    label: run.title,
    description: `${runStateLabel(run)}${questionSuffix(run.questions)}`,
    icon: run.state === "ended" ? "circle-outline" : "circle-filled",
    color: runColor(run),
    tooltip: `${run.title}\n${runStateLabel(run)}${questionSuffix(run.questions)}${run.events !== undefined ? `\n${plural(run.events, "Ereignis", "Ereignisse")} im Journal` : ""}${run.workspace ? `\nArbeitsbereich: ${run.workspace}` : ""}`,
  }));
  if (state.workspaceClient.kind === "failed") nodes.unshift({ kind: "notice", id: "notice:workspace-client", label: "Arbeitsplatz nicht angemeldet", description: "kein Ordner für neue Runs", icon: "warning", tooltip: state.workspaceClient.message });
  if (state.streamMessage !== undefined) nodes.unshift({ kind: "notice", id: "notice:stream", label: "Live-Verbindung unterbrochen", description: "verbindet neu ...", icon: "warning", tooltip: state.streamMessage });
  if (nodes.length === 0) nodes.push({ kind: "notice", id: "notice:empty", label: "Noch keine Runs", description: "Neuer Run über das Plus", icon: "info" });
  return nodes;
};

export const childNodes = (state: ExplorerState, node: ExplorerNode): ExplorerNode[] => {
  if (node.kind === "run") {
    const run = node.run;
    if (!run.loaded) return [{ kind: "notice", id: `run:${run.id}:loading`, label: "Laufansicht wird geladen ...", icon: "sync~spin" }];
    return [
      { kind: "section", id: `run:${run.id}:actors`, runId: run.id, section: "actors", label: "Actors", description: String(run.actors.length), icon: "organization" },
      { kind: "section", id: `run:${run.id}:apps`, runId: run.id, section: "apps", label: "Mini-Apps", description: String(run.apps.length), icon: "layout" },
      { kind: "section", id: `run:${run.id}:artifacts`, runId: run.id, section: "artifacts", label: "Dateien", description: String(run.artifacts.length), icon: "files" },
      { kind: "journal", id: `run:${run.id}:journal`, runId: run.id, label: "Journal", description: run.events === undefined ? "" : plural(run.events, "Ereignis", "Ereignisse"), icon: "history" },
    ];
  }
  if (node.kind !== "section") return [];
  const run = state.runs.find((entry) => entry.id === node.runId);
  if (!run) return [];
  if (node.section === "actors") return run.actors.map((actor) => ({
    kind: "actor",
    id: `run:${run.id}:actor:${actor.id}`,
    runId: run.id,
    actor,
    label: `@${actor.handle}`,
    description: actor.role === "coordinator" ? `Koordinator \u00b7 ${actorStatusLabel(actor)}${questionSuffix(actor.questions)}` : `${actorStatusLabel(actor)}${questionSuffix(actor.questions)}`,
    icon: actorIcon(actor),
    color: actor.status === "stopped" ? "disabledForeground" : actor.status === "running" ? "charts.green" : undefined,
    tooltip: `${actor.displayName || actor.handle}\n${roleLabel(actor)}, ${actorStatusLabel(actor)}`,
  }));
  if (node.section === "apps") return run.apps.map((app) => {
    const placement = state.centerElements(run.id).has(app.id) ? "center" : "column";
    return {
      kind: "app",
      id: `run:${run.id}:app:${app.id}`,
      runId: run.id,
      app,
      placement,
      label: app.title,
      description: `${placement === "center" ? "in der Mitte" : "rechts"}${app.questions > 0 ? " \u00b7 !" : ""}`,
      icon: "layout",
      tooltip: `${app.title} von @${app.actorHandle}${questionSuffix(app.questions)}`,
    };
  });
  return run.artifacts.map((artifact) => ({
    kind: "artifact",
    id: `run:${run.id}:artifact:${artifact.id}`,
    runId: run.id,
    artifact,
    label: artifact.title,
    description: artifact.mediaType,
    icon: "file",
  }));
};

export const parentId = (node: ExplorerNode): string | undefined => {
  switch (node.kind) {
    case "notice":
    case "run":
      return undefined;
    case "section":
    case "journal":
      return `run:${node.runId}`;
    case "actor":
      return `run:${node.runId}:actors`;
    case "app":
      return `run:${node.runId}:apps`;
    case "artifact":
      return `run:${node.runId}:artifacts`;
  }
};
