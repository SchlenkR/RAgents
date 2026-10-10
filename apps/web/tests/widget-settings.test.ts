import assert from "node:assert/strict";
import test from "node:test";
import type { StartWidgetSetting, StartWidgetSettings } from "../src/PluginRegistry";
import { NO_SETTINGS, settingsProblem, settingValueProblem, storedSettingsOf, widgetSettingsOf } from "../src/panel/widget-settings";

const settings = {
  runs: { type: "number", label: "Number of runs", default: 15, min: 3, max: 100 },
  share: { type: "number", label: "Share", default: 0.5, min: 0, max: 1, step: 0.1 },
  descriptions: { type: "boolean", label: "Show descriptions", default: true },
  view: { type: "choice", label: "View", default: "list", options: [{ value: "list", label: "List" }, { value: "cards", label: "Cards" }] },
  heading: { type: "text", label: "Heading", default: "" },
} as const satisfies StartWidgetSettings;

const defaults = { runs: 15, share: 0.5, descriptions: true, view: "list", heading: "" };

test("without stored values a widget renders with its defaults and reports nothing", () => {
  assert.deepEqual(widgetSettingsOf(settings, undefined), { values: defaults, problems: [] });
  assert.deepEqual(widgetSettingsOf(settings, {}), { values: defaults, problems: [] });
  assert.deepEqual(widgetSettingsOf(NO_SETTINGS, { runs: 5 }), { values: {}, problems: [] }, "a widget without settings ignores stored values");
});

test("valid stored values replace their defaults, a missing one falls back to its default, and keys the widget does not declare are ignored", () => {
  const resolved = widgetSettingsOf(settings, { runs: 5, share: 0.3, descriptions: false, view: "cards", heading: "Mine", former: "kept as saved" });
  assert.deepEqual(resolved, { values: { runs: 5, share: 0.3, descriptions: false, view: "cards", heading: "Mine" }, problems: [] });
  assert.deepEqual(widgetSettingsOf(settings, { runs: 3 }).values, { ...defaults, runs: 3 }, "the minimum is a valid value");
  assert.deepEqual(widgetSettingsOf(settings, { runs: 100 }).values, { ...defaults, runs: 100 }, "the maximum is a valid value");
});

test("an invalid stored value is reported in a sentence and the default renders instead, without widening or rounding it", () => {
  const resolved = widgetSettingsOf(settings, { runs: 500, share: 0.25, descriptions: "yes", view: "table", heading: "Two\nlines" });
  assert.deepEqual(resolved.values, defaults);
  assert.deepEqual(resolved.problems, [
    "Number of runs: the saved value 500 is above the maximum 100, so the default 15 applies.",
    "Share: the saved value 0.25 is not a step of 0.1 from 0, so the default 0.5 applies.",
    "Show descriptions: the saved value \"yes\" is neither on nor off, so the default true applies.",
    "View: the saved value \"table\" is not one of the options, so the default \"list\" applies.",
    "Heading: the saved value \"Two\\nlines\" has more than one line, so the default \"\" applies.",
  ]);
  const runs = settings.runs;
  assert.equal(settingValueProblem(runs, 2), "is below the minimum 3");
  assert.equal(settingValueProblem(runs, 4.5), "is not a step of 1 from 3", "a whole-number setting takes no fractions");
  assert.equal(settingValueProblem(runs, "5"), "is not a number", "a number stored as text is not widened");
  assert.equal(settingValueProblem(runs, null), "is not a number");
  assert.equal(settingValueProblem(settings.heading, "x".repeat(201)), "is longer than 200 characters");
  assert.equal(settingValueProblem(settings.heading, "x".repeat(200)), undefined);
  assert.equal(settingValueProblem(settings.heading, 5), "is not text");
  assert.equal(settingValueProblem(settings.share, 0.3), undefined, "steps tolerate the rounding of decimal fractions");
});

test("the same declaration and stored values give the same result, so a widget's effects do not run again on every render", () => {
  const stored = { runs: 5 };
  assert.equal(widgetSettingsOf(settings, stored), widgetSettingsOf(settings, stored));
  assert.equal(widgetSettingsOf(settings, undefined), widgetSettingsOf(settings, undefined));
  assert.notEqual(widgetSettingsOf(settings, stored), widgetSettingsOf(settings, { runs: 5 }), "other stored values are resolved again");
});

test("applied values store only what differs from the defaults, and nothing when all are defaults", () => {
  assert.deepEqual(storedSettingsOf(settings, { ...defaults, runs: 5, view: "cards" }), { runs: 5, view: "cards" });
  assert.equal(storedSettingsOf(settings, defaults), undefined);
  assert.throws(() => storedSettingsOf(settings, { ...defaults, runs: 101 }), /The value 101 of the setting runs is above the maximum 100/);
  assert.throws(() => storedSettingsOf(settings, { ...defaults, extra: 1 }), /The widget has no setting extra/);
  const { runs: _runs, ...withoutRuns } = defaults;
  assert.throws(() => storedSettingsOf(settings, withoutRuns), /The value of the setting runs is missing/);
});

test("a declaration names its first problem: an empty list, a bad key, a missing label, an impossible range or step, unusable options, or a default it rejects", () => {
  const problem = (setting: Record<string, unknown>, key = "value") => settingsProblem({ [key]: setting as unknown as StartWidgetSetting });
  const number = { type: "number", label: "Value", default: 5, min: 1, max: 9 };
  assert.equal(settingsProblem(settings), undefined);
  assert.equal(settingsProblem({}), "declares settings without any setting");
  assert.match(problem(number, "two words")!, /has the setting key "two words"; a key is letters and digits and starts with a letter/);
  assert.match(problem(number, "1st")!, /has the setting key "1st"/);
  assert.equal(problem({ ...number, label: " " }), "has the setting value without a label");
  assert.equal(problem({ ...number, description: "" }), "has the setting value with an empty description");
  assert.equal(problem({ ...number, min: 10 }), "has the setting value from 10 to 9; min and max are numbers and min is not above max");
  assert.equal(problem({ ...number, max: Number.POSITIVE_INFINITY }), "has the setting value from 1 to Infinity; min and max are numbers and min is not above max");
  assert.equal(problem({ ...number, step: 0 }), "has the setting value with the step 0; a step is a number above 0");
  assert.equal(problem({ ...number, default: 12 }), "has the setting value whose default 12 is above the maximum 9");
  assert.equal(problem({ ...number, default: 1.5 }), "has the setting value whose default 1.5 is not a step of 1 from 1");
  assert.equal(problem({ type: "boolean", label: "On", default: "yes" }), "has the setting value whose default \"yes\" is neither on nor off");
  const choice = { type: "choice", label: "View", default: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
  assert.equal(problem({ ...choice, options: [] }), "has the setting value without options");
  assert.equal(problem({ ...choice, options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] }), "has the setting value whose options need distinct values that are not empty");
  assert.equal(problem({ ...choice, options: [{ value: "", label: "Nothing" }] }), "has the setting value whose options need distinct values that are not empty");
  assert.equal(problem({ ...choice, options: [{ value: "a", label: "" }] }), "has the setting value with an option without a label");
  assert.equal(problem({ ...choice, default: "c" }), "has the setting value whose default \"c\" is not one of the options");
  assert.equal(problem({ type: "text", label: "Heading", default: "x".repeat(201) }), `has the setting value whose default "${"x".repeat(201)}" is longer than 200 characters`);
  assert.equal(problem({ type: "date", label: "Day", default: "today" }), "has the setting value of the type \"date\"; the types are number, boolean, choice, and text");
});
