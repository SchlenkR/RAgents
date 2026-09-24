import { defineActor } from "@ragents/server";
import { workflowInstructions } from "@ragents/workflow";
import { readPrompt } from "@ragents/workflow/prompts";
import { helperSteps, learningWorkflow } from "./workflow.ts";
import { Type } from "typebox";
import { initialState, type HelperState, type LearningState } from "./state.ts";

const helperSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  task: Type.String(),
  status: Type.Union([Type.Literal("waiting"), Type.Literal("working"), Type.Literal("complete"), Type.Literal("error")]),
  text: Type.String(),
  error: Type.Optional(Type.String()),
  actorId: Type.Optional(Type.String()),
  inputId: Type.Optional(Type.String()),
}, { additionalProperties: false });

const contract = {
  state: Type.Object({
    board: Type.Optional(Type.Object({
      phase: Type.Union([Type.Literal("ready"), Type.Literal("working"), Type.Literal("complete"), Type.Literal("error")]),
      helpers: Type.Array(helperSchema),
    }, { additionalProperties: false })),
    subscriptionId: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  functions: {
    start: {
      label: "Ideen sammeln",
      input: Type.Object({}, { additionalProperties: false }),
      output: Type.Object({}, { additionalProperties: false }),
      capabilities: ["actor_input"],
    },
  },
  input: { capabilities: ["model_list", "agent_spawn", "canvas_layout_replace", "run_configure", "actor_input", "event_subscribe", "event_unsubscribe", "event_query"] },
} as const;

const startMarker = "START_LEARNING_AFTERNOON";


type Tile = { entity: string } | { direction: "vertical"; weights: [number, number]; children: [Tile, Tile] };

function stackedTiles(entities: string[]): Tile {
  const [first, ...rest] = entities;
  return rest.length === 0 ? { entity: first! } : { direction: "vertical", weights: [1, rest.length], children: [{ entity: first! }, stackedTiles(rest)] };
}

function boardWith(helpers: HelperState[]): LearningState {
  const working = helpers.some((helper) => helper.status === "working");
  return { phase: working ? "working" : helpers.some((helper) => helper.status === "error") ? "error" : "complete", helpers };
}

export default defineActor(contract, {
  functions: {
    start: async (_input, context) => {
      if (context.state.read().board?.phase !== "ready") return {};
      await context.functions.actor_input({ actor: `@${context.actor.handle}`, content: startMarker });
      return {};
    },
  },
  onInput: async (input, context) => {
    const state = context.state.read();
    if (state.board && !input.event && input.content !== startMarker) {
      throw new Error("Der Lernnachmittag versteht keine freien Chatnachrichten. Verwende den Startknopf der Mini-App; für neue Ideen ist ein neuer Run nötig.");
    }
    if (!state.board) {
      const catalog = await context.functions.model_list({});
      const profile = catalog.profiles.find((entry) => entry.driver === "agent" && entry.name === "standard");
      if (!profile) throw new Error("Das Modellprofil standard fehlt.");
      const prompt = await workflowInstructions(learningWorkflow, "helper", readPrompt);
      const helpers = await Promise.all(initialState.helpers.map(async (helper) => {
        const actor = await context.functions.agent_spawn({ handle: `learning-${helper.id}`, displayName: helper.label, profile: profile.name, prompt, tools: [] });
        return { ...helper, actorId: actor.id };
      }));
      await context.functions.canvas_layout_replace({
        root: {
          direction: "horizontal",
          weights: [1, 1],
          children: [{ entity: `app:@${context.actor.handle}/main` }, stackedTiles(helpers.map((helper) => `@learning-${helper.id}`))],
        },
      });
      await context.functions.run_configure({ title: learningWorkflow.title, primaryActor: `@${context.actor.handle}` });
      context.state.replace({ board: { phase: "ready", helpers } });
      return;
    }

    if (state.board.phase === "ready" && !input.event && input.content === startMarker) {
      const subscription = await context.functions.event_subscribe({
        sourceActorIds: state.board.helpers.map((helper) => helper.actorId!),
        eventTypes: ["turn.finished", "turn.interrupted", "actor.stopped"],
        includeSelf: false,
      });
      const results = await Promise.allSettled(state.board.helpers.map(async (helper): Promise<HelperState> => {
        const step = helperSteps.find((entry) => entry.id === helper.id);
        if (!step) throw new Error(`Unbekannter Helfer: ${helper.id}`);
        const content = step.goal;
        const events = await context.functions.actor_input({ actor: `@learning-${helper.id}`, content });
        const queued = events.find((event) => event.type === "actor.input.enqueued");
        if (!queued || queued.type !== "actor.input.enqueued") throw new Error("Der Auftrag wurde nicht bestätigt.");
        return { ...helper, inputId: queued.payload.inputId, status: "working" };
      }));
      const helpers = state.board.helpers.map((helper, index): HelperState => {
        const result = results[index]!;
        return result.status === "fulfilled" ? result.value : { ...helper, status: "error", error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
      });
      const board = boardWith(helpers);
      if (board.phase !== "working") await context.functions.event_unsubscribe({ subscriptionId: subscription.subscriptionId, reason: "Beide Aufträge sind beendet." });
      context.state.replace({ board, subscriptionId: subscription.subscriptionId });
      return;
    }

    const event = input.event;
    if (state.board.phase !== "working" || !event || input.subscriptionId !== state.subscriptionId) return;
    const helper = state.board.helpers.find((entry) => entry.actorId === event.sourceActorId && entry.status === "working");
    if (!helper) return;
    const next = await (async (): Promise<HelperState | undefined> => {
      if (event.type === "actor.stopped") return { ...helper, status: "error", error: "Der Helfer wurde gestoppt." };
      if (event.type !== "turn.finished" && event.type !== "turn.interrupted") return;
      const payload = event.payload;
      const turnId = payload.turnId;
      if (typeof turnId !== "string") return;
      const history = await context.functions.event_query({ actorIds: [helper.actorId!], eventTypes: ["turn.started", "model.output.completed"], limit: 100 });
      const events = history.map((entry) => ({ type: entry.type, payload: entry.payload as Record<string, unknown> }));
      const started = events.find((entry) => entry.type === "turn.started" && entry.payload.turnId === turnId);
      if (!started || started.payload.inputId !== helper.inputId) return;
      const text = events.filter((entry) => entry.type === "model.output.completed" && entry.payload.turnId === turnId)
        .map((entry) => typeof entry.payload.text === "string" ? entry.payload.text.trim() : "").filter(Boolean).join("\n\n");
      if (event.type === "turn.finished" && payload.outcome === "completed" && text) return { ...helper, text, status: "complete" };
      const error = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason : "Der Helfer hat keine Idee geliefert.";
      return { ...helper, status: "error", error };
    })();
    if (!next) return;
    const board = boardWith(state.board.helpers.map((entry) => entry.id === next.id ? next : entry));
    if (board.phase !== "working") await context.functions.event_unsubscribe({ subscriptionId: state.subscriptionId!, reason: "Beide Aufträge sind beendet." });
    context.state.replace({ ...state, board });
  },
});
