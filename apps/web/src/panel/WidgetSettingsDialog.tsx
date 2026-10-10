import type { JsonValue } from "@ragents/engine/src/domain/json";
import { useId, useState, type FormEvent } from "react";
import type { StartWidgetSetting, StartWidgetSettings, StartWidgetSettingValues } from "../PluginRegistry";
import {
  Button, ChoiceSelect, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle,
  Input, Label, Switch,
} from "../ui";
import { SETTING_TEXT_LIMIT, settingValueProblem } from "./widget-settings";

/** A field's content while the viewer edits it; a number stays the typed text, so an unfinished entry is kept as it is. */
type FieldValue = string | boolean;

const fieldValueOf = (setting: StartWidgetSetting, value: unknown): FieldValue => setting.type === "boolean" ? value === true : String(value);

const valueOf = (setting: StartWidgetSetting, field: FieldValue): JsonValue =>
  setting.type === "number" ? typeof field === "string" && field.trim() !== "" ? Number(field) : Number.NaN : field;

/** The settings of one widget as a small form; Apply hands their values to the edited layout, Cancel and Escape leave it as it is. */
export function WidgetSettingsDialog({ title, settings, values, problems, onApply, onClose }: {
  title: string;
  settings: StartWidgetSettings;
  values: StartWidgetSettingValues;
  /** The saved values the widget could not use. */
  problems: readonly string[];
  onApply: (values: Readonly<Record<string, JsonValue>>) => void;
  onClose: () => void;
}) {
  const prefix = useId();
  const entries = Object.entries(settings);
  const [fields, setFields] = useState<Readonly<Record<string, FieldValue>>>(() => Object.fromEntries(entries.map(([key, setting]) => [key, fieldValueOf(setting, values[key])])));
  const checked = entries.map(([key, setting]) => {
    const value = valueOf(setting, fields[key]!);
    return { key, setting, value, problem: settingValueProblem(setting, value) };
  });
  const idOf = (key: string) => `${prefix}-${key}`;
  const change = (key: string, value: FieldValue) => setFields((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = checked.find((entry) => entry.problem !== undefined);
    if (invalid !== undefined) event.currentTarget.ownerDocument.getElementById(idOf(invalid.key))?.focus();
    else onApply(Object.fromEntries(checked.map(({ key, value }) => [key, value])));
  };
  return <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
    <DialogContent className="gap-3" finalFocus={false} scope="page" size="small">
      <DialogHeader>
        <DialogTitle>Configure {title}</DialogTitle>
        <DialogDescription>Applies to this widget while you edit Start; Done saves it with the layout.</DialogDescription>
      </DialogHeader>
      <form aria-label={`Settings of ${title}`} className="grid min-h-0 gap-3" noValidate onSubmit={submit}>
        <DialogBody className="gap-4">
          {problems.length > 0 && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{problems.join(" ")} Apply replaces the saved values.</p>}
          <FieldGroup>
            {checked.map(({ key, setting, problem }) => {
              const id = idOf(key);
              const field = fields[key]!;
              const described = [setting.description !== undefined && `${id}-description`, problem !== undefined && `${id}-problem`].filter(Boolean).join(" ") || undefined;
              const description = setting.description !== undefined && <FieldDescription id={`${id}-description`}>{setting.description}</FieldDescription>;
              const error = problem !== undefined && <FieldError id={`${id}-problem`}>This value {problem}.</FieldError>;
              if (setting.type === "boolean") return <Field key={key}>
                <Label className="flex items-center gap-2"><Switch aria-describedby={described} checked={field === true} id={id} onCheckedChange={(next) => change(key, next)} />{setting.label}</Label>
                {description}
              </Field>;
              if (setting.type === "choice") return <Field key={key}>
                <FieldTitle>{setting.label}</FieldTitle>
                <div><ChoiceSelect label={setting.label} onValueChange={(next) => change(key, next)} options={setting.options} value={String(field)} /></div>
                {description}
              </Field>;
              return <Field data-invalid={problem !== undefined || undefined} key={key}>
                <FieldLabel htmlFor={id}>{setting.label}</FieldLabel>
                {setting.type === "number"
                  ? <Input aria-describedby={described} aria-invalid={problem !== undefined || undefined} id={id} inputMode="decimal" max={setting.max} min={setting.min}
                    onChange={(event) => change(key, event.target.value)} step={setting.step ?? 1} type="number" value={String(field)} />
                  : <Input aria-describedby={described} aria-invalid={problem !== undefined || undefined} id={id} maxLength={SETTING_TEXT_LIMIT}
                    onChange={(event) => change(key, event.target.value)} type="text" value={String(field)} />}
                {description}
                {error}
              </Field>;
            })}
          </FieldGroup>
        </DialogBody>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} size="sm" type="button" variant="ghost">Cancel</Button>
          <Button size="sm" type="submit">Apply</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
