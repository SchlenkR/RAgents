import { Type } from "typebox";
import {
  DomainError,
  defineRunFunction,
  defineToolAvailability,
  eventResultSchema,
  holdsUsable,
  type RunFunction,
} from "@ragents/engine";
import { TODO_PLUGIN_ID, TODO_STATUS_INPUTS, todoStatusOf } from "../contract.js";

export const todoToolMetadata = {
  name: "todo_replace",
  label: "Replace To-do List",
  description: "Replace this agent's complete to-do snapshot with its current progress.",
  longDescription: "Mark an item completed only AFTER the work actually happened, never in advance; "
    + "update the list as you go so at most one item is active.",
} as const;

export const canManageTodos = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Nur für Agenten mit der Capability plugin.state.write.",
}, (actor) => actor.kind === "agent" && holdsUsable(actor, "plugin.state.write"));

const checked = (todos: readonly { id: string; text: string; status: string }[]) => {
  const seen = new Set<string>();

  return todos.map((todo, index) => {
    const id = todo.id.trim();
    const text = todo.text.trim();
    const status = todoStatusOf(todo.status);

    if (!id) throw new DomainError("invalid-todo", `todos[${index}].id ist leer.`, 400);
    if (!text) throw new DomainError("invalid-todo", `todos[${index}].text ist leer.`, 400);
    if (!status) throw new DomainError("invalid-todo", `todos[${index}].status ${todo.status} ist unbekannt.`, 400);
    if (seen.has(id)) throw new DomainError("duplicate-todo-id", `To-do ID ${id} occurs more than once.`, 400);

    seen.add(id);

    return { id, text, status };
  });
};

export const createTodoTool = (): RunFunction =>
  defineRunFunction({
    ...todoToolMetadata,
    schema: Type.Object({
      todos: Type.Array(
        Type.Object({
          id: Type.String({ minLength: 1 }),
          text: Type.String({ minLength: 1 }),
          status: Type.Union(TODO_STATUS_INPUTS.map((value) => Type.Literal(value)), {
            description: "open = offen, active = in Arbeit, completed = erledigt; "
              + "pending, in_progress und done werden ebenfalls angenommen",
          }),
        }),
      ),
    }),
    resultSchema: eventResultSchema,
    available: canManageTodos,
    run: ({ runtime, caller, context, eventsFor }, toolCallId, input) => {
      runtime.replacePluginState(context(toolCallId), caller.runId, {
        pluginId: TODO_PLUGIN_ID,
        scope: { kind: "actor", actorId: caller.actorId },
        state: { todos: checked(input.todos) },
      });

      return eventsFor(toolCallId);
    },
  });
