import { useId, useMemo, useState, type FormEvent } from "react";
import { choicesOf, parameterKindOf, type ParameterKind } from "../../server/src/plugin-support/actor-programs/parameter-kinds";
import type { ScriptParameters } from "../../server/src/plugin-support/actor-programs/script-parameters";
import { modelStartOptionId, type StartOptionState } from "../../server/src/plugin-support/start-options-contract";
import { useStartOptions } from "./StartOptions";
import { Button, Checkbox, ChoiceSelect, Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle, Input, Textarea } from "./ui";

type Schema = ScriptParameters["properties"][string];

export interface ParameterField {
  readonly name: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly required: boolean;
  readonly kind: ParameterKind;
  readonly maxLength: number | undefined;
  readonly minimum: number | undefined;
  readonly maximum: number | undefined;
  readonly choices: readonly string[];
  readonly initial: string | boolean | undefined;
}

/** What the user has typed or chosen by parameter name; a number stays the typed text, and a boolean nobody touched is absent. */
export type ParameterDraft = Readonly<Record<string, string | boolean>>;
export type ParameterValues = Readonly<Record<string, string | number | boolean>>;

type ParameterEntry = { readonly value: string | number | boolean } | { readonly problem: string } | undefined;

const longTextLimit = 200;
const actionsClass = "flex flex-wrap justify-end gap-3 pt-2";
const alertClass = "type-body text-destructive [overflow-wrap:anywhere]";

const textOf = (value: unknown): string | undefined => typeof value === "string" && value.trim() !== "" ? value : undefined;
const numberOf = (value: unknown): number | undefined => typeof value === "number" ? value : undefined;

const kindOf = (name: string, schema: Schema): ParameterKind => {
  const kind = parameterKindOf(schema);
  if (!kind) throw new Error(`The parameter ${name} is no string, number, integer, boolean or choice of strings, so the form cannot show it.`);
  return kind;
};

const initialOf = (kind: ParameterKind, value: unknown): string | boolean | undefined => {
  if (kind === "boolean") return typeof value === "boolean" ? value : undefined;
  if (kind === "integer" || kind === "number") return typeof value === "number" ? String(value) : undefined;
  return typeof value === "string" ? value : undefined;
};

/** One field per declared parameter in declaration order; a parameter of another shape than the contract allows is an error. */
export const parameterFields = (parameters: ScriptParameters): readonly ParameterField[] => Object.entries(parameters.properties).map(([name, schema]) => {
  const kind = kindOf(name, schema);
  return {
    name,
    label: textOf(schema.title) ?? name,
    description: textOf(schema.description),
    required: parameters.required.includes(name),
    kind,
    maxLength: numberOf(schema.maxLength),
    minimum: numberOf(schema.minimum),
    maximum: numberOf(schema.maximum),
    choices: choicesOf(schema),
    initial: initialOf(kind, schema.default),
  };
});

export const initialDraft = (fields: readonly ParameterField[]): ParameterDraft =>
  Object.fromEntries(fields.flatMap((field) => field.initial === undefined ? [] : [[field.name, field.initial] as const]));

const numberEntry = (field: ParameterField, text: string): ParameterEntry => {
  const value = Number(text);
  if (!Number.isFinite(value)) return { problem: "Enter a valid number." };
  if (field.kind === "integer" && !Number.isInteger(value)) return { problem: "Enter a whole number." };
  if (field.minimum !== undefined && value < field.minimum) return { problem: `Minimum: ${field.minimum}.` };
  if (field.maximum !== undefined && value > field.maximum) return { problem: `Maximum: ${field.maximum}.` };
  return { value };
};

const entryOf = (field: ParameterField, draft: ParameterDraft): ParameterEntry => {
  const given = draft[field.name];
  if (field.kind === "boolean") return typeof given === "boolean" ? { value: given } : field.required ? { value: false } : undefined;
  const text = typeof given === "string" ? given.trim() : "";
  if (text === "") return field.required ? { problem: "This field is required." } : undefined;
  if (field.kind === "choice") return field.choices.includes(text) ? { value: text } : { problem: "Choose one of the available values." };
  if (field.kind === "integer" || field.kind === "number") return numberEntry(field, text);
  return { value: text };
};

/** The parameters to start with: only what is filled, numbers as numbers and booleans as booleans; problems by parameter name for what is missing or invalid. */
export const buildParameters = (fields: readonly ParameterField[], draft: ParameterDraft): { readonly values: ParameterValues; readonly problems: Readonly<Record<string, string>> } => {
  const entries = fields.map((field) => [field.name, entryOf(field, draft)] as const);
  return {
    values: Object.fromEntries(entries.flatMap(([name, entry]) => entry !== undefined && "value" in entry ? [[name, entry.value] as const] : [])),
    problems: Object.fromEntries(entries.flatMap(([name, entry]) => entry !== undefined && "problem" in entry ? [[name, entry.problem] as const] : [])),
  };
};

const isModelPresentation = (value: unknown): value is { readonly provider: string; readonly options: readonly string[] } =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "model"
  && "provider" in value && typeof value.provider === "string"
  && "options" in value && Array.isArray(value.options) && value.options.every((option) => typeof option === "string");

