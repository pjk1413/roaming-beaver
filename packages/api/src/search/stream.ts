import { prisma } from "@mystery-trips/db";
import {
  DestinationPackageSchema,
  TripSearchRequestSchema,
  assertValidTripDates,
  type DestinationPackage,
  type DestinationSlot,
  type TripSearchRequest,
} from "@mystery-trips/types";
import { ALL_SLOTS, getSlotPackageCached, listApprovedDestinations } from "../matching/engine";
import { generateItinerary } from "../itinerary/generate";

export type SearchStreamEvent =
  | { type: "started"; searchId: string; mock?: boolean }
  | { type: "package"; package: DestinationPackage }
  | { type: "slot_error"; slot: DestinationSlot; message: string }
  | { type: "done"; searchId: string; mock?: boolean };

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rowToPackage(
  row: {
    id: string;
    slot: string;
    rank: number;
    city: string;
    country: string;
    airportCode: string;
    destinationId: string;
    flightJson: unknown;
    hotelJson: unknown;
    itineraryJson: unknown;
    subtotalCents: number;
    assemblyFeeCents: number;
    totalCents: number;
    currency: string;
  },
  images: DestinationPackage["images"] = [],
): DestinationPackage {
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
    itinerary: row.itineraryJson,
    subtotalCents: row.subtotalCents,
    assemblyFeeCents: row.assemblyFeeCents,
    totalCents: row.totalCents,
    currency: row.currency,
    images,
  });
}

async function loadImagesForDestinations(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) {
    return new Map<string, DestinationPackage["images"]>();
  }
  const rows = await prisma.destinationImage.findMany({
    where: { destinationId: { in: unique } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const map = new Map<string, DestinationPackage["images"]>();
  for (const row of rows) {
    const list = map.get(row.destinationId) ?? [];
    list.push({
      url: row.url,
      thumbUrl: row.thumbUrl,
      attribution: row.attribution,
      source: row.source,
      sourcePageUrl: row.sourcePageUrl,
      kind: row.kind,
      caption: row.caption,
      sortOrder: row.sortOrder,
    });
    map.set(row.destinationId, list);
  }
  return map;
}

async function persistPackage(searchId: string, pkg: DestinationPackage) {
  const row = await prisma.destinationPackage.create({
    data: {
      searchId,
      destinationId: pkg.destinationId,
      slot: pkg.slot,
      rank: 0,
      city: pkg.city,
      country: pkg.country,
      airportCode: pkg.airportCode,
      flightJson: pkg.flight,
      hotelJson: pkg.hotel,
      itineraryJson: pkg.itinerary,
      subtotalCents: pkg.subtotalCents,
      assemblyFeeCents: pkg.assemblyFeeCents,
      totalCents: pkg.totalCents,
      currency: pkg.currency,
    },
  });
  const imageMap = await loadImagesForDestinations([row.destinationId]);
  return rowToPackage(row, imageMap.get(row.destinationId) ?? []);
}

/**
 * Run all three slots sequentially. Each slot uses the two-tier match cache
 * (itineraries deferred to detail view).
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

  for (const slot of ALL_SLOTS) {
    try {
      const pkg = await getSlotPackageCached(slot, req, {
        listDestinations: () => listApprovedDestinations(),
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

/** Lazily generate + persist itinerary for a package (detail page). */
export async function ensurePackageItinerary(
  packageId: string,
): Promise<DestinationPackage> {
  const row = await prisma.destinationPackage.findUniqueOrThrow({
    where: { id: packageId },
    include: { destination: true, search: true },
  });

  const imageMapEarly = await loadImagesForDestinations([row.destinationId]);
  const current = rowToPackage(
    row,
    imageMapEarly.get(row.destinationId) ?? [],
  );
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

  await prisma.destinationPackage.update({
    where: { id: packageId },
    data: { itineraryJson: itinerary },
  });
  return rowToPackage(
    { ...row, itineraryJson: itinerary },
    imageMapEarly.get(row.destinationId) ?? [],
  );
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

  const imageMap = await loadImagesForDestinations(
    search.packages.map((p) => p.destinationId),
  );
  const packages = search.packages.map((p) =>
    rowToPackage(p, imageMap.get(p.destinationId) ?? []),
  );
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
