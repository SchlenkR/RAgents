import type { PluginConfigDescriptor } from "@ragents/engine";
import { listFromEnvironmentValue } from "../config-file.js";

export interface DeclaredEnvironment<Key extends string> {
  descriptors: readonly PluginConfigDescriptor[];
  value: (key: Key, fallback: string) => string;
  optional: (key: Key) => string | undefined;
  required: (key: Key) => string;
  list: (key: Key) => readonly string[];
  flag: (key: Key) => boolean;
  positiveNumber: (key: Key, fallback: string) => number;
}

type EnvironmentKeyOf<T extends readonly PluginConfigDescriptor[]> =
  Extract<T[number], { source: "environment" }>["key"];

export const declaredEnvironment = <const T extends readonly PluginConfigDescriptor[]>(
  descriptors: T,
): DeclaredEnvironment<EnvironmentKeyOf<T>> => {
  const declared = new Set(
    descriptors.filter((descriptor) => descriptor.source === "environment").map((descriptor) => descriptor.key),
  );
  const read = (key: string): string | undefined => {
    if (!declared.has(key)) throw new Error(`Umgebungsvariable ${key} ist für dieses Plugin nicht deklariert`);
    return process.env[key];
  };
  return {
    descriptors,
    value: (key, fallback) => read(key) ?? fallback,
    optional: (key) => read(key),
    required: (key) => {
      const value = read(key);
      if (!value) throw new Error(`Umgebungsvariable ${key} fehlt`);
      return value;
    },
    list: (key) => {
      const value = read(key);
      if (value === undefined || value === "") return [];
      return listFromEnvironmentValue(value) ?? [value];
    },
    flag: (key) => read(key) === "1",
    positiveNumber: (key, fallback) => {
      const value = Number(read(key) ?? fallback);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} muss eine positive Zahl sein`);
      return value;
    },
  };
};
