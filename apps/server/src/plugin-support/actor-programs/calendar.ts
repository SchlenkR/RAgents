/** A local wall time, daily or on the named weekdays, in an IANA time zone; without a zone the server's. */
export interface CalendarSchedule {
  readonly at: string;
  readonly timeZone?: string | undefined;
  readonly days?: readonly ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[] | undefined;
}

const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY = 86400000;
const failed = (code: string, message: string): Error => Object.assign(new Error(message), { code });

/** The IANA zone, by default the server's; an offset or unknown zone is an error with the code trigger-time-zone-invalid. */
export const calendarTimeZone = (timeZone?: string): string => {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    if (/^[+-]/.test(zone)) throw new Error("Offset zones are not IANA zones.");
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch { throw failed("trigger-time-zone-invalid", `Time zone ${zone} is not an IANA time zone.`); }
};

const wallTime = (format: Intl.DateTimeFormat, instant: number): number => {
  const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
};

/** The first occurrence after `after`: a wall time skipped by daylight saving has none, a repeated one only its first. */
export const nextCalendarOccurrence = (schedule: CalendarSchedule, after: number): string => {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: calendarTimeZone(schedule.timeZone), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
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
  throw failed("trigger-schedule-invalid", "No calendar occurrence exists in the next sixteen days.");
};

/** The latest occurrence after `since` and at or before `now`; null while the first one is still ahead. */
export const latestCalendarOccurrence = (schedule: CalendarSchedule, since: number, now: number): string | null => {
  let cursor = Math.max(since, now - 8 * DAY);
  let latest: string | null = null;
  for (;;) {
    const next = nextCalendarOccurrence(schedule, cursor);
    if (Date.parse(next) > now) return latest;
    latest = next;
    cursor = Date.parse(next);
  }
};
