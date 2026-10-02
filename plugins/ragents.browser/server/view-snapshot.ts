import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, type RunFunction } from "@ragents/engine";
import type { ActorProgramsService } from "@ragents/host/plugin-support/actor-programs/service.js";
import type { RunBrowser } from "./browser.js";

const maxSnapshotLength = 8_000;
const maxFailureLength = 1_500;
const viewReady = { target: { css: "#root > *", frame: "iframe", first: true }, noErrors: false } as const;

export interface ViewSnapshotOptions {
  browser: RunBrowser;
  actorPrograms: () => ActorProgramsService | undefined;
  address: () => string | undefined;
}

export const viewAddress = (address: string, runId: string, elementId: string): string => {
  const url = new URL("/", address);
  url.searchParams.set("layout", "app");
  url.searchParams.set("run", runId);
  url.searchParams.set("element", elementId);
  return url.href;
};

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const createViewSnapshotFunction = (options: ViewSnapshotOptions): RunFunction => defineRunFunction({
  name: "actor_view_snapshot",
  label: "Read actor view",
  description: "Render a visible actor view in this run's browser and return what it shows as accessible structure, plus browser errors.",
  longDescription: "view is package-name/view-key (the ref in actor_program_list), @handle/view-key or a unique title. The server resolves the address; never open a view with browser_navigate. The run browser stays on the view, so browser_take_screenshot captures it, and browser_click, browser_type and browser_check with target.frame \"iframe\" operate it. A hidden view is an error. It needs a server that requires no sign-in and that the machine of the run's workspace can reach.",
  schema: Type.Object({ view: Type.String({ minLength: 1, description: "Visible view as package-name/view-key, @handle/view-key or unique title." }) }, { additionalProperties: false }),
  resultSchema: Type.Object({
    view: Type.String(),
    snapshot: Type.String(),
    truncated: Type.Boolean(),
    errors: Type.Array(Type.String()),
  }, { additionalProperties: false }),
  available: defineToolAvailability(
    { availability: "conditional", availabilityDetail: "Only in a profile with the plugin ragents.actor-programs." },
    () => options.actorPrograms() !== undefined,
  ),
  executionMode: "sequential",
  run: async ({ caller, signal }, toolCallId, input) => {
    const programs = options.actorPrograms();
    if (!programs) throw new Error("This profile has no actor programs.");
    const address = options.address();
    if (!address) throw new Error("The server has no address yet.");
    const view = programs.resolveView(caller.runId, input.view);
    if (!view.visible) throw new Error(`${view.reference} is hidden. Show it with actor_view_set_visibility first.`);
    const call = { signal, toolCallId };
    try {
      await options.browser.navigate(caller.runId, viewAddress(address, caller.runId, view.elementId), call);
    } catch (error) {
      throw new Error(`The view could not be opened: ${errorText(error)}\nThe server must be reachable from the machine of the run's workspace and must not require sign-in.`, { cause: error });
    }
    try {
      await options.browser.check(caller.runId, viewReady, call);
    } catch (error) {
      const page = await options.browser.snapshot(caller.runId, call);
      throw new Error(`The view did not render: ${errorText(error)}\nThe page shows:\n${page.snapshot.slice(0, maxFailureLength)}`, { cause: error });
    }
    const page = await options.browser.snapshot(caller.runId, call);
    return {
      view: view.reference,
      snapshot: page.snapshot.slice(0, maxSnapshotLength),
      truncated: page.truncated || page.snapshot.length > maxSnapshotLength,
      errors: page.errors,
    };
  },
});
