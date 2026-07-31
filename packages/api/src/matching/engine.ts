import type { Destination } from "@mystery-trips/db";
import {
  clampAssemblyFeeRate,
  ASSEMBLY_FEE_DEFAULT,
  type DestinationPackage,
  type DestinationSlot,
  type Flight,
  type TripSearchRequest,
} from "@mystery-trips/types";
import { createTravelSupplier, type TravelSupplier } from "../duffel";
import { BEACH_WALK_METERS, WARM_TEMP_C, haversineMeters } from "./geo";

type DestinationRow = Destination;

export type MatchingDeps = {
  supplier?: TravelSupplier;
  listDestinations: () => Promise<DestinationRow[]>;
  assemblyFeeRate?: number;
  /** Destinations already shown — skip so “try again” gets a new city. */
  excludeDestinationIds?: string[];
  /** Rank to stamp on the returned package (0 = first search, 1+ = reshuffles). */
  rank?: number;
};

export const ALL_SLOTS: DestinationSlot[] = [
  "BUDGET_GETAWAY",
  "BEACH_ESCAPE",
  "EXOTIC_ADVENTURE",
];

/** Parallel Duffel calls per phase — keep low to avoid 429s. */
const CONCURRENCY = 2;
/** After flight prices, only hotel-quote the cheapest N routes. */
const HOTEL_SHORTLIST = 3;

function monthIndex(isoDate: string): number {
  return Number(isoDate.slice(5, 7)) - 1;
}

function cityCoords(d: DestinationRow): { lat: number; lng: number } {
  if (d.beachLat != null && d.beachLng != null) {
    return { lat: d.beachLat, lng: d.beachLng };
  }
  const approx: Record<string, { lat: number; lng: number }> = {
    AUS: { lat: 30.2672, lng: -97.7431 },
    DEN: { lat: 39.7392, lng: -104.9903 },
    ORD: { lat: 41.8781, lng: -87.6298 },
    MEX: { lat: 19.4326, lng: -99.1332 },
    YUL: { lat: 45.5017, lng: -73.5673 },
    LAS: { lat: 36.1699, lng: -115.1398 },
    CUN: { lat: 21.1619, lng: -86.8515 },
    MIA: { lat: 25.7617, lng: -80.1918 },
    SJU: { lat: 18.4655, lng: -66.1057 },
    HNL: { lat: 21.3069, lng: -157.8583 },
    LIS: { lat: 38.7223, lng: -9.1393 },
    KEF: { lat: 64.1466, lng: -21.9426 },
    NRT: { lat: 35.6762, lng: 139.6503 },
    RAK: { lat: 31.6295, lng: -7.9811 },
    CPT: { lat: -33.9249, lng: 18.4241 },
  };
  return approx[d.airportCode] ?? { lat: 0, lng: 0 };
}

function isWarmBeach(d: DestinationRow, departDate: string): boolean {
  if (!d.isBeach) return false;
  const temps = d.avgTempByMonthC as number[] | null;
  if (!temps || temps.length < 12) return d.isBeach;
  const t = temps[monthIndex(departDate)];
  return t != null && t >= WARM_TEMP_C;
}

