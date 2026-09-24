import { actorPluginState, runActorFrom, runViewFrom } from "@ragents/web/run-view";
import { TODO_PLUGIN_ID, todoStateOf, type TodoItem } from "../contract";
import type { CardSectionContext } from "@ragents/web/PluginRegistry";
import { SectionLabel } from "@ragents/web/ui";

const MAX_ITEMS = 12;
const markerOf = (todo: TodoItem) => todo.status;

const markerClass = "grid size-[15px] mt-px place-items-center rounded-full border-[1.5px] border-foreground/55 text-[0px] not-italic"
  + " in-data-[status=active]:border-primary in-data-[status=active]:bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))]"
  + " in-data-[status=completed]:border-success in-data-[status=completed]:bg-success";

export function TodoSection({ actor, session }: CardSectionContext) {
  const view = runViewFrom(session.runView);
  if (!view) return null;
  const state = todoStateOf(actorPluginState(view, TODO_PLUGIN_ID, runActorFrom(actor).id));
  const todos = state?.todos ?? [];
  if (todos.length === 0) return null;
  const done = todos.filter((todo) => markerOf(todo) === "completed").length;

  return (
    <section className="grid gap-1.5">
      <SectionLabel>
        <span>To-do</span>
        <small>{done}/{todos.length}</small>
      </SectionLabel>
      <ul className="grid list-none">
        {todos.slice(0, MAX_ITEMS).map((todo) => (
          <li className="grid grid-cols-[15px_minmax(0,1fr)] items-start gap-2 border-t border-border-soft py-1.5 text-[0.74rem] leading-[1.35] first:border-t-0 first:pt-0 last:pb-0"
            data-status={markerOf(todo)} key={todo.id}>
            <i aria-hidden className={markerClass}>{markerOf(todo) === "completed" && <IconCheck />}</i>
            <span className="overflow-hidden text-ellipsis in-data-[status=completed]:opacity-75" title={todo.text}>{todo.text}</span>
          </li>
        ))}
      </ul>
      {todos.length > MAX_ITEMS && <small className="pl-0.5 text-xs text-muted-foreground">+{todos.length - MAX_ITEMS} weitere</small>}
    </section>
  );
}

function IconCheck() {
  return (
    <svg aria-hidden className="size-[11px] fill-none stroke-card [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.2]" viewBox="0 0 12 12">
      <path d="M3.1 6.2 5 8.1l3.9-4.2" />
    </svg>
  );
}
