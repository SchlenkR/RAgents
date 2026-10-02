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
}, { additionalProperties: false, description: "Use exactly one of role (with optional name), label, text, testId, css. Resolve semantic targets server-side; never copy snapshot element IDs. Ambiguous targets are errors naming the candidates unless nth or first selects one." });

const snapshotSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  snapshot: Type.String(),
  truncated: Type.Boolean(),
  errors: Type.Array(Type.String()),
}, { additionalProperties: false });

const emptySchema = Type.Object({}, { additionalProperties: false });
const targetInputSchema = Type.Object({ target: targetSchema }, { additionalProperties: false });
const screenshotDescription = "Capture the real browser page into this run's document library. The returned URL and Markdown display it to the user. Call browser_view_screenshot to inspect the latest capture as an image without copying a path.";

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
    description: "Read the current real page's accessible structure, title, URL and errors. Use role/name or labels for subsequent actions; snapshot reference IDs never need to be copied.",
    schema: emptySchema,
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId) => ({ ...await browser.snapshot(caller.runId, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_click",
    label: "Click in browser",
    description: "Click a uniquely identified visible element with Playwright auto-waiting. Returns the actual resulting page. Ambiguous or absent targets are errors.",
    schema: targetInputSchema,
    resultSchema: snapshotSchema,
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => ({ ...await browser.click(caller.runId, input.target, { signal, toolCallId }) }),
  }),
  defineRunFunction({
    name: "browser_type",
    label: "Type in browser",
    description: "Type text into an input or textarea chosen by accessible label or another semantic target, firing the normal input events. Returns the resulting page.",
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
    description: "Select options in a native select element; several values select several options of a multiple select. For custom dropdowns use browser_click on the trigger and the visible option.",
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
    description: "Press a key or chord such as Enter, Escape, Tab or ControlOrMeta+A on the focused element, or on target after focusing it. Returns the resulting page.",
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
    description: "Assert visible target/text, resulting URL and absence of browser errors. Fails on mismatch; records successful evidence for this page until the next action/navigation/error. Supply at least one assertion. Browser errors are checked by default. Visibility assertions wait at most 5 seconds, shorter than actions.",
    schema: Type.Object({
      target: Type.Optional(targetSchema),
      text: Type.Optional(Type.String({ minLength: 1, description: "Text expected to be visible, case-insensitive and as a part, inside target if given, otherwise anywhere on the page; cannot be combined with count." })),
      url: Type.Optional(Type.String({ minLength: 1, description: "Expected page address, exact or as a glob pattern such as **/done." })),
      count: Type.Optional(Type.Integer({ minimum: 0, description: "Expected number of visible matches of target instead of exactly one; 0 asserts absence. Requires target without nth or first." })),
      noErrors: Type.Optional(Type.Boolean({ description: "true (default): the check also fails on any browser error collected since the last navigation. false: ignore browser errors and judge only the assertions; use this when the page has known noise such as 404s or third-party script errors that are not part of the check." })),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({ checkedAt: Type.String(), url: Type.String(), assertions: Type.Array(Type.String()) }, { additionalProperties: false }),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: ({ caller, signal }, toolCallId, input) => browser.check(caller.runId, input, { signal, toolCallId }),
  }),
  defineRunFunction({
    name: "browser_resize",
    label: "Resize browser",
    description: "Resize the page viewport in CSS pixels, for example to check a narrow layout. The default is 1920 x 1080 (16:9) and screenshots use the viewport size at scale 1; the chosen size stays for the run until changed again. Returns the resulting page.",
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
    schema: Type.Object({ label: Type.Optional(Type.String({ maxLength: 200, description: "Name of the capture in the document library; defaults to Browser screenshot." })), fullPage: Type.Optional(Type.Boolean({ description: "Capture the whole scrollable page instead of the viewport; defaults to false." })) }, { additionalProperties: false }),
    resultSchema: Type.Object({
      name: Type.String(),
      path: Type.String(),
      url: Type.String(),
      markdown: Type.String(),
      capturedAt: Type.String(),
    }, { additionalProperties: false }),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: ({ caller, signal }, toolCallId, input) => browser.takeScreenshot(caller.runId, input, { signal, toolCallId }),
  }),
  defineRunFunction({
    name: "browser_view_screenshot",
    label: "View browser screenshot",
    description: "View this run's latest screenshot as native image input without a path. Invoke this native tool directly to receive pixels; calling it through TypeScript only verifies image availability. Requires an image-capable model for native image input.",
    schema: emptySchema,
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }) => {
      signal?.throwIfAborted();
      await browser.image(caller.runId);
      return "The latest browser screenshot of this run is available.";
    },
  }),
  defineRunFunction({
    name: "browser_close",
    label: "Close browser",
    description: "Close this run's browser and discard its cookies. Saved screenshots remain in the document library.",
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
      const data = (await browser.image(runId)).toString("base64");
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
