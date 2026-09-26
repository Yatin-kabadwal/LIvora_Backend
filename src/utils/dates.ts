/**
 * All stay dates are handled as calendar days ("YYYY-MM-DD") and stored as UTC-midnight Dates.
 * "Today" is computed in Indian Standard Time so a guest booking at 11:50pm IST gets the right day.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function todayIST(): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

export function parseDay(input: string | Date): Date {
  if (input instanceof Date) return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (!m) throw new Error("Invalid date");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
}

export const fmtDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const diffDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

export function eachNight(checkIn: Date, checkOut: Date): Date[] {
  const out: Date[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dayRangeIST(dateStr?: string) {
  const start = dateStr ? parseDay(dateStr) : todayIST();
  // Convert IST midnight to a UTC instant for timestamp-based queries.
  const startInstant = new Date(start.getTime() - IST_OFFSET_MS);
  return { day: start, start: startInstant, end: new Date(startInstant.getTime() + 86400000) };
}

export function monthRangeIST(month?: string) {
  const base = month ? parseDay(`${month}-01`) : todayIST();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const startDay = new Date(Date.UTC(y, m, 1));
  const endDay = new Date(Date.UTC(y, m + 1, 1));
  return {
    startDay,
    endDay,
    start: new Date(startDay.getTime() - IST_OFFSET_MS),
    end: new Date(endDay.getTime() - IST_OFFSET_MS),
  };
}
