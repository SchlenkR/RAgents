import ts from "typescript";
import type { CommandRecord } from "@ragents/engine";

const removedFunctions = new Set(["canvas_layout_replace", "canvas_layout_place"]);
const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const reject = (detail: string): never => {
  throw new Error(`This run uses the removed host layout API (${detail}). Mini-apps now enter the app catalog automatically. Start a new run with updated programs; the original files are kept.`);
};

const checkFunctions = (value: unknown): void => {
  if (typeof value === "string" && removedFunctions.has(value)) reject(value);
  if (Array.isArray(value)) value.forEach(checkFunctions);
  else if (recordOf(value)) Object.values(value as Record<string, unknown>).forEach(checkFunctions);
};

const checkProgram = (value: unknown): void => {
  const program = recordOf(value);
  if (!program) return;
  checkFunctions(recordOf(program.input)?.capabilityIds);
  if (Array.isArray(program.functions)) {
    for (const fn of program.functions) checkFunctions(recordOf(fn)?.capabilityIds);
  }
  if (Array.isArray(program.views)) {
    for (const view of program.views) {
      if (recordOf(view) && Object.hasOwn(view, "placements")) reject("view placements");
    }
  }
};

export const assertCurrentLayoutContract = (record: CommandRecord): void => {
  for (const event of record.events) {
    const payload = event.payload as unknown as Record<string, unknown>;
    if (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") {
      if (payload.pluginId === "ragents.orchestration") reject("stored surface layout");
      if (payload.pluginId === "ragents.actor-programs") {
        if (event.type === "plugin.state-replaced") checkProgram(recordOf(payload.state)?.program);
        else {
          for (const change of payload.changes as { path: (string | number)[]; value?: unknown }[]) checkProgramPatch(change.path, change.value);
        }
      }
    }
    if ("toolNames" in payload) checkFunctions(payload.toolNames);
    if (event.type.startsWith("tool.call.")) {
      checkFunctions(payload.name);
      if (payload.name === "typescript_eval") checkSource(recordOf(payload.input)?.code);
      if (event.type === "tool.call.source") checkSource(payload.code);
    }
  }
};

const checkSource = (value: unknown): void => {
  if (typeof value !== "string") return;
  if (![...removedFunctions].some((name) => value.includes(name))) return;
  const source = ts.createSourceFile("snippet.ts", value, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && removedFunctions.has(node.text)) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node
        || ts.isElementAccessExpression(parent) && parent.argumentExpression === node
        || ts.isBindingElement(parent) && (parent.propertyName ?? parent.name) === node
        || ts.isCallExpression(parent) && parent.expression === node) reject(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
};

const checkViewPatch = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(checkViewPatch);
  else if (recordOf(value) && Object.hasOwn(value as object, "placements")) reject("view placements");
};

const checkProgramPatch = (path: readonly (string | number)[], value: unknown): void => {
  if (path.length === 0) checkProgram(recordOf(value)?.program);
  if (path[0] !== "program") return;
  if (path.length === 1) checkProgram(value);
  if (path[1] === "views") {
    if (path[3] === "placements") reject("view placements");
    if (path.length <= 3) checkViewPatch(value);
  }
  if (path[1] === "input") {
    if (path.length === 2) checkFunctions(recordOf(value)?.capabilityIds);
    if (path[2] === "capabilityIds") checkFunctions(value);
  }
  if (path[1] === "functions") {
    if (path.length === 2 && Array.isArray(value)) {
      for (const fn of value) checkFunctions(recordOf(fn)?.capabilityIds);
    }
    if (path.length === 3) checkFunctions(recordOf(value)?.capabilityIds);
    if (path[3] === "capabilityIds") checkFunctions(value);
  }
};
