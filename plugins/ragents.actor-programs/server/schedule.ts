import { DomainError } from "@ragents/engine";
import { calendarTimeZone, nextCalendarOccurrence as calendarOccurrence, type CalendarSchedule } from "@ragents/host/plugin-support/actor-programs/calendar.js";
import type { AppTriggers } from "@ragents/host/plugin-support/actor-programs/contract.js";

export type ScheduledReason = "interval" | "daily" | "weekly";
export interface ScheduledOccurrence {
  readonly at: string;
  readonly reason: ScheduledReason;
}
const domain = <T>(work: () => T): T => {
  try { return work(); }
  catch (error) { throw new DomainError((error as { code?: string }).code ?? "trigger-schedule-invalid", error instanceof Error ? error.message : String(error), 400); }
};
const timeZoneOf = (timeZone?: string): string => domain(() => calendarTimeZone(timeZone));
export const serverTimeZone = (): string => timeZoneOf();
export const normalizeTriggers = (triggers: AppTriggers): AppTriggers => ({
  ...triggers,
  ...triggers.daily ? { daily: { ...triggers.daily, timeZone: timeZoneOf(triggers.daily.timeZone) } } : {},
  ...triggers.weekly ? { weekly: { ...triggers.weekly, timeZone: timeZoneOf(triggers.weekly.timeZone) } } : {},
});
export const nextCalendarOccurrence = (schedule: CalendarSchedule, after: number): string => domain(() => calendarOccurrence(schedule, after));
export const nextScheduledOccurrence = (triggers: AppTriggers, after: number): ScheduledOccurrence | null => {
  const occurrences: readonly ScheduledOccurrence[] = [
    ...triggers.interval ? [{ at: new Date(after + triggers.interval.everySeconds * 1000).toISOString(), reason: "interval" as const }] : [],
    ...triggers.daily ? [{ at: nextCalendarOccurrence(triggers.daily, after), reason: "daily" as const }] : [],
    ...triggers.weekly ? [{ at: nextCalendarOccurrence(triggers.weekly, after), reason: "weekly" as const }] : [],
  ];
  return [...occurrences].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
};
