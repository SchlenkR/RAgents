import { Type } from "typebox";
import {
  DomainError,
  defineRunFunction,
  defineToolAvailability,
  holdsUsable,
  type RunFunction,
} from "@ragents/engine";
import { TODO_PLUGIN_ID, TODO_STATUSES, type TodoItem } from "../contract.js";

export const todoToolMetadata = {
  name: "todo_write",
  label: "Write To-do List",
  description: "Create and update this agent's to-do list, which the user sees as its working plan; every call replaces the whole list.",
  longDescription: "Use it for work of three or more distinct steps, for several tasks from the user, or when the user asks for a list; "
    + "skip it for a single straightforward step or a pure question. Send the complete list every time. "
    + "Keep exactly one item in progress while work remains and mark it completed right after the work actually happened, never in advance; "
    + "when blocked, keep it in progress and add an item for the blocker. Give every item both forms: the imperative such as \"Run tests\" "
    + "and the present continuous shown while it runs, such as \"Running tests\".",
} as const;

export const canManageTodos = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Only for agents with the capability plugin.state.write.",
}, (actor) => actor.kind === "agent" && holdsUsable(actor, "plugin.state.write"));

const todoSchema = Type.Object({
  content: Type.String({ minLength: 1, description: "What needs to be done, in the imperative, such as \"Run tests\"" }),
  status: Type.Union(TODO_STATUSES.map((value) => Type.Literal(value)), {
    description: "pending = not started, in_progress = being worked on, one item at a time, completed = actually done",
  }),
  activeForm: Type.String({ minLength: 1, description: "The same step in the present continuous, shown while it is in progress, such as \"Running tests\"" }),
}, { additionalProperties: false });

const checked = (todos: readonly TodoItem[]): TodoItem[] =>
  todos.map((todo, index) => {
    const content = todo.content.trim();
    const activeForm = todo.activeForm.trim();

    if (!content) throw new DomainError("invalid-todo", `todos[${index}].content is empty.`, 400);
    if (!activeForm) throw new DomainError("invalid-todo", `todos[${index}].activeForm is empty.`, 400);

    return { content, status: todo.status, activeForm };
  });

export const createTodoTool = (): RunFunction =>
  defineRunFunction({
    ...todoToolMetadata,
    schema: Type.Object({
      todos: Type.Array(todoSchema, { description: "The updated todo list, complete and in order; it replaces the previous one" }),
    }, { additionalProperties: false }),
    resultSchema: Type.Null(),
    available: canManageTodos,
    run: ({ runtime, caller, context }, toolCallId, input) => {
      runtime.replacePluginState(context(toolCallId), caller.runId, {
        pluginId: TODO_PLUGIN_ID,
        scope: { kind: "actor", actorId: caller.actorId },
        state: { todos: checked(input.todos) },
      });

      return null;
    },
  });
