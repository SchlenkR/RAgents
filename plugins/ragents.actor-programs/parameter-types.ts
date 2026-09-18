export const actorFunctionParameterTypes = ["string", "number", "integer", "boolean", "string[]", "number[]", "json"] as const;

export type ActorFunctionParameterType = typeof actorFunctionParameterTypes[number];
