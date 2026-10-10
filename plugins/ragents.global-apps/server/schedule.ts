import { DomainError } from "@ragents/engine";
import type { GlobalAppRegister } from "../contract.js";

type Triggers = NonNullable<GlobalAppRegister["triggers"]>;
export type ScheduledReason = "interval" | "daily" | "weekly";
export interface ScheduledOccurrence {
  readonly at: string;
  readonly reason: ScheduledReason;
}
const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const timeZoneOf = (timeZone?: string): string => {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    if (/^[+-]/.test(zone)) throw new Error("Offset zones are not IANA zones.");
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch { throw new DomainError("app-time-zone-invalid", `Time zone ${zone} is not an IANA time zone.`, 400); }
};
export const serverTimeZone = (): string => timeZoneOf();
export const normalizeTriggers = (triggers: Triggers): Triggers => ({
  ...triggers,
  ...triggers.daily ? { daily: { ...triggers.daily, timeZone: timeZoneOf(triggers.daily.timeZone) } } : {},
  ...triggers.weekly ? { weekly: { ...triggers.weekly, timeZone: timeZoneOf(triggers.weekly.timeZone) } } : {},
});
const wallTime = (format: Intl.DateTimeFormat, instant: number): number => {
  const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
};
export const nextCalendarOccurrence = (schedule: NonNullable<Triggers["daily"]> & { readonly days?: NonNullable<Triggers["weekly"]>["days"] }, after: number): string => {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timeZoneOf(schedule.timeZone), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const local = new Date(wallTime(format, after));
  const [hour, minute] = schedule.at.split(":").map(Number);
  const dates = Array.from({ length: 16 }, (_, offset) => Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset, hour, minute));
  for (const date of dates) {
    if (schedule.days && !schedule.days.includes(weekdays[new Date(date).getUTCDay()]!)) continue;
    const samples = Array.from({ length: 13 }, (_, index) => date + (index - 6) * 6 * 3600000);
    const offsets = [...new Set(samples.map((sample) => wallTime(format, sample) - sample))];
    const matches = offsets.map((offset) => date - offset).filter((candidate) => wallTime(format, candidate) === date).sort((a, b) => a - b);
    const first = matches[0];
    if (first !== undefined && first > after) return new Date(first).toISOString();
  }
  throw new DomainError("app-schedule-invalid", "No calendar occurrence exists in the next sixteen days.", 400);
};
export const nextScheduledOccurrence = (triggers: Triggers, after: number): ScheduledOccurrence | null => {
  const occurrences: readonly ScheduledOccurrence[] = [
    ...triggers.interval ? [{ at: new Date(after + triggers.interval.everySeconds * 1000).toISOString(), reason: "interval" as const }] : [],
    ...triggers.daily ? [{ at: nextCalendarOccurrence(triggers.daily, after), reason: "daily" as const }] : [],
    ...triggers.weekly ? [{ at: nextCalendarOccurrence(triggers.weekly, after), reason: "weekly" as const }] : [],
  ];
  return [...occurrences].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
};
