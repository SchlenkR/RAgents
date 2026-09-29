import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }, {"additionalProperties": false}),
  functions: {
    append: {
      label: "Add entry",
      description: "Appends the entered text to the shared list.",
      input: Type.Object({ text: Type.String({"description": "The text for the new list entry."}) }, {"additionalProperties": false}),
      output: Type.Object({ text: Type.String(), entries: Type.Array(Type.String()) }, {"additionalProperties": false}),
      capabilities: [],
      tool: {"name": "append_to_list", "targets": ["self"], "card": true},
    },
  },
} as const;
