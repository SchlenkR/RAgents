import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { runFileExists } from "./files-route.js";
import { facesOperator } from "@ragents/host/plugin-support/tool-availability.js";

export const showDocumentToolMetadata = {
  name: "show_document",
  label: "Dokument anzeigen",
  nativeTool: true,
  description: "Zeigt Dokumente vollständig in der Oberfläche; Dateipfade gelten nur für die Dateiablage dieses Runs.",
  longDescription: "Nutze dieses Werkzeug IMMER, wenn der Benutzer den "
    + "Inhalt einer Datei oder ein längeres Dokument sehen möchte - statt den Inhalt in die "
    + "Chat-Antwort zu kopieren oder zu paraphrasieren. path zeigt ausschließlich eine Datei aus "
    + "der Dateiablage dieses Runs an, NICHT aus deinem Arbeitsverzeichnis. "
    + "Alles andere - Dateien des Arbeitsverzeichnisses und selbst erzeugte Inhalte - geht über "
    + "content; stammt der Inhalt aus einer Datei, übernimm ihn dort WÖRTLICH aus dem letzten "
    + "read- oder write-Ergebnis, niemals aus dem Gedächtnis neu getippt.",
} as const;

const sourceRule = "content und path schließen einander aus: gültig sind { title, content, format } für "
  + "selbst erzeugte Inhalte und Dateien des Arbeitsverzeichnisses und { title, path, format } für Dateien "
  + "der Dateiablage - genau eines von beiden muss gesetzt sein.";

const titleSchema = Type.String({ description: "Titel der Anzeige, z.B. der Dateiname" });
const formatSchema = Type.Optional(Type.Union(
  [Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")],
  { description: "Darstellung, Default markdown" }));

const documentSource = (input: { content?: string; path?: string }):
  | { kind: "content" }
  | { kind: "file"; path: string } => {
  if ((input.content === undefined) === (input.path === undefined)) throw new Error(sourceRule);

  return input.path === undefined ? { kind: "content" } : { kind: "file", path: input.path };
};

export const createShowDocumentTool = (filesFor: (runId: string) => Promise<string>): RunFunction =>
  defineRunFunction({
    ...showDocumentToolMetadata,
    schema: Type.Object({
      title: titleSchema,
      content: Type.Optional(Type.String({
        description: "Der vollständige Inhalt - für Dateien aus dem Arbeitsverzeichnis und für "
          + "selbst erzeugte Inhalte, also alles, was nicht in der Dateiablage liegt. " + sourceRule,
      })),
      path: Type.Optional(Type.String({
        description: "Datei aus der Dateiablage dieses Runs, relativ zur Ablage (z.B. thema/datei.md). "
          + "Nur dort abgelegte Dateien sind so anzeigbar - für Pfade des Arbeitsverzeichnisses "
          + "content nutzen. Der Inhalt wird direkt aus der Datei angezeigt und muss nie "
          + "abgetippt werden. " + sourceRule,
      })),
      format: formatSchema,
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: facesOperator,
    run: async ({ caller }, _toolCallId, input) => {
      const source = documentSource(input);

      if (source.kind === "content")
        return `Dem Benutzer angezeigt: ${input.title}`;

      const path = source.path;
      if (path.startsWith("/") || path.split("/").includes(".."))
        throw new Error("path muss relativ zur Dateiablage sein, ohne führenden / und ohne ..");
      if (!await runFileExists(await filesFor(caller.runId), path))
        throw new Error(
          `${source.path} liegt nicht in der Dateiablage dieses Runs. Über path sind nur Dateien der `
          + "Dateiablage anzeigbar - für Dateien aus dem Arbeitsverzeichnis und für selbst erzeugte "
          + "Inhalte den Inhalt über content übergeben.",
        );
      return `Dem Benutzer angezeigt: ${input.title} (Datei ${path} aus der Dateiablage)`;
    },
  });
