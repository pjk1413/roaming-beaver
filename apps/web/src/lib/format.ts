import type { DestinationSlot } from "@mystery-trips/types";

export const SLOT_META: Record<
  DestinationSlot,
  { label: string; hue: string; badge: string }
> = {
  BUDGET_GETAWAY: {
    label: "Budget Getaway",
    hue: "var(--color-hue-cheap)",
    badge: "$",
  },
  BEACH_ESCAPE: {
    label: "Beach Escape",
    hue: "var(--color-hue-beach)",
    badge: "~",
  },
  EXOTIC_ADVENTURE: {
    label: "Exotic Pick",
    hue: "var(--color-hue-exotic)",
    badge: "?",
  },
};

export function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function nightsBetween(depart: string, ret: string): number {
  const a = new Date(depart);
  const b = new Date(ret);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function formatDateRange(depart?: string, ret?: string) {
  if (!depart) return "your dates";
  if (!ret) return depart;
  return `${depart} – ${ret}`;
}

/** Format an ISO datetime for trip detail (e.g. "Aug 12 · 8:30 AM"). */
export function formatFlightTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatDurationMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
