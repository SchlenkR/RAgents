export const TODO_PLUGIN_ID = "ragents.todo";

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = typeof TODO_STATUSES[number];

export type TodoItem = {
  content: string;
  status: TodoStatus;
  activeForm: string;
};

export type TodoState = {
  todos: TodoItem[];
};

const isTodoStatus = (value: unknown): value is TodoStatus => (TODO_STATUSES as readonly unknown[]).includes(value);

const itemOf = (value: unknown): TodoItem | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<TodoItem>;

  return typeof candidate.content === "string" && typeof candidate.activeForm === "string" && isTodoStatus(candidate.status)
    ? { content: candidate.content, status: candidate.status, activeForm: candidate.activeForm }
    : undefined;
};

/** Only the current shape is a to-do list; a state of another shape, such as one of the former contract, is none. */
export const todoStateOf = (state: unknown): TodoState | undefined => {
  const candidate = state as Partial<TodoState> | undefined;
  if (!Array.isArray(candidate?.todos)) return undefined;
  const todos = candidate.todos.flatMap((value) => {
    const item = itemOf(value);
    return item ? [item] : [];
  });

  return todos.length === candidate.todos.length ? { todos } : undefined;
};
