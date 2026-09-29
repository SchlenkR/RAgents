const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const date = (at: number, year: boolean): string =>
  new Date(at).toLocaleDateString("en-US", year ? { day: "2-digit", month: "2-digit", year: "numeric" } : { day: "2-digit", month: "2-digit" });

/** The time in the list: now, 5 min, 3 h, 2 d, from seven days on the date. Without "ago", without a special case for yesterday. */
export const shortTime = (at: number, now: number = Date.now()): string => {
  const passed = now - at;
  if (passed < MINUTE) return "now";
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)} min`;
  if (passed < DAY) return `${Math.floor(passed / HOUR)} h`;
  if (passed < WEEK) return `${Math.floor(passed / DAY)} d`;
  return date(at, false);
};

/** The same time written out; it appears only in the title of the compact time. */
export const longTime = (at: number, now: number = Date.now()): string => {
  const passed = now - at;
  if (passed < MINUTE) return "just now";
  if (passed < HOUR) {
    const minutes = Math.floor(passed / MINUTE);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  if (passed < DAY) {
    const hours = Math.floor(passed / HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (passed < WEEK) {
    const days = Math.floor(passed / DAY);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  return date(at, true);
};
