import { prisma } from "@mystery-trips/db";
import {
  DestinationPackageSchema,
  TripSearchRequestSchema,
  type DestinationPackage,
  type DestinationSlot,
  type TripSearchRequest,
} from "@mystery-trips/types";
import { ALL_SLOTS, matchSlotPackage } from "../matching/engine";

export type SearchStreamEvent =
  | { type: "started"; searchId: string }
  | { type: "package"; package: DestinationPackage }
  | { type: "slot_error"; slot: DestinationSlot; message: string }
  | { type: "done"; searchId: string };

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rowToPackage(row: {
  id: string;
  slot: string;
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
 * Run all three slot searches in parallel and invoke `onEvent` as each resolves.
 * Persists packages / slot errors on the TripSearch row for polling fallback.
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

  await Promise.all(
    ALL_SLOTS.map(async (slot) => {
      try {
        const pkg = await matchSlotPackage(slot, req, {
          listDestinations: () => prisma.destination.findMany(),
        });
        const saved = await persistPackage(searchId, pkg);
        await onEvent({ type: "package", package: saved });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Slot search failed";
        slotErrors[slot] = message;
        console.warn(`[search] ${slot} error:`, message);
        await onEvent({ type: "slot_error", slot, message });
      }
    }),
  );

  const packageCount = await prisma.destinationPackage.count({
    where: { searchId },
  });
  const status =
    packageCount === 0
      ? "FAILED"
      : Object.keys(slotErrors).length > 0
        ? "COMPLETE"
        : "COMPLETE";

  await prisma.tripSearch.update({
    where: { id: searchId },
    data: {
      status,
      slotErrors:
        Object.keys(slotErrors).length > 0 ? slotErrors : undefined,
    },
  });

  await onEvent({ type: "done", searchId });
}

export async function createSearchRecord(
  input: TripSearchRequest,
  userId?: string,
) {
  const parsed = TripSearchRequestSchema.parse(input);
  if (parsed.returnDate <= parsed.departDate) {
    throw new Error("Return date must be after depart date");
  }

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
    include: { packages: true },
  });
  if (!search) return null;

  const packages = search.packages.map(rowToPackage);
  const errors = (search.slotErrors ?? {}) as Partial<
    Record<DestinationSlot, string>
  >;
  const pendingSlots = ALL_SLOTS.filter(
    (slot) =>
      !packages.some((p) => p.slot === slot) &&
      !errors[slot] &&
      search.status !== "COMPLETE" &&
      search.status !== "FAILED",
  );

  return {
    searchId: search.id,
    status: search.status,
    packages,
    slotErrors: errors,
    pendingSlots,
  };
}
