import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, DomainError, type AccessContext, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import type { RunManagement } from "@ragents/host/ragents/global-chat.js";
import { isCoordinatorRunId } from "./coordinator.js";

const status = Type.Union([Type.Literal("paused"), Type.Literal("running"), Type.Literal("waiting"), Type.Literal("idle"), Type.Literal("ended"), Type.Literal("locked")], {
  description: "As the run list shows it; locked for a run whose journal cannot be read",
});

/** The run list of the global space's owner, as the interface shows it, without identifiers a model would copy. */
export const runListing = (management: () => RunManagement, accessFor: (runId: string) => AccessContext): ToolContributor => {
  const available = defineToolAvailability({ availability: "conditional", availabilityDetail: "In the global space of a user with runs.read." },
    (actor, view) => actor.kind !== "human" && isCoordinatorRunId(view.id) && accessFor(view.id).can("runs.read"));
  const list = defineRunFunction({
    name: "run_list",
    label: "List runs",
    description: "List the runs of your user as the run list shows them, newest first, with title, status and last activity.",
    schema: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "How many of the newest runs; 5 when omitted" })),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({
      runs: Type.Array(Type.Object({
        title: Type.String({ maxLength: 200, description: "One line, shortened with ... beyond 200 characters" }),
        status,
        lastActivity: Type.String({ description: "ISO time of the run's last change" }),
      }, { additionalProperties: false }), { maxItems: 20 }),
      hasMore: Type.Boolean({ description: "Whether older runs follow" }),
    }, { additionalProperties: false }),
    available,
    run: async (scope, _id, { limit }) => {
      const access = accessFor(scope.caller.runId);
      if (!isCoordinatorRunId(scope.caller.runId) || !access.can("runs.read")) {
        throw new DomainError("run-list-denied", "Runs are listed only in your own global space and with runs.read.", 403);
      }
      const runs = await management().list(access);
      const shown = runs.slice(0, limit ?? 5);
      return {
        runs: shown.map((run) => {
          const title = run.title.replace(/\s+/g, " ").trim();
          return { title: title.length > 200 ? `${title.slice(0, 197)}...` : title,
            status: run.locked === undefined ? run.state : "locked" as const, lastActivity: new Date(run.updatedAt).toISOString() };
        }),
        hasMore: runs.length > shown.length,
      };
    },
  });
  return { name: "ragents.overseer.runs", descriptors: [toolDescriptorFrom(list, available)], tools: () => [list] };
};
