import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui";

export interface PickerOption {
  readonly value: string;
  readonly label: string;
}

const composerTrigger = "min-w-0 max-w-full border-transparent bg-transparent px-2 font-medium text-muted-foreground dark:bg-transparent";
const formTrigger = "w-full min-w-0 max-w-full";

/** The model and reasoning pickers of every place that chooses a model: ghost pickers in a composer, fields in a form. */
export function ModelPickers({ models, model, onModel, reasoning, reasoningValue, onReasoning, disabled = false, appearance = "form" }: {
  models: readonly PickerOption[];
  model: string;
  onModel: (model: string) => void;
  reasoning: readonly PickerOption[];
  reasoningValue: string | undefined;
  onReasoning: (level: string) => void;
  disabled?: boolean;
  appearance?: "composer" | "form";
}) {
  const composer = appearance === "composer";
  const trigger = composer ? composerTrigger : formTrigger;
  const size = composer ? "sm" : "default";
  const menu = composer ? "min-w-44" : undefined;
  const menuAlign = composer ? "end" : "start";
  // A composer sits at the bottom of its chat, so both menus open upwards there.
  const menuSide = composer ? "top" : "bottom";
  return <div className={composer ? "flex min-w-0 flex-1 flex-wrap items-center gap-1" : "grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(125px,180px)] gap-3 max-sm:grid-cols-[minmax(0,1fr)]"}>
    <Select disabled={disabled} items={models} value={model} onValueChange={(next) => { if (next !== null) onModel(next); }}>
      <SelectTrigger aria-label="Model" className={composer ? `${trigger} flex-1` : trigger} size={size}><SelectValue /></SelectTrigger>
      <SelectContent align={menuAlign} className={menu} side={menuSide}>
        {composer
          ? <SelectGroup><SelectLabel>Model</SelectLabel>{models.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>
          : models.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
    {reasoning.length > 0 && <Select disabled={disabled || reasoning.length < 2} items={reasoning} value={reasoningValue ?? ""} onValueChange={(next) => { if (next !== null) onReasoning(next); }}>
      <SelectTrigger aria-label="Reasoning" className={trigger} size={size}><SelectValue /></SelectTrigger>
      <SelectContent align={menuAlign} className={menu} side={menuSide}>
        {composer
          ? <SelectGroup><SelectLabel>Reasoning</SelectLabel>{reasoning.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>
          : reasoning.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>}
  </div>;
}
