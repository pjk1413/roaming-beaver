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
