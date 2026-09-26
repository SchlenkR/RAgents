import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AgentContribution, JsonValue } from "@ragents/engine";
import { projectSourceFiles } from "@ragents/host/plugin-support/actor-programs/app-project.js";

const entryType = "ragents.actor-programs.project-diagnostics";
const maxDeltaLines = 8;
const maxLineLength = 240;

interface ProgramDiagnostics {
  fingerprint: string;
  errors: string[];
}

export interface ProjectDiagnosticsSnapshot {
  version: 1;
  programs: Record<string, ProgramDiagnostics>;
}

export interface ProjectDiagnosticsOptions {
  workspaceFor: (runId: string) => string | Promise<string>;
  check: (runId: string, programName: string, actorId: string, signal?: AbortSignal) => Promise<unknown>;
  applies?: (runId: string, actorId: string) => boolean;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const fingerprintOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const errorLines = (error: unknown): string[] => {
  const complete = error instanceof Error ? (error as { lines?: unknown }).lines : undefined;
  if (Array.isArray(complete) && complete.every((line) => typeof line === "string")) return [...new Set(complete as string[])];
  const lines = messageOf(error).split("\n").map((line) => line.trim()).filter(Boolean);
  const issues = lines.filter((line) => !/^(Build failed with \d+ errors?:|.*(?:Typprüfung|Typecheck|Diagnostik).*:)$/i.test(line));
  return [...new Set(issues.length ? issues : lines)];
};
const allErrors = (snapshot: ProjectDiagnosticsSnapshot): string[] => Object.entries(snapshot.programs)
  .sort(([left], [right]) => left.localeCompare(right))
  .flatMap(([programName, program]) => program.errors.map((error) => `${programName}: ${error}`));
const isSnapshot = (value: unknown): value is ProjectDiagnosticsSnapshot => {
  if (value === null || typeof value !== "object") return false;
  const snapshot = value as ProjectDiagnosticsSnapshot;
  return snapshot.version === 1 && snapshot.programs !== null && typeof snapshot.programs === "object"
    && Object.values(snapshot.programs).every((program) => program && typeof program.fingerprint === "string"
      && Array.isArray(program.errors) && program.errors.every((error) => typeof error === "string"));
};

export const createProjectDiagnostics = (options: ProjectDiagnosticsOptions) => {
  const snapshots = new Map<string, Map<string, ProjectDiagnosticsSnapshot>>();
  const remember = (runId: string, actorId: string, snapshot: ProjectDiagnosticsSnapshot): void => {
    const agents = snapshots.get(runId) ?? new Map<string, ProjectDiagnosticsSnapshot>();
    agents.set(actorId, snapshot);
    snapshots.set(runId, agents);
  };
  const contribution: AgentContribution = {
    id: entryType,
    beforeModelCall: async ({ runId, agentId }, call) => {
      if (options.applies?.(runId, agentId) === false) return undefined;
      call.signal?.throwIfAborted();
      const previous: ProjectDiagnosticsSnapshot = isSnapshot(call.kept) ? call.kept : { version: 1, programs: {} };
      const next: ProjectDiagnosticsSnapshot = { version: 1, programs: {} };
      let changed = false;
      try {
        const directory = await options.workspaceFor(runId);
        const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          call.signal?.throwIfAborted();
          let fingerprint: string;
          let errors: string[] = [];
          try {
            if (entry.isSymbolicLink()) throw new Error("Actor-Projekte dürfen keine Symlinks sein.");
            fingerprint = fingerprintOf(await projectSourceFiles(path.join(directory, entry.name)));
          } catch (error) {
            errors = errorLines(error);
            fingerprint = fingerprintOf({ errors });
          }
          const prior = previous.programs[entry.name];
          if (prior?.fingerprint === fingerprint) {
            next.programs[entry.name] = prior;
            continue;
          }
          changed = true;
          if (errors.length === 0) {
            try { await options.check(runId, entry.name, agentId, call.signal); }
            catch (error) {
              call.signal?.throwIfAborted();
              errors = errorLines(error);
            }
          }
          next.programs[entry.name] = { fingerprint, errors };
        }
      } catch (error) {
        call.signal?.throwIfAborted();
        const errors = errorLines(error);
        Object.assign(next.programs, previous.programs);
        next.programs["(Workspace)"] = { fingerprint: fingerprintOf({ errors }), errors };
      }
      if (JSON.stringify(Object.keys(previous.programs).sort()) !== JSON.stringify(Object.keys(next.programs).sort())) changed = true;
      if (JSON.stringify(previous) !== JSON.stringify(next)) changed = true;
      call.signal?.throwIfAborted();
      remember(runId, agentId, next);
      if (!changed) return undefined;
      call.keep(next as unknown as JsonValue);
      const before = new Set(allErrors(previous));
      const after = new Set(allErrors(next));
      const added = [...after].filter((error) => !before.has(error));
      const resolved = [...before].filter((error) => !after.has(error));
      const changes = [...added.map((error) => `Neu: ${error}`), ...resolved.map((error) => `Behoben: ${error}`)];
      const lines = changes.slice(0, maxDeltaLines).map((line) => line.length > maxLineLength ? `${line.slice(0, maxLineLength - 3)}...` : line);
      const omitted = changes.length - lines.length;
      return [
        `Actor-Programm-Projektprüfung (TypeScript und Build): ${after.size} Fehler in ${Object.keys(next.programs).length} Projekten; ${added.length} neu, ${resolved.length} behoben.`,
        ...lines,
        ...(omitted > 0 ? [`${omitted} weitere Änderungen. Vollständiger letzter Stand: actor_program_diagnostics.`] : []),
      ].join("\n");
    },
  };
  return {
    contribution,
    latest(runId: string, actorId: string, programName?: string): string {
      const snapshot = snapshots.get(runId)?.get(actorId);
      if (!snapshot) return "Noch kein Actor-Programm-Projektstand für diesen Agenten geprüft.";
      const programs = Object.entries(snapshot.programs).filter(([id]) => programName === undefined || id === programName);
      if (programs.length === 0) return programName ? `Kein geprüfter Projektstand für ${programName}.` : "Keine Actor-Programm-Projekte vorhanden.";
      return programs.sort(([left], [right]) => left.localeCompare(right)).map(([id, program]) =>
        [`${id}: ${program.errors.length} Fehler`, ...program.errors].join("\n")).join("\n\n");
    },
    forget(runId: string): void { snapshots.delete(runId); },
  };
};
