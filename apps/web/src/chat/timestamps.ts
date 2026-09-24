import type { TimestampOptions } from "./options";

export function messageDate(at: string | undefined): Date | undefined {
  if (!at) return undefined;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function timestampLabel(date: Date, options: TimestampOptions = {}, now = Date.now()): string {
  if ((!options.format || options.format === "time") && !options.locale && !options.timeZone) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (options.format === "relative") {
    const seconds = (date.getTime() - now) / 1000;
    const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
      ["year", 365 * 86400], ["month", 30 * 86400], ["day", 86400], ["hour", 3600], ["minute", 60],
    ];
    const [unit, divisor] = units.find(([, value]) => Math.abs(seconds) >= value) ?? ["second", 1];
    return new Intl.RelativeTimeFormat(options.locale, { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
  }
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(options.format === "date-time" ? { year: "numeric", month: "2-digit", day: "2-digit" } as const : {}),
  }).format(date);
}

export function timestampDay(date: Date, options: TimestampOptions = {}): { key: string; label: string } {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: options.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  const label = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone, dateStyle: "long",
  }).format(date);
  return { key, label };
}
