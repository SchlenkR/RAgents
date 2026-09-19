import type { SessionInfo } from "../../web/src/api";
import { actorProgramViews } from "../../../plugins/ragents.actor-programs/web/program-state";
import { runViewFrom, type RunActor, type RunView } from "../../../plugins/ragents.orchestration/web/run-view";
import { isWorkspaceBinding, WORKSPACE_METADATA_ID, type WorkspaceSessionMetadata } from "../../../plugins/ragents.workspace/contract";

export type ActorRole = "coordinator" | "agent" | "script";
export type ActorStatus = "running" | "waiting" | "idle" | "stopped";
export type RunState = "running" | "waiting" | "idle" | "ended";

export interface ActorSummary {
  id: string;
  handle: string;
  displayName: string;
  role: ActorRole;
  status: ActorStatus;
  pendingInputs: number;
  questions: number;
}

export interface AppSummary {
  id: string;
  title: string;
  actorId: string;
  actorHandle: string;
  questions: number;
}

export interface ArtifactSummary {
  id: string;
  title: string;
  mediaType: string;
  size: number;
}

export interface RunSummary {
  id: string;
  title: string;
  updatedAt: number;
  state: RunState;
  activeActors: number;
  questions: number;
  actors: ActorSummary[];
  apps: AppSummary[];
  artifacts: ArtifactSummary[];
  events: number | undefined;
  loaded: boolean;
  workspace?: string;
}

/** Der Arbeitsbereich eines Runs, sofern er nicht der leere Ordner je Run ist. */
const workspaceOf = (session: SessionInfo): string | undefined => {
  const raw = session.metadata?.[WORKSPACE_METADATA_ID];
  if (typeof raw !== "object" || raw === null) return undefined;
  const metadata = raw as Partial<WorkspaceSessionMetadata>;
  if (!isWorkspaceBinding(metadata.binding) || metadata.binding.kind === "fresh") return undefined;
  return typeof metadata.summary === "string" && metadata.summary ? metadata.summary : undefined;
};

const pendingQuestionsBy = (view: RunView, actorId: string): number =>
  view.actions.filter((action) => action.kind === "question" && action.status === "pending" && action.askedBy === actorId).length;

const actorStatusOf = (view: RunView, actor: RunActor): ActorStatus => {
  if (actor.lifecycle?.kind === "running") return "running";
  if (actor.lifecycle?.kind === "stopped") return "stopped";
  return view.inputs.some((input) => input.actorId === actor.id && input.lifecycle.kind === "pending") ? "waiting" : "idle";
};

export const actorSummaries = (view: RunView): ActorSummary[] => view.actors
  .filter((actor) => actor.kind !== "human")
  .map((actor): ActorSummary => ({
    id: actor.id,
    handle: actor.handle,
    displayName: actor.displayName,
    role: actor.id === view.primaryActorId ? "coordinator" : actor.kind === "agent" ? "agent" : "script",
    status: actorStatusOf(view, actor),
    pendingInputs: view.inputs.filter((input) => input.actorId === actor.id && input.lifecycle.kind === "pending").length,
    questions: pendingQuestionsBy(view, actor.id),
  }))
  .sort((left, right) => Number(right.role === "coordinator") - Number(left.role === "coordinator"));

export const appSummaries = (view: RunView): AppSummary[] => actorProgramViews(view)
  .filter((entry) => entry.app.visible !== false)
  .map((entry) => ({ id: entry.id, title: entry.title, actorId: entry.actorId, actorHandle: entry.actorHandle, questions: pendingQuestionsBy(view, entry.actorId) }));

export const runStateOf = (session: SessionInfo, actors: readonly ActorSummary[], questions: number): RunState => {
  if (session.running || actors.some((actor) => actor.status === "running")) return "running";
  if (questions > 0) return "waiting";
  if (actors.length > 0 && actors.every((actor) => actor.status === "stopped")) return "ended";
  return "idle";
};

/** Die Zusammenfassung eines Runs für Explorer und Abzeichen; ohne geladene Laufansicht bleibt nur die Listenzeile. */
export const runSummaryFrom = (session: SessionInfo, rawView: unknown): RunSummary => {
  const view = runViewFrom(rawView);
  if (!view) {
    return {
      id: session.id, title: session.title, updatedAt: session.updatedAt, state: session.running ? "running" : "idle",
      activeActors: 0, questions: 0, actors: [], apps: [], artifacts: [], events: session.revision, loaded: false,
      workspace: workspaceOf(session),
    };
  }
  const actors = actorSummaries(view);
  const questions = view.actions.filter((action) => action.kind === "question" && action.status === "pending").length;
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    state: runStateOf(session, actors, questions),
    activeActors: actors.filter((actor) => actor.status === "running").length,
    questions,
    actors,
    apps: appSummaries(view),
    artifacts: view.artifacts.map((artifact) => ({ id: artifact.id, title: artifact.title, mediaType: artifact.mediaType, size: artifact.size })),
    events: view.revision,
    loaded: true,
    workspace: workspaceOf(session),
  };
};

export const sortRuns = (runs: readonly RunSummary[]): RunSummary[] =>
  [...runs].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));

export const textArtifact = (artifact: ArtifactSummary): boolean =>
  /^text\//.test(artifact.mediaType) || /^application\/(json|xml|javascript|typescript|x-yaml|yaml|toml)$/.test(artifact.mediaType) || /\+(json|xml)$/.test(artifact.mediaType);
