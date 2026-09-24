import type { TSchema } from "typebox";
import type { JsonValue, OperationContext } from "@ragents/engine";

export interface OperationDescriptorPort {
  id: string;
  label: string;
  description: string;
  schema: TSchema;
  resultSchema: TSchema;
  operator: "unavailable" | "direct" | "confirm";
}

export interface ActorOperationPort {
  operation: (id: string) => OperationDescriptorPort | undefined;
  invoke: (id: string, context: OperationContext, input: JsonValue) => Promise<JsonValue>;
  list: () => readonly OperationDescriptorPort[];
}
