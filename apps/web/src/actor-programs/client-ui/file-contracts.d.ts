import type { ReactElement } from "react";

export interface FilePickerProps {
  label: string;
  files: readonly File[];
  /** The selection stays local; the view decides about reading and transferring. */
  onChange: (files: File[]) => void | Promise<void>;
  /** File extensions or MIME types, e.g. .csv,image/*; also checked for drop and paste. */
  accept?: string;
  multiple?: boolean;
  /** Maximum number of files in the whole selection; default 10, exactly one file with multiple=false. */
  maxFiles?: number;
  /** Maximum total size in bytes; default 20 MiB. */
  maxBytes?: number;
  disabled?: boolean;
  showPreview?: boolean;
}

export declare function FilePicker(props: FilePickerProps): ReactElement;
