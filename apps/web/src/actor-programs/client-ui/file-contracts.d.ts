import type { ReactElement } from "react";

export interface FilePickerProps {
  label: string;
  files: readonly File[];
  /** Auswahl bleibt lokal; die Ansicht entscheidet über Lesen und Übertragen. */
  onChange: (files: File[]) => void | Promise<void>;
  /** Dateiendungen oder MIME-Typen, z. B. .csv,image/*; wird auch für Drop und Paste geprüft. */
  accept?: string;
  multiple?: boolean;
  /** Höchstzahl der gesamten Auswahl; Standard 10, bei multiple=false genau eine Datei. */
  maxFiles?: number;
  /** Maximale Gesamtgröße in Bytes; Standard 20 MiB. */
  maxBytes?: number;
  disabled?: boolean;
  showPreview?: boolean;
}

export declare function FilePicker(props: FilePickerProps): ReactElement;
