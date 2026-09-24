import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";

export const documentWriteToolMetadata = {
  name: "document_write",
  label: "Dokument ablegen",
  nativeTool: true,
  description: "Legt eine Datei mit dem übergebenen Inhalt in der Dateiablage dieses Runs ab.",
  longDescription: "Dokumente, Berichte und Zwischenprodukte gehören in die Dateiablage, nicht ins "
    + "Arbeitsverzeichnis - dort steht nur, was zum Auftrag selbst gehört. Der Benutzer sieht die "
    + "Ablage im Bereich \"Dokumente\", nach Unterordnern gruppiert. Soll eine Datei aus dem "
    + "Arbeitsbereich in die Ablage, lies sie zuerst mit read und übergib den Inhalt hier als content. "
    + "Die Ablage ist kein Bash-Pfad: sie liegt nicht im Arbeitsbereich und ist nur über dieses Werkzeug "
    + "beschreibbar.",
} as const;

const relativeStorePath = (value: string): string => {
  const normalized = value.replace(/^\.\//, "");
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..") || normalized.trim() === "") {
    throw new Error("path muss relativ zur Dateiablage sein, ohne führenden / und ohne ..");
  }
  return normalized;
};

export const createDocumentWriteTool = (filesFor: (runId: string) => Promise<string>): RunFunction =>
  defineRunFunction({
    ...documentWriteToolMetadata,
    schema: Type.Object({
      path: Type.String({ minLength: 1, description: "Pfad in der Dateiablage, etwa thema/bericht.md" }),
      content: Type.String({ description: "Der vollständige Inhalt der Datei" }),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async (scope, _toolCallId, input) => {
      const relative = relativeStorePath(input.path);
      const target = path.join(await filesFor(scope.caller.runId), relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, input.content, "utf8");
      return `In der Dateiablage abgelegt: ${relative} (${Buffer.byteLength(input.content, "utf8")} Byte)`;
    },
  });
