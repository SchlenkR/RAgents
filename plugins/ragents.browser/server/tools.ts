import { Type } from "typebox";
import { defineRunFunction, type AgentContribution, type RunFunction } from "@ragents/engine";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";
import { RunBrowser } from "./browser.js";

const targetSchema = Type.Object({
  role: Type.Optional(Type.String({ minLength: 1, description: "Accessible role, e.g. button, textbox, link, combobox." })),
  name: Type.Optional(Type.String({ description: "Exact accessible name for role." })),
  label: Type.Optional(Type.String({ minLength: 1, description: "Exact form label." })),
  text: Type.Optional(Type.String({ minLength: 1, description: "Exact visible text." })),
  testId: Type.Optional(Type.String({ minLength: 1, description: "data-testid value." })),
  css: Type.Optional(Type.String({ minLength: 1, description: "CSS selector for elements without useful accessible names." })),
  frame: Type.Optional(Type.String({ minLength: 1, description: "CSS selector of an iframe containing the target." })),
  nth: Type.Optional(Type.Integer({ minimum: 0, description: "0-based index among all matches when the target matches several elements; not together with first." })),
  first: Type.Optional(Type.Boolean({ description: "Use the first match when the target matches several elements; not together with nth." })),
}, { additionalProperties: false, description: "Use exactly one of role (with optional name), label, text, testId, css. Resolve semantic targets server-side; never copy snapshot element IDs. Zero matches fail immediately; ambiguous targets name candidates unless nth or first selects one." });

const snapshotSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  snapshot: Type.String({ description: "Accessible page structure; actions return at most 2000 characters, 40 lines and 300 characters per line. browser_snapshot returns up to 40000 characters." }),
  truncated: Type.Boolean({ description: "The structure was shortened; call browser_snapshot for the full snapshot." }),
  errors: Type.Array(Type.String()),
}, { additionalProperties: false });

const emptySchema = Type.Object({}, { additionalProperties: false });
const measurementSchema = Type.Object({
  box: Type.Object({ x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() }, { additionalProperties: false }),
  clientWidth: Type.Number(),
  scrollWidth: Type.Number(),
  overflowX: Type.Number(),
}, { additionalProperties: false, description: "Target dimensions in CSS pixels; box coordinates are relative to the main viewport, including iframe targets. overflowX is max(0, scrollWidth - clientWidth)." });
const targetInputSchema = Type.Object({ target: targetSchema }, { additionalProperties: false });
const screenshotDescription = "Capture the real browser page as a PNG file where filename names it, by default a new file under @documents/browser/. "
  + "Name filename next to the report that shows it and embed it with a path relative to the report. Call browser_view_screenshot to see the latest capture as an image.";

