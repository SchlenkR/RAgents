export const TODO_PLUGIN_ID = "ragents.todo";

export const TODO_STATUSES = ["open", "active", "completed"] as const;
export const TODO_STATUS_INPUTS = ["open", "active", "completed", "pending", "in_progress", "done"] as const;
export type TodoStatus = typeof TODO_STATUSES[number];

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

export interface TodoState {
  todos: TodoItem[];
}

export const todoStatusOf = (value: unknown): TodoStatus | undefined => {
  if (typeof value !== "string") return undefined;

  switch (value.trim().toLowerCase()) {
    case "open":
    case "offen":
    case "pending":
      return "open";
    case "active":
    case "doing":
    case "in_progress":
    case "in arbeit":
    case "running":
      return "active";
    case "completed":
    case "done":
    case "erledigt":
    case "finished":
      return "completed";
    default:
      return undefined;
  }
};

const itemOf = (value: unknown): TodoItem | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<TodoItem>;
  const status = todoStatusOf(candidate.status);

  return typeof candidate.id === "string" && typeof candidate.text === "string" && status
    ? { id: candidate.id, text: candidate.text, status }
    : undefined;
};

export const todoStateOf = (state: unknown): TodoState | undefined => {
  const candidate = state as Partial<TodoState> | undefined;
  if (!Array.isArray(candidate?.todos)) return undefined;
  const todos = candidate.todos.flatMap((value) => {
    const item = itemOf(value);
    return item ? [item] : [];
  });

  return todos.length === candidate.todos.length ? { todos } : undefined;
};
