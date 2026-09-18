import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }, {"additionalProperties": false}),
  functions: {
    append: {
      label: "Eintrag hinzufügen",
      description: "Hängt den eingegebenen Text an die gemeinsame Liste an.",
      input: Type.Object({ text: Type.String({"description": "Der Text für den neuen Listeneintrag."}) }, {"additionalProperties": false}),
      output: Type.Object({ text: Type.String(), entries: Type.Array(Type.String()) }, {"additionalProperties": false}),
      capabilities: [],
      tool: {"name": "append_to_list", "targets": ["self"], "card": true},
    },
  },
} as const;
