import type { TSchema } from "typebox";
import type { JsonValue, OperationContext } from "@aicontainer/ragents";

export interface OperationDescriptorPort {
  id: string;
  label: string;
  description: string;
  schema: TSchema;
  resultSchema: TSchema;
  operator: "unavailable" | "direct" | "confirm";
}

export type OperationInvocationPort = OperationContext;

export interface ActorOperationPort {
  operation: (id: string) => OperationDescriptorPort | undefined;
  invoke: (id: string, context: OperationInvocationPort, input: JsonValue) => Promise<JsonValue>;
  list: () => readonly OperationDescriptorPort[];
}
