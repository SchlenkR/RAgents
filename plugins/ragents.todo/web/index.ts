import { TodoSection } from "./TodoSection";
import type { WebPlugin } from "@ragents/web/PluginRegistry";

export const webPlugin: WebPlugin = {
  id: "ragents.todo",
  needsRunView: true,
  cardSections: [{
    id: "ragents.todo.items",
    order: 200,
    Section: TodoSection,
  }],
};
