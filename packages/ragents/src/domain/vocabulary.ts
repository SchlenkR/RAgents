export const capabilityNames = [
    "actor.input",
    "event.subscribe",
    "agent.spawn",
    "artifact.publish",
    "plugin.state.write",
    // Legacy grant, kept because every existing journal grants it to the run owner.
    "action.propose",
    "workspace.use",
    "execution.stopOwned",
    "run.configure",
    "script.start",
] as const;

export type CapabilityName = (typeof capabilityNames)[number];

/** Whoever gets one of these from the owner holds it without passing it on, so it never reaches the agents they spawn. */
export const firstHandCapabilities: readonly CapabilityName[] = ["script.start"];

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
