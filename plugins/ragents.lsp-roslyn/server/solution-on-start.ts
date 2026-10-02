import type { Orchestration, SessionLifecycleContribution } from "@ragents/engine";
import {
  languageServerOpenOperation,
  languageServerSolutionsOperation,
  type LanguageServerSolutions,
} from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { answerMessageOf, type AskOutcome, type AskQuestion, type AskService } from "@ragents/plugins/ragents.ask/server/contract.js";

export const SOLUTION_ON_START_VARIABLE = "ROSLYN_SOLUTION_ON_START";
export const SOLUTION_PREFERRED_VARIABLE = "ROSLYN_SOLUTION_PREFERRED";
export const NO_SOLUTION = "Load none";
export const SOLUTION_QUESTION = "Which solution should Roslyn load for diagnostics?";

/** The start question: every candidate solution and "Load none"; the service allows more than the four options of ask_user. */
export const solutionQuestion = (options: readonly string[]): AskQuestion => ({
  question: SOLUTION_QUESTION,
  header: "Solution",
  options: options.map((option) => ({
    label: option,
    description: option === NO_SOLUTION ? "Start without C# diagnostics; the coordinator can load one later." : "Load this solution for C# diagnostics.",
  })),
  multiSelect: false,
});

export type SolutionStartStep =
  | { kind: "none" }
  | { kind: "open"; path: string }
  | { kind: "ask"; options: readonly string[] };

export type SolutionAnswer =
  | { kind: "none" }
  | { kind: "open"; path: string }
  | { kind: "forward" };

/** The preference also matches in a subdirectory, e.g. when the workspace is the folder above the checkout. */
const matchesPreferred = (solution: string, preferred: string): boolean => {
  const path = solution.toLowerCase();
  const expected = preferred.toLowerCase();
  return path === expected || path.endsWith(`/${expected}`);
};

/** What someone has already opened or is opening stays without a question and without a second load; if the preference matches, only the matching solutions count. */
export const solutionStartStep = (listing: LanguageServerSolutions, preferred?: string): SolutionStartStep => {
  if (listing.opened || listing.solutions.length === 0) return { kind: "none" };
  const paths = listing.solutions.map((solution) => solution.path);
  const matching = preferred === undefined ? [] : paths.filter((path) => matchesPreferred(path, preferred));
  const candidates = matching.length > 0 ? matching : paths;
  if (candidates.length === 1) return { kind: "open", path: candidates[0] };
  return { kind: "ask", options: [...candidates, NO_SOLUTION] };
};

/** A freely worded answer that names no option goes to the coordinator so it does not get lost. */
export const solutionAnswer = (options: readonly string[], outcome: AskOutcome): SolutionAnswer => {
  if (outcome.kind === "dismissed") return { kind: "none" };
  const answer = outcome.answers[0]!;
  const chosen = "text" in answer ? answer.text.trim().replaceAll("\\", "/") : answer.selected[0]!;
  if (chosen === NO_SOLUTION) return { kind: "none" };
  return options.includes(chosen) ? { kind: "open", path: chosen } : { kind: "forward" };
};

export interface SolutionOnStartOptions {
  pluginId: string;
  adapterId: string;
  preferred?: string;
  sandbox: () => SandboxServices;
  runtime: () => Orchestration;
  ask: () => AskService;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** On a start without a run script, loads the preference or the only solution, or asks if there are several; the marker in the journal allows this at most once per run. */
export interface SolutionOnStart {
  lifecycle: SessionLifecycleContribution;
  /** Someone opened an instance; a still open start question is thereby settled without loading and without input. */
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

  const answered = async (runId: string, coordinatorId: string, choices: readonly string[], outcome: AskOutcome, signal: AbortSignal) => {
    const answer = solutionAnswer(choices, outcome);
    if (answer.kind === "open") return load(runId, answer.path, false, signal);
    if (answer.kind === "none") return;
    const runtime = options.runtime();
    runtime.enqueueInput(
      { actorId: runtime.state(runId).ownerId, commandId: `${options.pluginId}.solution-answer:${runId}` },
      runId,
      { actorId: coordinatorId, content: `${answerMessageOf([solutionQuestion(choices)], outcome, "the")}\n${openTool} loads a solution.` },
    );
  };

  const begin = async (runId: string, ownerId: string, coordinatorId: string, signal: AbortSignal): Promise<{ rest: Promise<void> }> => {
    const listing = await options.sandbox().execute(runId, languageServerSolutionsOperation(options.adapterId), null, { signal }) as LanguageServerSolutions;
    const step = solutionStartStep(listing, options.preferred);
    if (step.kind === "none") return { rest: Promise.resolve() };
    if (step.kind === "open") return { rest: load(runId, step.path, true, signal) };
    const outcome = options.ask().ask(
      { runId, agentId: ownerId, turnId: null, commandId: questionCommand(runId) },
      {
        questions: [solutionQuestion(step.options)],
        description: "The workspace contains several solutions; Roslyn loads the chosen one for diagnostics without a build.",
        recipient: coordinatorId,
      },
      signal,
    );
    return { rest: outcome.then((answer) => answered(runId, coordinatorId, step.options, answer, signal)) };
  };

  const finish = (runId: string, controller: AbortController, error?: unknown): void => {
    if (error !== undefined && !controller.signal.aborted) {
      console.error(`${options.pluginId}: solution not loaded on start of ${runId}: ${messageOf(error)}`);
    }
    if (running.get(runId) === controller) running.delete(runId);
  };

  const stop = ({ runId }: { runId: string }): void => {
    running.get(runId)?.abort(new Error("The run was stopped"));
    running.delete(runId);
  };

  const opened = (runId: string): void => {
    try {
      const proposed = options.runtime().events(runId).find((event) =>
        event.type === "action.proposed" && event.commandId === questionCommand(runId));
      if (proposed?.type === "action.proposed") options.ask().withdraw(runId, proposed.payload.actionId);
    } catch (error) {
      console.error(`${options.pluginId}: start question of ${runId} not dismissed: ${messageOf(error)}`);
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
      if (!primaryActorId) throw new Error(`The run ${runId} has no coordinator on start that could receive an answer`);
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
