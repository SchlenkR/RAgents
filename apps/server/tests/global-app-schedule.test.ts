import assert from "node:assert/strict";
import test from "node:test";
import { nextCalendarOccurrence, nextScheduledOccurrence, normalizeTriggers } from "../../../plugins/ragents.global-apps/server/schedule.ts";
import { appRegisterSchema } from "../../../plugins/ragents.global-apps/contract.ts";
import { Value } from "typebox/value";

test("daily and weekday schedules respect their IANA zones and choose the next future occurrence", () => {
  const after = Date.parse("2026-10-09T12:00:00Z");
  assert.equal(nextCalendarOccurrence({ at: "08:00", timeZone: "Europe/Berlin" }, after), "2026-10-10T06:00:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "08:00", timeZone: "Asia/Tokyo" }, after), "2026-10-09T23:00:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "08:00", days: ["mon", "fri"], timeZone: "America/New_York" }, after), "2026-10-12T12:00:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "08:00", timeZone: "UTC" }, Date.parse("2026-10-10T08:00:00Z")), "2026-10-11T08:00:00.000Z");
});

test("DST gaps skip the missing wall time, including weekly and half-hour changes", () => {
  assert.equal(nextCalendarOccurrence({ at: "02:30", timeZone: "Europe/Berlin" }, Date.parse("2026-03-28T12:00:00Z")), "2026-03-30T00:30:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "02:30", days: ["sun"], timeZone: "Europe/Berlin" }, Date.parse("2026-03-28T12:00:00Z")), "2026-04-05T00:30:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "02:30", timeZone: "America/New_York" }, Date.parse("2026-03-07T12:00:00Z")), "2026-03-09T06:30:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "02:15", timeZone: "Australia/Lord_Howe" }, Date.parse("2026-10-03T00:00:00Z")), "2026-10-04T15:15:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "08:00", timeZone: "Pacific/Apia" }, Date.parse("2011-12-29T20:00:00Z")), "2011-12-30T18:00:00.000Z");
});

test("DST folds run only the first occurrence, including a restart between repeated times", () => {
  const schedule = { at: "02:30", timeZone: "Europe/Berlin" };
  assert.equal(nextCalendarOccurrence(schedule, Date.parse("2026-10-24T12:00:00Z")), "2026-10-25T00:30:00.000Z");
  assert.equal(nextCalendarOccurrence(schedule, Date.parse("2026-10-25T00:45:00Z")), "2026-10-26T01:30:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "01:30", timeZone: "America/New_York" }, Date.parse("2026-11-01T05:45:00Z")), "2026-11-02T06:30:00.000Z");
  assert.equal(nextCalendarOccurrence({ at: "01:45", timeZone: "Australia/Lord_Howe" }, Date.parse("2026-04-04T15:00:00Z")), "2026-04-05T15:15:00.000Z");
});

test("registration stores the server default, rejects invalid zones and validates wall times and weekdays", () => {
  const normalized = normalizeTriggers({ daily: { at: "08:00" }, weekly: { at: "09:00", days: ["mon"] } });
  assert.equal(normalized.daily?.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(normalized.weekly?.timeZone, normalized.daily?.timeZone);
  assert.throws(() => normalizeTriggers({ daily: { at: "08:00", timeZone: "Made/Up" } }), /IANA time zone/);
  assert.throws(() => normalizeTriggers({ daily: { at: "08:00", timeZone: "+02:00" } }), /IANA time zone/);
  const valid = (triggers: unknown) => Value.Check(appRegisterSchema, { name: "date", description: "Daily date", program: "date", permissions: {}, triggers });
  for (const at of ["8:00", "24:00", "08:60"]) assert.equal(valid({ daily: { at } }), false);
  for (const days of [[], ["mon", "mon"], ["monday"]]) assert.equal(valid({ weekly: { at: "08:00", days } }), false);
});

test("combinable schedules select the earliest kind and preserve fixed delay for intervals", () => {
  const after = Date.parse("2026-10-09T12:00:00Z");
  const triggers = normalizeTriggers({ interval: { everySeconds: 60 }, daily: { at: "08:00", timeZone: "Europe/Berlin" }, weekly: { at: "13:00", days: ["fri"], timeZone: "UTC" } });
  assert.deepEqual(nextScheduledOccurrence(triggers, after), { at: "2026-10-09T12:01:00.000Z", reason: "interval" });
  assert.deepEqual(nextScheduledOccurrence({ ...triggers, interval: undefined }, after), { at: "2026-10-09T13:00:00.000Z", reason: "weekly" });
  assert.equal(nextScheduledOccurrence({}, after), null);
});
