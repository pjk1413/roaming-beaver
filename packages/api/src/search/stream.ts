import { prisma } from "@mystery-trips/db";
import {
  DestinationPackageSchema,
  TripSearchRequestSchema,
  assertValidTripDates,
  type DestinationPackage,
  type DestinationSlot,
  type TripSearchRequest,
} from "@mystery-trips/types";
import { ALL_SLOTS, matchSlotPackage } from "../matching/engine";
import { generateItinerary } from "../itinerary/generate";

export type SearchStreamEvent =
  | { type: "started"; searchId: string; mock?: boolean }
  | { type: "package"; package: DestinationPackage }
  | { type: "slot_error"; slot: DestinationSlot; message: string }
  | { type: "done"; searchId: string; mock?: boolean };

export const MAX_RESHUFFLES = 2;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rowToPackage(row: {
  id: string;
  slot: string;
  rank: number;
  city: string;
  country: string;
  airportCode: string;
  destinationId: string;
  flightJson: unknown;
  hotelJson: unknown;
  rentalCarJson: unknown;
  itineraryJson: unknown;
  subtotalCents: number;
  assemblyFeeCents: number;
  totalCents: number;
  currency: string;
}): DestinationPackage {
  return DestinationPackageSchema.parse({
    id: row.id,
    slot: row.slot,
    rank: row.rank,
    city: row.city,
    country: row.country,
    airportCode: row.airportCode,
    destinationId: row.destinationId,
    flight: row.flightJson,
    hotel: row.hotelJson,
    rentalCar: row.rentalCarJson,
    itinerary: row.itineraryJson,
    subtotalCents: row.subtotalCents,
    assemblyFeeCents: row.assemblyFeeCents,
    totalCents: row.totalCents,
    currency: row.currency,
  });
}

async function persistPackage(searchId: string, pkg: DestinationPackage) {
  const row = await prisma.destinationPackage.create({
    data: {
      searchId,
      destinationId: pkg.destinationId,
      slot: pkg.slot,
      rank: pkg.rank,
      city: pkg.city,
      country: pkg.country,
      airportCode: pkg.airportCode,
      flightJson: pkg.flight,
      hotelJson: pkg.hotel,
      rentalCarJson: pkg.rentalCar ?? undefined,
      itineraryJson: pkg.itinerary,
      subtotalCents: pkg.subtotalCents,
      assemblyFeeCents: pkg.assemblyFeeCents,
      totalCents: pkg.totalCents,
      currency: pkg.currency,
    },
  });
  return rowToPackage(row);
}

/**
 * Run all three slots in parallel. Each slot emits as soon as its single
 * cheapest package is ready (itineraries deferred to detail view).
 */
