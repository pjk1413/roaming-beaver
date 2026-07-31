/** Shared calendar-date helpers (YYYY-MM-DD, no timezones in the string). */

export const MIN_TRIP_NIGHTS = 2;

export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Nights between depart and return (return − depart in calendar days). */
export function calendarNights(departDate: string, returnDate: string): number {
  const [y1, m1, d1] = departDate.split("-").map(Number);
  const [y2, m2, d2] = returnDate.split("-").map(Number);
  const a = Date.UTC(y1!, m1! - 1, d1!);
  const b = Date.UTC(y2!, m2! - 1, d2!);
  return Math.round((b - a) / 86_400_000);
}

export function todayIsoLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Earliest bookable depart: tomorrow (local). */
export function minDepartDate(now = new Date()): string {
  return addCalendarDays(todayIsoLocal(now), 1);
}

/** Earliest return for a depart date (2-night minimum). */
export function minReturnDate(departDate: string): string {
  return addCalendarDays(departDate, MIN_TRIP_NIGHTS);
}

export function todayIsoUTC(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Server-side guard using UTC calendar dates. */
export function assertValidTripDates(
  departDate: string,
  returnDate: string,
  now = new Date(),
): void {
  const minDepart = addCalendarDays(todayIsoUTC(now), 1);
  if (departDate < minDepart) {
    throw new Error("Departure must be tomorrow or later.");
  }
  const nights = calendarNights(departDate, returnDate);
  if (nights < MIN_TRIP_NIGHTS) {
    throw new Error(
      `Trips need at least ${MIN_TRIP_NIGHTS} nights — pick a later return date.`,
    );
  }
}
