import type { ReactElement } from "react";

export type FormValue = string | number | boolean | null;
export type FormValues = Readonly<Record<string, FormValue>>;
export type FormErrors = Readonly<Record<string, string>>;

interface FormFieldBase {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

export type FormField = FormFieldBase & (
  | { type: "text"; placeholder?: string }
  | { type: "textarea"; placeholder?: string; rows?: number }
  | { type: "number"; min?: number; max?: number; step?: number; placeholder?: string }
  | { type: "checkbox" }
  | { type: "select"; options: readonly { value: string; label: string; hint?: string }[] }
);

export interface FormProps {
  title?: string;
  fields: readonly FormField[];
  values: FormValues;
  onChange: (values: FormValues, fieldId: string) => void;
  /** Values stay controlled and are never reset after submission. */
  onSubmit?: (values: FormValues) => void | Promise<void>;
  /** Additional synchronous field errors, keyed by field ID. */
  validate?: (values: FormValues) => FormErrors | undefined;
  submitLabel?: string;
  disabled?: boolean;
  readOnly?: boolean;
}

export declare function Form(props: FormProps): ReactElement;
