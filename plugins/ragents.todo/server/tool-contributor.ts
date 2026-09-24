import type { ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { canManageTodos, createTodoTool, todoToolMetadata } from "./todo-tool.js";

export const createTodoToolContributor = (): ToolContributor => ({
  name: "ragents.todo",
  descriptors: [toolDescriptorFrom(todoToolMetadata, canManageTodos)],
  tools: () => [createTodoTool()],
});
