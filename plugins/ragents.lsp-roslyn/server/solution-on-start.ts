import type { Orchestration, SessionLifecycleContribution } from "@ragents/engine";
import {
  languageServerOpenOperation,
  languageServerSolutionsOperation,
  type LanguageServerSolutions,
} from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { DISMISSED_ANSWER, type AskService } from "@ragents/plugins/ragents.ask/server/contract.js";

export const SOLUTION_ON_START_VARIABLE = "ROSLYN_SOLUTION_ON_START";
export const NO_SOLUTION = "Keine laden";
export const SOLUTION_QUESTION = "Welche Solution soll Roslyn für die Diagnostik laden?";

export type SolutionStartStep =
  | { kind: "none" }
  | { kind: "open"; path: string }
  | { kind: "ask"; options: readonly string[] };

export type SolutionAnswer =
  | { kind: "none" }
  | { kind: "open"; path: string }
  | { kind: "forward" };

/** Was jemand schon geöffnet hat oder gerade öffnet, bleibt ohne Frage und ohne zweites Laden. */
export const solutionStartStep = (listing: LanguageServerSolutions): SolutionStartStep => {
  if (listing.opened || listing.solutions.length === 0) return { kind: "none" };
  if (listing.solutions.length === 1) return { kind: "open", path: listing.solutions[0].path };
  return { kind: "ask", options: [...listing.solutions.map((solution) => solution.path), NO_SOLUTION] };
};

/** Eine frei formulierte Antwort bekommt der Koordinator, damit sie nicht verloren geht. */
export const solutionAnswer = (options: readonly string[], answer: string): SolutionAnswer => {
  const chosen = answer.trim().replaceAll("\\", "/");
  if (chosen === NO_SOLUTION || answer === DISMISSED_ANSWER) return { kind: "none" };
  return options.includes(chosen) ? { kind: "open", path: chosen } : { kind: "forward" };
};

export interface SolutionOnStartOptions {
  pluginId: string;
  adapterId: string;
  sandbox: () => SandboxServices;
  runtime: () => Orchestration;
  ask: () => AskService;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Lädt beim Start ohne Run-Script die einzige Solution oder fragt bei mehreren; der Merker im Journal lässt das je Run höchstens einmal zu. */
export interface SolutionOnStart {
  lifecycle: SessionLifecycleContribution;
  /** Jemand hat eine Instanz geöffnet; eine noch offene Startfrage erledigt sich damit ohne Laden und ohne Input. */
  opened: (runId: string) => void;
}

export const createSolutionOnStart = (options: SolutionOnStartOptions): SolutionOnStart => {
  const running = new Map<string, AbortController>();
  const openTool = languageServerOpenOperation(options.adapterId);
  const questionCommand = (runId: string): string => `${options.pluginId}.solution-question:${runId}`;

  const marked = (runId: string): boolean => options.runtime().view(runId).pluginStates
    .some((entry) => entry.pluginId === options.pluginId && entry.scope.kind === "run");

  const load = async (runId: string, path: string, ifNoneOpen: boolean, signal: AbortSignal): Promise<void> => {
    await options.sandbox().execute(runId, openTool, { root: path, ifNoneOpen }, { signal });
  };

  const answered = async (runId: string, coordinatorId: string, choices: readonly string[], answer: string, signal: AbortSignal) => {
    const outcome = solutionAnswer(choices, answer);
    if (outcome.kind === "open") return load(runId, outcome.path, false, signal);
    if (outcome.kind === "none") return;
    const runtime = options.runtime();
    runtime.enqueueInput(
      { actorId: runtime.state(runId).ownerId, commandId: `${options.pluginId}.solution-answer:${runId}` },
      runId,
      { actorId: coordinatorId, content: `Antwort auf die Frage: ${SOLUTION_QUESTION}\nAntwort: ${answer}\n${openTool} lädt eine Solution.` },
    );
  };

  const begin = async (runId: string, ownerId: string, coordinatorId: string, signal: AbortSignal): Promise<{ rest: Promise<void> }> => {
    const listing = await options.sandbox().execute(runId, languageServerSolutionsOperation(options.adapterId), null, { signal }) as LanguageServerSolutions;
    const step = solutionStartStep(listing);
    if (step.kind === "none") return { rest: Promise.resolve() };
    if (step.kind === "open") return { rest: load(runId, step.path, true, signal) };
    const answer = options.ask().ask(
      { runId, agentId: ownerId, turnId: null, commandId: questionCommand(runId) },
      {
        question: SOLUTION_QUESTION,
        description: "Im Arbeitsbereich liegen mehrere Solutions; die gewählte lädt Roslyn für die Diagnostik ohne Build.",
        options: [...step.options],
        recipient: coordinatorId,
      },
      signal,
    );
    return { rest: answer.then((text) => answered(runId, coordinatorId, step.options, text, signal)) };
  };

  const finish = (runId: string, controller: AbortController, error?: unknown): void => {
    if (error !== undefined && !controller.signal.aborted) {
      console.error(`${options.pluginId}: Solution beim Start von ${runId} nicht geladen: ${messageOf(error)}`);
    }
    if (running.get(runId) === controller) running.delete(runId);
  };

  const stop = ({ runId }: { runId: string }): void => {
    running.get(runId)?.abort(new Error("Der Run wurde gestoppt"));
    running.delete(runId);
  };

  const opened = (runId: string): void => {
    try {
      const proposed = options.runtime().events(runId).find((event) =>
        event.type === "action.proposed" && event.commandId === questionCommand(runId));
      if (proposed?.type === "action.proposed") options.ask().withdraw(runId, proposed.payload.actionId);
    } catch (error) {
      console.error(`${options.pluginId}: Startfrage von ${runId} nicht verworfen: ${messageOf(error)}`);
    }
  };

  const lifecycle: SessionLifecycleContribution = {
    id: `${options.pluginId}.solution-on-start`,
    sessionStarted: async ({ runId, startEntry }) => {
      if (marked(runId)) return;
      const runtime = options.runtime();
      const { ownerId, primaryActorId } = runtime.state(runId);
      runtime.replacePluginState(
        { actorId: ownerId, commandId: `${options.pluginId}.solution-on-start:${runId}` },
        runId,
        { pluginId: options.pluginId, scope: { kind: "run" }, state: { version: 1, startEntry: startEntry?.id ?? null } },
      );
      if (startEntry?.action === "script") return;
      if (!primaryActorId) throw new Error(`Der Run ${runId} hat beim Start keinen Koordinator, dem eine Antwort zugehen könnte`);
      const controller = new AbortController();
      running.set(runId, controller);
      try {
        const { rest } = await begin(runId, ownerId, primaryActorId, controller.signal);
        void rest.then(() => finish(runId, controller), (error: unknown) => finish(runId, controller, error));
      } catch (error) {
        finish(runId, controller, error);
      }
    },
    stopSession: stop,
    deleteSession: stop,
  };
  return { lifecycle, opened };
};