function candidatesForSlot(
  slot: DestinationSlot,
  all: DestinationRow[],
  departDate: string,
  excludeIds: Set<string>,
): DestinationRow[] {
  const available = all.filter((d) => !excludeIds.has(d.id));
  if (slot === "BUDGET_GETAWAY") {
    const budgetCandidates = available.filter(
      (d) => !d.isBeach || d.isExoticShortlist === false,
    );
    return budgetCandidates.length ? budgetCandidates : available;
  }
  if (slot === "BEACH_ESCAPE") {
    const beachPool = available.filter((d) => isWarmBeach(d, departDate));
    return beachPool.length
      ? beachPool
      : available.filter((d) => d.isBeach);
  }
  const exoticPool = available.filter((d) => d.isExoticShortlist);
  return exoticPool.length ? exoticPool : available;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

type PricedPackage = Omit<DestinationPackage, "itinerary" | "rank"> & {
  itinerary: [];
};

async function priceWithFlight(
  slot: DestinationSlot,
  dest: DestinationRow,
  flight: Flight,
  req: TripSearchRequest,
  supplier: TravelSupplier,
  assemblyFeeRate: number,
): Promise<PricedPackage | null> {
  const coords = cityCoords(dest);

  const stays = await supplier.searchStays({
    latitude: coords.lat,
    longitude: coords.lng,
    radiusKm: slot === "BEACH_ESCAPE" ? 3 : 8,
    checkIn: req.departDate,
    checkOut: req.returnDate,
    guests: req.travelers,
    minStars: 2.5,
    maxStars: 3.5,
  });

  let hotel = stays[0];
  if (slot === "BEACH_ESCAPE") {
    if (dest.beachLat == null || dest.beachLng == null) return null;
    hotel =
      stays.find((h) => {
        const dist = haversineMeters(
          h.lat,
          h.lng,
          dest.beachLat!,
          dest.beachLng!,
        );
        h.distanceToBeachMeters = Math.round(dist);
        return dist <= BEACH_WALK_METERS;
      }) ?? undefined;
  }
  if (!hotel) return null;

  let rentalCar = null;
  if (slot === "BUDGET_GETAWAY" && !dest.hasGoodPublicTransit) {
    const cars = await supplier.searchCars({
      airportCode: dest.airportCode,
      pickUpDate: req.departDate,
      dropOffDate: req.returnDate,
    });
    rentalCar = cars[0] ?? null;
  }

  const subtotalCents =
    flight.totalCents + hotel.totalCents + (rentalCar?.totalCents ?? 0);
  const assemblyFeeCents = Math.round(subtotalCents * assemblyFeeRate);
  const totalCents = subtotalCents + assemblyFeeCents;

  return {
    id: `pkg_tmp_${slot}_${dest.id}`,
    slot,
    city: dest.city,
    country: dest.country,
    airportCode: dest.airportCode,
    destinationId: dest.id,
    flight,
    hotel,
    rentalCar,
    itinerary: [],
    subtotalCents,
    assemblyFeeCents,
    totalCents,
    currency: "USD",
  };
}

/**
 * Fast path: quote flights for all candidates (pooled), hotel-quote only the
 * cheapest flight shortlist, return a single cheapest complete package.
 * Itineraries are deferred to the trip detail page.
 */
async function pickCheapestPackage(
  slot: DestinationSlot,
  candidates: DestinationRow[],
  req: TripSearchRequest,
  supplier: TravelSupplier,
  assemblyFeeRate: number,
  rank: number,
): Promise<DestinationPackage | null> {
  if (candidates.length === 0) return null;

  const t0 = Date.now();

  const flightQuotes = await mapPool(
    candidates,
    CONCURRENCY,
    async (dest) => {
      try {
        const flights = await supplier.searchFlights({
          origin: req.homeAirport,
          destination: dest.airportCode,
          departDate: req.departDate,
          returnDate: req.returnDate,
          passengers: req.travelers,
        });
        const flight = flights[0];
        return flight ? { dest, flight } : null;
      } catch (err) {
        console.warn(
          `[matching] ${slot} flight failed for ${dest.airportCode}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    },
  );

  const withFlights = flightQuotes
    .filter((q): q is { dest: DestinationRow; flight: Flight } => q != null)
    .sort((a, b) => a.flight.totalCents - b.flight.totalCents);

  if (withFlights.length === 0) return null;

  const shortlist = withFlights.slice(0, HOTEL_SHORTLIST);
  console.info(
    `[matching] ${slot}: ${withFlights.length} flights in ${Date.now() - t0}ms → hotel shortlist ${shortlist.length}`,
  );

  const t1 = Date.now();
  const hotelQuotes = await mapPool(shortlist, CONCURRENCY, async (q) => {
    try {
      return await priceWithFlight(
        slot,
        q.dest,
        q.flight,
        req,
        supplier,
        assemblyFeeRate,
      );
    } catch (err) {
      console.warn(
        `[matching] ${slot} stay failed for ${q.dest.airportCode}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  });

  const priced = hotelQuotes.filter((p): p is PricedPackage => p != null);
  priced.sort((a, b) => a.totalCents - b.totalCents);
  console.info(
    `[matching] ${slot}: ${priced.length} complete pkgs in ${Date.now() - t1}ms (total ${Date.now() - t0}ms)`,
  );

  const best = priced[0];
  if (!best) return null;
  return { ...best, rank, itinerary: [] };
}

function feeFromDeps(deps: MatchingDeps): number {
  return clampAssemblyFeeRate(
    deps.assemblyFeeRate ??
      Number(process.env.ASSEMBLY_FEE_RATE ?? ASSEMBLY_FEE_DEFAULT),
  );
}

/** Match the single cheapest package for one slot (streams as soon as ready). */
export async function matchSlotPackage(
  slot: DestinationSlot,
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage> {
  const supplier = deps.supplier ?? createTravelSupplier();
  const fee = feeFromDeps(deps);
  const exclude = new Set(deps.excludeDestinationIds ?? []);
  const rank = deps.rank ?? 0;
  const all = await deps.listDestinations();

  let pkg = await pickCheapestPackage(
    slot,
    candidatesForSlot(slot, all, req.departDate, exclude),
    req,
    supplier,
    fee,
    rank,
  );

  if (!pkg && exclude.size > 0) {
    // Exhausted filtered pool — try remaining destinations outside slot filter
    pkg = await pickCheapestPackage(
      slot,
      all.filter((d) => !exclude.has(d.id)),
      req,
      supplier,
      fee,
      rank,
    );
  }

  if (!pkg) {
    throw new Error(`No valid offers found for ${slot}`);
  }
  return pkg;
}

/** @deprecated Prefer matchSlotPackage — kept for callers expecting an array. */
export async function matchSlotPackages(
  slot: DestinationSlot,
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage[]> {
  return [await matchSlotPackage(slot, req, deps)];
}

export async function matchThreePackages(
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage[]> {
  const settled = await Promise.allSettled(
    ALL_SLOTS.map((slot) => matchSlotPackage(slot, req, deps)),
  );

  const bySlot: DestinationPackage[] = [];
  for (let i = 0; i < ALL_SLOTS.length; i++) {
    const result = settled[i]!;
    if (result.status === "fulfilled") {
      bySlot.push(result.value);
    } else {
      console.warn(
        `[matching] slot ${ALL_SLOTS[i]} failed:`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  }
  return bySlot;
}
