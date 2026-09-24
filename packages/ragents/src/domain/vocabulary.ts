export const capabilityNames = [
    "actor.input",
    "event.subscribe",
    "agent.spawn",
    "artifact.publish",
    "plugin.state.write",
    "action.propose",
    "workspace.use",
    "execution.stopOwned",
    "run.configure",
] as const;

export type CapabilityName = (typeof capabilityNames)[number];

export const isCapabilityName = (value: unknown): value is CapabilityName =>
    typeof value === "string" && (capabilityNames as readonly string[]).includes(value);

export const observableEventTypes = [
    "turn.finished",
    "turn.interrupted",
    "model.output.completed",
    "model.reasoning.completed",
    "runtime.output.recorded",
    "tool.call.started",
    "tool.call.completed",
    "tool.call.failed",
    "actor.stopped",
    "actor.restarted",
    "action.proposed",
    "action.resolved",
    "artifact.published",
] as const;

export type ObservableEventType = (typeof observableEventTypes)[number];

export const isObservableEventType = (value: unknown): value is ObservableEventType =>
    typeof value === "string" && (observableEventTypes as readonly string[]).includes(value);