/** The model names the run's model option offers as provider/model; none while the user account is not offered the option. */
export const modelNamesOf = (options: readonly StartOptionState[]): readonly string[] => {
  const presentation = options.find((option) => option.id === modelStartOptionId)?.presentation;
  if (presentation === undefined) return [];
  if (!isModelPresentation(presentation)) throw new Error(`The start option ${modelStartOptionId} does not provide a model presentation.`);
  return presentation.options.map((model) => presentation.provider ? `${presentation.provider}/${model}` : model);
};

type Shown = { readonly fields: readonly ParameterField[]; readonly models: readonly string[] } | { readonly problem: string };

const shownFor = (parameters: ScriptParameters, options: readonly StartOptionState[]): Shown => {
  try {
    const fields = parameterFields(parameters);
    return { fields, models: fields.some((field) => field.kind === "model") ? modelNamesOf(options) : [] };
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : String(cause) };
  }
};

interface ParameterFormProps {
  readonly parameters: ScriptParameters;
  readonly submitLabel?: string;
  /** While a start is under way. */
  readonly disabled?: boolean;
  readonly onSubmit: (parameters: ParameterValues) => void;
  readonly onCancel: () => void;
}

/** A run script's declared parameters as a form; the server's refusal of the submitted values is shown by whoever starts the script. */
export function ParameterForm({ parameters, ...rest }: ParameterFormProps) {
  const { options } = useStartOptions();
  const shown = useMemo(() => shownFor(parameters, options), [parameters, options]);
  if ("problem" in shown) return <div className="grid gap-3">
    <p className={alertClass} role="alert">{shown.problem}</p>
    <div className={actionsClass}><Button onClick={rest.onCancel} type="button" variant="outline">Cancel</Button></div>
  </div>;
  return <ParameterFields {...rest} fields={shown.fields} models={shown.models} />;
}

function ParameterFields({ fields, models, submitLabel = "Start", disabled = false, onSubmit, onCancel }: Omit<ParameterFormProps, "parameters"> & {
  readonly fields: readonly ParameterField[];
  readonly models: readonly string[];
}) {
  const prefix = useId();
  const [draft, setDraft] = useState<ParameterDraft>(() => initialDraft(fields));
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const idOf = (name: string) => `${prefix}-${name}`;
  const change = (name: string, value: string | boolean) => {
    setDraft((current) => ({ ...current, [name]: value }));
    setProblems((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== name)));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = buildParameters(fields, draft);
    setProblems(built.problems);
    const invalid = fields.find((field) => built.problems[field.name] !== undefined);
    if (invalid !== undefined) event.currentTarget.ownerDocument.getElementById(idOf(invalid.name))?.focus();
    else onSubmit(built.values);
  };
  return <form aria-label="Parameters" className="grid gap-4" noValidate onSubmit={submit}>
    <FieldGroup>
      {fields.map((field) => {
        const id = idOf(field.name);
        const problem = problems[field.name];
        const value = draft[field.name];
        const text = typeof value === "string" ? value : "";
        const label = field.required ? `${field.label} *` : field.label;
        const described = [field.description !== undefined && `${id}-description`, problem !== undefined && `${id}-problem`].filter(Boolean).join(" ") || undefined;
        const description = field.description !== undefined && <FieldDescription id={`${id}-description`}>{field.description}</FieldDescription>;
        const error = problem !== undefined && <FieldError id={`${id}-problem`}>{problem}</FieldError>;
        const shared = { "aria-describedby": described, "aria-invalid": problem !== undefined || undefined, disabled, id, required: field.required };
        if (field.kind === "boolean") return <Field data-invalid={problem !== undefined || undefined} key={field.name} orientation="horizontal">
          <Checkbox {...shared} checked={value === true} onCheckedChange={(checked) => change(field.name, checked)} />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description}
            {error}
          </div>
        </Field>;
        if (field.kind === "choice") return <Field data-invalid={problem !== undefined || undefined} key={field.name}>
          <FieldTitle>{label}</FieldTitle>
          <div><ChoiceSelect disabled={disabled} label={field.label} onValueChange={(next) => change(field.name, next)} options={field.choices.map((choice) => ({ value: choice, label: choice }))} value={text} /></div>
          {description}
          {error}
        </Field>;
        return <Field data-invalid={problem !== undefined || undefined} key={field.name}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {field.kind === "integer" || field.kind === "number"
            ? <Input {...shared} inputMode={field.kind === "integer" ? "numeric" : "decimal"} max={field.maximum} min={field.minimum}
              onChange={(event) => change(field.name, event.target.value)} step={field.kind === "integer" ? 1 : "any"} type="number" value={text} />
            : field.kind === "string" && field.maxLength !== undefined && field.maxLength > longTextLimit
              ? <Textarea {...shared} maxLength={field.maxLength} onChange={(event) => change(field.name, event.target.value)} rows={4} value={text} />
              : <Input {...shared} autoComplete="off" list={field.kind === "model" && models.length > 0 ? `${id}-models` : undefined} maxLength={field.maxLength}
                onChange={(event) => change(field.name, event.target.value)} type="text" value={text} />}
          {field.kind === "model" && models.length > 0 && <datalist id={`${id}-models`}>{models.map((model) => <option key={model} value={model} />)}</datalist>}
          {description}
          {error}
        </Field>;
      })}
    </FieldGroup>
    <div className={actionsClass}>
      <Button onClick={onCancel} type="button" variant="outline">Cancel</Button>
      <Button disabled={disabled} type="submit">{submitLabel}</Button>
    </div>
  </form>;
}
