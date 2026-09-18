import type { FilePickerProps } from "./file-contracts";

export const fileSelection = (current: readonly File[], incoming: readonly File[], options: Pick<FilePickerProps, "accept" | "multiple" | "maxFiles" | "maxBytes">): File[] => {
  const maximum = options.multiple === false ? 1 : options.maxFiles ?? 10;
  const bytes = options.maxBytes ?? 20 * 1024 * 1024;
  if (!Number.isInteger(maximum) || maximum < 1 || !Number.isFinite(bytes) || bytes < 1) throw new Error("Dateigrenzen müssen positive Zahlen sein.");
  if (!incoming.length) throw new Error("Die Auswahl enthält keine lesbaren Dateien.");
  if (options.multiple === false && incoming.length > 1) throw new Error("Bitte genau eine Datei auswählen.");
  const accepted = options.accept?.toLowerCase().split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  for (const file of incoming) {
    if (accepted.length && !accepted.some((type) => type.startsWith(".")
      ? file.name.toLowerCase().endsWith(type)
      : type.endsWith("/*") ? file.type.toLowerCase().startsWith(type.slice(0, -1)) : file.type.toLowerCase() === type)) {
      throw new Error(`Dateityp von ${file.name} nicht erlaubt. Erlaubt: ${options.accept}`);
    }
  }
  const result = options.multiple === false ? [...incoming] : [...current];
  if (options.multiple !== false) for (const file of incoming) {
    if (!result.some((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified && entry.type === file.type)) result.push(file);
  }
  if (result.length > maximum) throw new Error(`Höchstens ${maximum} Dateien auswählen.`);
  if (result.reduce((sum, file) => sum + file.size, 0) > bytes) throw new Error(`Die Auswahl überschreitet ${bytes} Bytes.`);
  return result;
};
