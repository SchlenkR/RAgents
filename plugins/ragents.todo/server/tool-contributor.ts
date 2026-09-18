import type { ToolContributor } from "@aicontainer/ragents";
import { toolDescriptorFrom } from "@aicontainer/server/plugin-support/agent-tool.js";
import { canManageTodos, createTodoTool, todoToolMetadata } from "./todo-tool.js";

export const createTodoToolContributor = (): ToolContributor => ({
  name: "ragents.todo",
  descriptors: [toolDescriptorFrom(todoToolMetadata, canManageTodos)],
  tools: () => [createTodoTool()],
});