export const createBrowserFunctions = (browser: RunBrowser): RunFunction[] => [
  defineRunFunction({
    name: "browser_navigate",
    label: "Navigate browser",
    description: "Navigate this run's isolated headless browser to an HTTP(S) page. Returns its accessible structure and browser errors. Reuses the current run browser; other runs have separate cookies and processes.",
    schema: Type.Object({ url: Type.String({ minLength: 1, description: "HTTP or HTTPS address; an error status of the response fails the call." }) }, { additionalProperties: false }),
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.navigate(caller.runId, input.url, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_snapshot",
    label: "Read browser",
    description: "Read the current real page's full accessible structure (up to 40000 characters), title, URL and errors, including content omitted after actions. Use role/name or labels for subsequent actions; snapshot reference IDs never need to be copied.",
    schema: emptySchema,
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId) => ({ ...await browser.snapshot(caller.runId, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_click",
    label: "Click in browser",
    description: "Click a visible element with Playwright auto-waiting for operability. Zero matches fail immediately; multiple matches name candidates for target.nth (0-based), first: true, or a more specific target. Returns a short page snapshot; browser_snapshot reads the full structure.",
    schema: targetInputSchema,
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.click(caller.runId, input.target, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_type",
    label: "Type in browser",
    description: "Type text into an input or textarea chosen by accessible label or another semantic target, firing the normal input events. Returns a short page snapshot; browser_snapshot reads the full structure.",
    schema: Type.Object({
      target: targetSchema,
      text: Type.String({ description: "Text that replaces the content of the field, unless slowly is set." }),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter afterwards, for example to submit a form." })),
      slowly: Type.Optional(Type.Boolean({ description: "Type one character at a time without clearing the field first, to trigger key handlers." })),
    }, { additionalProperties: false }),
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.type(caller.runId, input.target, { text: input.text, submit: input.submit, slowly: input.slowly }, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_select_option",
    label: "Select in browser",
    description: "Select options in a native select element; several values select several options of a multiple select. For custom dropdowns use browser_click on the trigger and the visible option. Returns a short page snapshot; browser_snapshot reads the full structure.",
    schema: Type.Object({
      target: targetSchema,
      values: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Value or visible label of each option to select." }),
    }, { additionalProperties: false }),
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.selectOption(caller.runId, input.target, input.values, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_press_key",
    label: "Press browser key",
    description: "Press a key or chord such as Enter, Escape, Tab or ControlOrMeta+A on the focused element, or on target after focusing it. Returns a short page snapshot; browser_snapshot reads the full structure.",
    schema: Type.Object({
      key: Type.String({ minLength: 1, description: "Playwright key name, character or chord, such as Enter, ArrowLeft, a or ControlOrMeta+A." }),
      target: Type.Optional(targetSchema),
    }, { additionalProperties: false }),
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.pressKey(caller.runId, input.target, input.key, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_check",
    label: "Check browser result",
    description: "Assert visible target/text, match count or URL. frame scopes pure text checks; measure returns target dimensions and horizontal overflow. count: 0 warns if the unfiltered target has never matched on this page. Page errors are informational unless noErrors: true. Missing targets fail immediately, other assertions wait at most 5 seconds. Records success until the next action or navigation.",
    schema: Type.Object({
      target: Type.Optional(targetSchema),
      text: Type.Optional(Type.String({ minLength: 1, description: "Visible text, case-insensitive substring; inside target if given, otherwise in frame or the main page. With count, filter target matches to those containing this text." })),
      frame: Type.Optional(Type.String({ minLength: 1, description: "CSS selector of the iframe for a pure text check. Requires text without target; with target, use target.frame instead." })),
      url: Type.Optional(Type.String({ minLength: 1, description: "Expected page address, exact or as a glob pattern such as **/done." })),
      count: Type.Optional(Type.Integer({ minimum: 0, description: "Expected visible target matches, filtered by text when supplied; 0 asserts absence and warns if the unfiltered target has never matched since navigation. Requires target without nth or first." })),
      measure: Type.Optional(Type.Boolean({ description: "True returns the visible target's bounding box, clientWidth, scrollWidth and overflowX in CSS pixels. Requires target without count; choose nth or first for multiple matches. Use css: html for page overflow." })),
      noErrors: Type.Optional(Type.Boolean({ description: "Defaults to false: page errors are reported as information. Explicit true also fails on browser or network errors collected since navigation, including unrelated resource failures." })),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({
      checkedAt: Type.String(),
      url: Type.String(),
      assertions: Type.Array(Type.String()),
      errors: Type.Array(Type.String()),
      warnings: Type.Optional(Type.Array(Type.String())),
      measurement: Type.Optional(measurementSchema),
    }, { additionalProperties: false }),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.check(caller.runId, input, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_resize",
    label: "Resize browser",
    description: "Resize the page viewport in CSS pixels, for example to check a narrow layout. The default is 1920 x 1080 (16:9), scale 1; the size stays until changed. Invalidates prior checks and returns a short page snapshot; browser_snapshot reads the full structure.",
    schema: Type.Object({
      width: Type.Integer({ minimum: 320, maximum: 3840, description: "Viewport width in CSS pixels." }),
      height: Type.Integer({ minimum: 240, maximum: 2160, description: "Viewport height in CSS pixels." }),
    }, { additionalProperties: false }),
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.resize(caller.runId, input, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_take_screenshot",
    label: "Capture browser",
    description: screenshotDescription,
    schema: Type.Object({
      label: Type.Optional(Type.String({ maxLength: 200, description: "Name of the capture in the run's browser evidence; defaults to Browser screenshot." })),
      filename: Type.Optional(Type.String({
        minLength: 1,
        description: "Where the PNG goes, named as read names a file: relative to the working directory on the machine where the browser runs, "
          + "or starting with @documents, e.g. @documents/review/shots/home.png; defaults to a new file under @documents/browser/.",
      })),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture the whole scrollable page instead of the viewport; defaults to false." })),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => {
      const { reference } = await browser.takeScreenshot(caller.runId, input, { signal, toolCallId });
      return input.filename === undefined ? `Saved the screenshot as ${reference}.` : "Saved the screenshot.";
    },
  }),
  defineRunFunction({
    name: "browser_view_screenshot",
    label: "View browser screenshot",
    description: "View this run's latest screenshot as native image input without a path. Invoke this native tool directly to receive pixels; calling it through TypeScript only verifies image availability. Requires an image-capable model for native image input.",
    schema: emptySchema,
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId) => {
      signal?.throwIfAborted();
      await browser.image(caller.runId, { signal, toolCallId });
      return "The latest browser screenshot of this run is available.";
    },
  }),
  defineRunFunction({
    name: "browser_close",
    label: "Close browser",
    description: "Close this run's browser and discard its cookies. Saved screenshots remain where they were stored.",
    schema: emptySchema,
    resultSchema: Type.Object({ closed: Type.Boolean() }, { additionalProperties: false }),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller }) => { await browser.close(caller.runId); return { closed: true }; },
  }),
];

export const createBrowserImageContribution = (browser: RunBrowser): AgentContribution => ({
  id: "ragents.browser.image",
  afterToolCall: async ({ runId }, outcome, call) => {
    if (outcome.toolName !== "browser_view_screenshot" || outcome.isError) return undefined;
    try {
      call.signal?.throwIfAborted();
      if (!call.modelReadsImages) throw new Error("The selected model does not support images. View the screenshot in the documents or choose an image-capable model.");
      const data = (await browser.image(runId, call.signal ? { signal: call.signal } : {})).toString("base64");
      call.signal?.throwIfAborted();
      return { content: [
        { type: "text", text: "Latest browser screenshot of this run." },
        { type: "image", data, mimeType: "image/png" },
      ] };
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  },
});
