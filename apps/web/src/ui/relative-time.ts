const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const date = (at: number, year: boolean): string =>
  new Date(at).toLocaleDateString("de-DE", year ? { day: "2-digit", month: "2-digit", year: "numeric" } : { day: "2-digit", month: "2-digit" });

/** Die Zeit in der Liste: jetzt, 5 min, 3 h, 2 d, ab sieben Tagen das Datum. Ohne "vor", ohne Sonderfall für gestern. */
export const shortTime = (at: number, now: number = Date.now()): string => {
  const passed = now - at;
  if (passed < MINUTE) return "jetzt";
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)} min`;
  if (passed < DAY) return `${Math.floor(passed / HOUR)} h`;
  if (passed < WEEK) return `${Math.floor(passed / DAY)} d`;
  return date(at, false);
};

/** Dieselbe Zeit ausgeschrieben; sie steht nur im title der kompakten Zeit. */
export const longTime = (at: number, now: number = Date.now()): string => {
  const passed = now - at;
  if (passed < MINUTE) return "gerade eben";
  if (passed < HOUR) {
    const minutes = Math.floor(passed / MINUTE);
    return minutes === 1 ? "vor 1 Minute" : `vor ${minutes} Minuten`;
  }
  if (passed < DAY) {
    const hours = Math.floor(passed / HOUR);
    return hours === 1 ? "vor 1 Stunde" : `vor ${hours} Stunden`;
  }
  if (passed < WEEK) {
    const days = Math.floor(passed / DAY);
    return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
  }
  return date(at, true);
};