export async function runSearchSlots(
  searchId: string,
  req: TripSearchRequest,
  onEvent: (event: SearchStreamEvent) => void | Promise<void>,
): Promise<void> {
  await prisma.tripSearch.update({
    where: { id: searchId },
    data: { status: "RUNNING" },
  });

  const slotErrors: Partial<Record<DestinationSlot, string>> = {};

  // Sequential slots — parallel slots + Duffel concurrency blows the rate limit
  for (const slot of ALL_SLOTS) {
    try {
      const pkg = await matchSlotPackage(slot, req, {
        listDestinations: () => prisma.destination.findMany(),
        rank: 0,
      });
      const saved = await persistPackage(searchId, pkg);
      try {
        await onEvent({ type: "package", package: saved });
      } catch {
        /* stream may have disconnected — package is already persisted */
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Slot search failed";
      slotErrors[slot] = message;
      console.warn(`[search] ${slot} error:`, message);
      try {
        await onEvent({ type: "slot_error", slot, message });
      } catch {
        /* ignore */
      }
    }
  }

  const packageCount = await prisma.destinationPackage.count({
    where: { searchId },
  });
  const status = packageCount === 0 ? "FAILED" : "COMPLETE";

  await prisma.tripSearch.update({
    where: { id: searchId },
    data: {
      status,
      slotErrors:
        Object.keys(slotErrors).length > 0 ? slotErrors : undefined,
    },
  });

  try {
    await onEvent({ type: "done", searchId });
  } catch {
    /* ignore */
  }
}

/**
 * Fetch the next-cheapest city per slot, excluding destinations already shown.
 * Streams each replacement as it lands.
 */
export async function reshuffleSearchSlots(
  searchId: string,
  onEvent: (event: SearchStreamEvent) => void | Promise<void>,
): Promise<{ packages: DestinationPackage[]; reshufflesUsed: number }> {
  const search = await prisma.tripSearch.findUnique({
    where: { id: searchId },
    include: { packages: true },
  });
  if (!search) throw new Error("Search not found");
  if (search.status !== "COMPLETE" && search.status !== "FAILED") {
    throw new Error("Search still running");
  }

  const existing = search.packages.map(rowToPackage);
  const maxRank = existing.reduce((m, p) => Math.max(m, p.rank), 0);
  if (maxRank >= MAX_RESHUFFLES) {
    throw new Error("No more reshuffles left for this search");
  }

  const nextRank = maxRank + 1;
  const excludeBySlot = new Map<DestinationSlot, string[]>();
  for (const slot of ALL_SLOTS) {
    excludeBySlot.set(
      slot,
      existing.filter((p) => p.slot === slot).map((p) => p.destinationId),
    );
  }

  const req = requestFromSearch(search);
  const slotErrors: Partial<Record<DestinationSlot, string>> = {
    ...((search.slotErrors ?? {}) as Partial<Record<DestinationSlot, string>>),
  };
  const fresh: DestinationPackage[] = [];

  await onEvent({ type: "started", searchId });

  await Promise.all(
    ALL_SLOTS.map(async (slot) => {
      try {
        const pkg = await matchSlotPackage(slot, req, {
          listDestinations: () => prisma.destination.findMany(),
          excludeDestinationIds: excludeBySlot.get(slot) ?? [],
          rank: nextRank,
        });
        const saved = await persistPackage(searchId, pkg);
        fresh.push(saved);
        await onEvent({ type: "package", package: saved });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No more options for this slot";
        slotErrors[slot] = message;
        console.warn(`[search] reshuffle ${slot}:`, message);
        await onEvent({ type: "slot_error", slot, message });
      }
    }),
  );

  await prisma.tripSearch.update({
    where: { id: searchId },
    data: {
      status: fresh.length === 0 && existing.length === 0 ? "FAILED" : "COMPLETE",
      slotErrors:
        Object.keys(slotErrors).length > 0 ? slotErrors : undefined,
    },
  });

  await onEvent({ type: "done", searchId });
  return { packages: fresh, reshufflesUsed: nextRank };
}

/** Lazily generate + persist itinerary for a package (detail page). */
export async function ensurePackageItinerary(
  packageId: string,
): Promise<DestinationPackage> {
  const row = await prisma.destinationPackage.findUniqueOrThrow({
    where: { id: packageId },
    include: { destination: true, search: true },
  });

  const current = rowToPackage(row);
  if (current.itinerary.length > 0) return current;

  const nights = Math.max(
    1,
    Math.round(
      (row.search.returnDate.getTime() - row.search.departDate.getTime()) /
        86_400_000,
    ),
  );

  const itinerary = await generateItinerary({
    city: row.city,
    country: row.country,
    nights,
    notes: row.destination.notes,
    slot: row.slot as DestinationSlot,
  });

  const updated = await prisma.destinationPackage.update({
    where: { id: packageId },
    data: { itineraryJson: itinerary },
  });
  return rowToPackage(updated);
}

export async function createSearchRecord(
  input: TripSearchRequest,
  userId?: string,
) {
  const parsed = TripSearchRequestSchema.parse(input);
  assertValidTripDates(parsed.departDate, parsed.returnDate);

  return prisma.tripSearch.create({
    data: {
      homeAirport: parsed.homeAirport,
      departDate: new Date(parsed.departDate),
      returnDate: new Date(parsed.returnDate),
      travelers: parsed.travelers,
      userId: userId ?? null,
      status: "PENDING",
    },
  });
}

export function requestFromSearch(search: {
  homeAirport: string;
  departDate: Date;
  returnDate: Date;
  travelers: number;
}): TripSearchRequest {
  return TripSearchRequestSchema.parse({
    homeAirport: search.homeAirport,
    departDate: toIsoDate(search.departDate),
    returnDate: toIsoDate(search.returnDate),
    travelers: search.travelers,
  });
}

export async function getSearchStatus(searchId: string) {
  const search = await prisma.tripSearch.findUnique({
    where: { id: searchId },
    include: { packages: { orderBy: [{ slot: "asc" }, { rank: "asc" }] } },
  });
  if (!search) return null;

  const packages = search.packages.map(rowToPackage);
  const errors = (search.slotErrors ?? {}) as Partial<
    Record<DestinationSlot, string>
  >;

  // Prefer the latest rank per slot for "current" view helpers
  const latestBySlot = new Map<DestinationSlot, DestinationPackage>();
  for (const pkg of packages) {
    const prev = latestBySlot.get(pkg.slot);
    if (!prev || pkg.rank >= prev.rank) latestBySlot.set(pkg.slot, pkg);
  }

  const pendingSlots = ALL_SLOTS.filter(
    (slot) =>
      !packages.some((p) => p.slot === slot) &&
      !errors[slot] &&
      search.status !== "COMPLETE" &&
      search.status !== "FAILED",
  );

  const maxRank = packages.reduce((m, p) => Math.max(m, p.rank), 0);

  return {
    searchId: search.id,
    status: search.status,
    packages,
    latestPackages: [...latestBySlot.values()],
    slotErrors: errors,
    pendingSlots,
    maxRank,
    reshufflesRemaining: Math.max(0, MAX_RESHUFFLES - maxRank),
  };
}
