import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, DomainError, holdsUsable, type AccessContext, type Orchestration, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { coordinatorRunId } from "./coordinator.js";

export const coordinatorNotifications = (runtime: () => Orchestration, accessFor: (runId: string) => AccessContext): ToolContributor => {
  const available = defineToolAvailability({ availability: "conditional", availabilityDetail: "With actor.input and the run owner's global coordinator write permission." },
    (actor, view) => holdsUsable(actor, "actor.input") && accessFor(view.id).can("ragents.overseer.write"));
  const notify = defineRunFunction({
    name: "overseer_notify",
    label: "Notify global coordinator",
    description: "Send a short result to the current coordinator conversation from an actor in your global space. May trigger a coordinator reply. Requires an explicit app function permission.",
    schema: Type.Object({ message: Type.String({ minLength: 1, maxLength: 1000, pattern: "\\S" }) }, { additionalProperties: false }),
    resultSchema: Type.Object({ sent: Type.Literal(true) }, { additionalProperties: false }),
    available,
    nativeTool: false,
    run: (scope, id, { message }) => {
      const access = accessFor(scope.caller.runId);
      const runId = coordinatorRunId(access.user?.id ?? null);
      if (!access.can("ragents.overseer.write") || scope.caller.runId !== runId) throw new DomainError("coordinator-notification-denied", "Notifications require your own global space and coordinator write permission.", 403);
      const primary = runtime().view(runId).primaryActorId;
      if (!primary) throw new DomainError("coordinator-unavailable", "The global coordinator is unavailable.", 409);
      runtime().enqueueInput({ actorId: scope.caller.actorId, commandId: `overseer-notify:${scope.caller.actorId}:${scope.caller.turnId}:${id}`, ...scope.caller.turnId ? { turnId: scope.caller.turnId } : {} }, runId, { actorId: primary, content: message });
      return { sent: true as const };
    },
  });
  return { name: "ragents.overseer.notifications", descriptors: [toolDescriptorFrom(notify, available)], tools: () => [notify] };
};
