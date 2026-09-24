import React, { useId, useRef, useState, type FormEvent } from "react";
import { Button, Checkbox, Field, FieldDescription, FieldError, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "../../ui";
import type { FormErrors, FormField, FormProps, FormValue, FormValues } from "./form-contracts";

export function validateForm(fields: readonly FormField[], values: FormValues, validate?: FormProps["validate"]): FormErrors {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.disabled) continue;
    const value = values[field.id];
    const empty = value === undefined || value === null || typeof value === "string" && value.trim() === "";
    if (field.required && (empty || field.type === "checkbox" && value !== true)) {
      errors[field.id] = "This field is required.";
    } else if (!empty) {
      if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) errors[field.id] = "Enter a valid number.";
        else if (field.min !== undefined && value < field.min) errors[field.id] = `Minimum: ${field.min}.`;
        else if (field.max !== undefined && value > field.max) errors[field.id] = `Maximum: ${field.max}.`;
      } else if (field.type === "checkbox") {
        if (typeof value !== "boolean") errors[field.id] = "Choose a valid option.";
      } else if (typeof value !== "string") {
        errors[field.id] = "Enter text.";
      } else if (field.type === "select" && !field.options.some((option) => option.value === value)) {
        errors[field.id] = "Choose one of the available values.";
      }
    }
  }
  return { ...validate?.(values), ...errors };
}

export function Form({ title, fields, values, onChange, onSubmit, validate, submitLabel = "Save", disabled = false, readOnly = false }: FormProps) {
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState<string>();
  const ids = new Set(fields.map((field) => field.id));
  if (ids.size !== fields.length || fields.some((field) => !field.id.trim())) throw new Error("Form fields require unique, non-empty IDs.");

  const change = (field: FormField, value: FormValue) => {
    if (sending.current || disabled || readOnly || field.disabled || field.readOnly) return;
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== field.id)));
    setError(undefined);
    onChange({ ...values, [field.id]: value }, field.id);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmit || sending.current || disabled || readOnly) return;
    setError(undefined);
    try {
      const nextErrors = validateForm(fields, values, validate);
      setErrors(nextErrors);
      if (Object.values(nextErrors).some(Boolean)) {
        const index = fields.findIndex((field) => nextErrors[field.id]);
        form.current?.querySelector<HTMLElement>(`[data-field-index="${index}"] input, [data-field-index="${index}"] textarea, [data-field-index="${index}"] button`)?.focus();
        return;
      }
      sending.current = true;
      setPending(true);
      await onSubmit({ ...values });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      sending.current = false;
      setPending(false);
    }
  };
  return (
    <form aria-label={title ?? "Form"} aria-busy={pending} className="flex min-w-0 flex-col gap-4" noValidate onSubmit={(event) => void submit(event)} ref={form}>
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {fields.map((field, index) => {
        const id = `${prefix}-${index}`;
        const fieldError = errors[field.id];
        const locked = readOnly || field.readOnly;
        const inactive = disabled || pending || field.disabled;
        const describedBy = [field.hint && `${id}-hint`, fieldError && `${id}-error`].filter(Boolean).join(" ") || undefined;
        const value = values[field.id];
        const label = `${field.label}${field.required ? " *" : ""}`;
        const shared = { id, disabled: inactive, readOnly: locked, required: field.required, "aria-invalid": Boolean(fieldError), "aria-describedby": describedBy };
        const hint = field.hint && <FieldDescription id={`${id}-hint`}>{field.hint}</FieldDescription>;
        const problem = fieldError && <FieldError id={`${id}-error`}>{fieldError}</FieldError>;
        if (field.type === "checkbox") {
          return (
            <Field data-disabled={inactive || locked} data-field-index={index} data-invalid={Boolean(fieldError)} key={field.id} orientation="horizontal">
              <Checkbox {...shared} checked={value === true} disabled={inactive || locked} onCheckedChange={(checked) => change(field, checked)} />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                {hint}
                {problem}
              </div>
            </Field>
          );
        }
        if (field.type === "select") {
          return (
            <Field data-disabled={inactive} data-field-index={index} data-invalid={Boolean(fieldError)} key={field.id}>
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              {locked
                ? <p className="text-sm">{field.options.find((option) => option.value === value)?.label ?? String(value ?? "")}</p>
                : <Select disabled={inactive} items={field.options} value={typeof value === "string" ? value : ""} onValueChange={(next) => { if (next !== null) change(field, next); }}>
                  <SelectTrigger aria-describedby={describedBy} aria-invalid={Boolean(fieldError)} className="w-full" id={id}><SelectValue /></SelectTrigger>
                  <SelectContent>{field.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>}
              {hint}
              {problem}
            </Field>
          );
        }
        return (
          <Field data-disabled={inactive} data-field-index={index} data-invalid={Boolean(fieldError)} key={field.id}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {field.type === "textarea"
              ? <Textarea {...shared} onChange={(event) => change(field, event.target.value)} placeholder={field.placeholder} rows={field.rows ?? 2} value={typeof value === "string" ? value : ""} />
              : field.type === "number"
                ? <Input {...shared} max={field.max} min={field.min} onChange={(event) => change(field, Number.isNaN(event.target.valueAsNumber) ? null : event.target.valueAsNumber)} placeholder={field.placeholder} step={field.step ?? "any"} type="number" value={typeof value === "number" && Number.isFinite(value) ? value : ""} />
                : <Input {...shared} onChange={(event) => change(field, event.target.value)} placeholder={field.placeholder} type="text" value={typeof value === "string" ? value : ""} />}
            {hint}
            {problem}
          </Field>
        );
      })}
      {error && <FieldError>{error}</FieldError>}
      {onSubmit && !readOnly && <Button className="self-start" disabled={disabled || pending} type="submit">{pending ? "Saving..." : submitLabel}</Button>}
    </form>
  );
}
