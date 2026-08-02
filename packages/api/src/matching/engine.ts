import type { Destination } from "@mystery-trips/db";
import { prisma, ProfileStatus } from "@mystery-trips/db";
import {
  clampAssemblyFeeRate,
  ASSEMBLY_FEE_DEFAULT,
  FlightSchema,
  HotelSchema,
  type DestinationPackage,
  type DestinationSlot,
  type Flight,
  type Hotel,
  type TripSearchRequest,
} from "@mystery-trips/types";
import {
  createFlightSupplier,
  createHotelSupplier,
  type FlightSupplier,
  type HotelSupplier,
} from "../travel";
import { BEACH_WALK_METERS, WARM_TEMP_C, haversineMeters } from "./geo";
import {
  flightTimingAdjustedCents,
  hotelDistanceScore,
  HOTEL_DISTANCE_WEIGHT,
} from "./scoring";
import { hasVibe } from "../destinations/vibes";
import { MAX_STAY_AREAS } from "../destinations/profile";

/** Destination with StayAreas (hotel search centers + beach walk). */
export type DestinationRow = Destination & {
  stayAreas: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    blurb: string;
    isPrimary: boolean;
  }>;
};

/** Approved destinations with all stay areas — matching searches hotels across them. */
export async function listApprovedDestinations(): Promise<DestinationRow[]> {
  return prisma.destination.findMany({
    where: { profileStatus: ProfileStatus.APPROVED },
    include: {
      stayAreas: {
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      },
    },
  });
}

const WINNER_TTL_MS = 24 * 60 * 60 * 1000;
const PRICE_TTL_MS = 60 * 60 * 1000;

export type CacheKey = {
  homeAirport: string;
  departDate: Date;
  returnDate: Date;
  travelers: number;
  slot: string;
};

/** Serializable cache row used by the matching engine (and tests). */
export type SlotMatchCacheRow = {
  homeAirport: string;
  departDate: Date;
  returnDate: Date;
  travelers: number;
  slot: string;
  destinationId: string;
  city: string;
  country: string;
  airportCode: string;
  flightOfferId: string;
  hotelRateId: string;
  flightJson: Flight;
  hotelJson: Hotel;
  subtotalCents: number;
  winnerExpiresAt: Date;
  priceExpiresAt: Date;
};

export type SlotMatchCacheStore = {
  find(key: CacheKey): Promise<SlotMatchCacheRow | null>;
  upsert(row: SlotMatchCacheRow): Promise<SlotMatchCacheRow>;
  expireWinner(key: CacheKey, at: Date): Promise<void>;
};

export type MatchingDeps = {
  flightSupplier?: FlightSupplier;
  hotelSupplier?: HotelSupplier;
  listDestinations: () => Promise<DestinationRow[]>;
  assemblyFeeRate?: number;
  /** Injected for tests; defaults to Prisma-backed store. */
  cacheStore?: SlotMatchCacheStore;
  /** Clock override for tests. */
  now?: () => Date;
};

export const ALL_SLOTS: DestinationSlot[] = [
  "BUDGET_GETAWAY",
  "BEACH_ESCAPE",
  "EXOTIC_ADVENTURE",
];

/** Parallel supplier calls per phase — keep low to avoid rate limits. */
const CONCURRENCY = 2;
/** After flight prices, only hotel-quote the cheapest N routes. */
const HOTEL_SHORTLIST = 3;

function monthIndex(isoDate: string): number {
  return Number(isoDate.slice(5, 7)) - 1;
}

function primaryStay(d: DestinationRow) {
  return d.stayAreas.find((s) => s.isPrimary) ?? d.stayAreas[0] ?? null;
}

function cityCoords(d: DestinationRow): { lat: number; lng: number } {
  const stay = primaryStay(d);
  if (stay) return { lat: stay.lat, lng: stay.lng };
  // APPROVED destinations should always have a primary StayArea.
  console.warn(
    `[matching] ${d.airportCode} missing primary StayArea — hotel search at 0,0`,
  );
  return { lat: 0, lng: 0 };
}

function milesBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  return haversineMeters(aLat, aLng, bLat, bLng) / 1609.34;
}

/** Soft floor so origin≈destination (and e.g. Chicago→Milwaukee) never wins. */
const MIN_DESTINATION_DISTANCE_MILES = Number(
  process.env.MIN_DESTINATION_DISTANCE_MILES ?? 250,
);

function isWarmBeach(d: DestinationRow, departDate: string): boolean {
  if (!hasVibe(d.vibeTags, "BEACH") && !d.isBeach) return false;
  const temps = d.avgTempByMonthC as number[] | null;
  if (!temps || temps.length < 12) {
    return hasVibe(d.vibeTags, "BEACH") || d.isBeach;
  }
  const t = temps[monthIndex(departDate)];
  return t != null && t >= WARM_TEMP_C;
}

function candidatesForSlot(
  slot: DestinationSlot,
  all: DestinationRow[],
  departDate: string,
  homeAirport: string,
): DestinationRow[] {
  let pool: DestinationRow[];
  if (slot === "BUDGET_GETAWAY") {
    // Prefer non-beach cities; exotic shortlist cities that aren't beach-first still ok.
    const budgetCandidates = all.filter(
      (d) => !hasVibe(d.vibeTags, "BEACH") && !d.isBeach,
    );
    pool = budgetCandidates.length ? budgetCandidates : all;
  } else if (slot === "BEACH_ESCAPE") {
    const beachPool = all.filter((d) => isWarmBeach(d, departDate));
    pool = beachPool.length
      ? beachPool
      : all.filter((d) => hasVibe(d.vibeTags, "BEACH") || d.isBeach);
  } else {
    const exoticPool = all.filter(
      (d) => hasVibe(d.vibeTags, "EXOTIC") || d.isExoticShortlist,
    );
    pool = exoticPool.length ? exoticPool : all;
  }

  const origin = all.find(
    (d) => d.airportCode.toUpperCase() === homeAirport.toUpperCase(),
  );
  if (
    origin?.airportLat == null ||
    origin?.airportLng == null ||
    !Number.isFinite(origin.airportLat) ||
    !Number.isFinite(origin.airportLng)
  ) {
    return pool;
  }

  const farEnough = pool.filter((d) => {
    if (d.airportCode.toUpperCase() === homeAirport.toUpperCase()) {
      return false;
    }
    if (d.airportLat == null || d.airportLng == null) return true;
    return (
      milesBetween(
        origin.airportLat!,
        origin.airportLng!,
        d.airportLat,
        d.airportLng,
      ) >= MIN_DESTINATION_DISTANCE_MILES
    );
  });

  // Same empty-pool fallback as other slot filters.
  return farEnough.length ? farEnough : pool;
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

export function feesFromSubtotal(
  subtotalCents: number,
  assemblyFeeRate: number,
): { assemblyFeeCents: number; totalCents: number } {
  const assemblyFeeCents = Math.round(subtotalCents * assemblyFeeRate);
  return { assemblyFeeCents, totalCents: subtotalCents + assemblyFeeCents };
}

function feeFromDeps(deps: MatchingDeps): number {
  return clampAssemblyFeeRate(
    deps.assemblyFeeRate ??
      Number(process.env.ASSEMBLY_FEE_RATE ?? ASSEMBLY_FEE_DEFAULT),
  );
}

function cacheKeyFromRequest(
  slot: DestinationSlot,
  req: TripSearchRequest,
): CacheKey {
  return {
    homeAirport: req.homeAirport,
    departDate: new Date(req.departDate),
    returnDate: new Date(req.returnDate),
    travelers: req.travelers,
    slot,
  };
}

function parseCacheJson(row: {
  flightJson: unknown;
  hotelJson: unknown;
}): { flight: Flight; hotel: Hotel } {
  return {
    flight: FlightSchema.parse(row.flightJson),
    hotel: HotelSchema.parse(row.hotelJson),
  };
}

export function assemblePackage(
  slot: DestinationSlot,
  cache: SlotMatchCacheRow,
  assemblyFeeRate: number,
): DestinationPackage {
  const { flight, hotel } = parseCacheJson(cache);
  const { assemblyFeeCents, totalCents } = feesFromSubtotal(
    cache.subtotalCents,
    assemblyFeeRate,
  );
  return {
    id: `pkg_cache_${slot}_${cache.destinationId}`,
    slot,
    rank: 0,
    city: cache.city,
    country: cache.country,
    airportCode: cache.airportCode,
    destinationId: cache.destinationId,
    flight,
    hotel,
    itinerary: [],
    subtotalCents: cache.subtotalCents,
    assemblyFeeCents,
    totalCents,
    currency: "USD",
    images: [],
  };
}

function rowFromPackage(
  key: CacheKey,
  pkg: DestinationPackage,
  now: Date,
): SlotMatchCacheRow {
  return {
    ...key,
    destinationId: pkg.destinationId,
    city: pkg.city,
    country: pkg.country,
    airportCode: pkg.airportCode,
    flightOfferId: pkg.flight.duffelOfferId,
    hotelRateId: pkg.hotel.hotelRateId,
    flightJson: pkg.flight,
    hotelJson: pkg.hotel,
    subtotalCents: pkg.subtotalCents,
    winnerExpiresAt: new Date(now.getTime() + WINNER_TTL_MS),
    priceExpiresAt: new Date(now.getTime() + PRICE_TTL_MS),
  };
}

function prismaCacheStore(): SlotMatchCacheStore {
  return {
    async find(key) {
      const row = await prisma.slotMatchCache.findUnique({
        where: {
          homeAirport_departDate_returnDate_travelers_slot: key,
        },
      });
      if (!row) return null;
      const parsed = parseCacheJson(row);
      return {
        homeAirport: row.homeAirport,
        departDate: row.departDate,
        returnDate: row.returnDate,
        travelers: row.travelers,
        slot: row.slot,
        destinationId: row.destinationId,
        city: row.city,
        country: row.country,
        airportCode: row.airportCode,
        flightOfferId: row.flightOfferId,
        hotelRateId: row.hotelRateId,
        flightJson: parsed.flight,
        hotelJson: parsed.hotel,
        subtotalCents: row.subtotalCents,
        winnerExpiresAt: row.winnerExpiresAt,
        priceExpiresAt: row.priceExpiresAt,
      };
    },
    async upsert(data) {
      const row = await prisma.slotMatchCache.upsert({
        where: {
          homeAirport_departDate_returnDate_travelers_slot: {
            homeAirport: data.homeAirport,
            departDate: data.departDate,
            returnDate: data.returnDate,
            travelers: data.travelers,
            slot: data.slot,
          },
        },
        create: {
          homeAirport: data.homeAirport,
          departDate: data.departDate,
          returnDate: data.returnDate,
          travelers: data.travelers,
          slot: data.slot,
          destinationId: data.destinationId,
          city: data.city,
          country: data.country,
          airportCode: data.airportCode,
          flightOfferId: data.flightOfferId,
          hotelRateId: data.hotelRateId,
          flightJson: data.flightJson,
          hotelJson: data.hotelJson,
          subtotalCents: data.subtotalCents,
          winnerExpiresAt: data.winnerExpiresAt,
          priceExpiresAt: data.priceExpiresAt,
        },
        update: {
          destinationId: data.destinationId,
          city: data.city,
          country: data.country,
          airportCode: data.airportCode,
          flightOfferId: data.flightOfferId,
          hotelRateId: data.hotelRateId,
          flightJson: data.flightJson,
          hotelJson: data.hotelJson,
          subtotalCents: data.subtotalCents,
          winnerExpiresAt: data.winnerExpiresAt,
          priceExpiresAt: data.priceExpiresAt,
        },
      });
      const parsed = parseCacheJson(row);
      return {
        ...data,
        flightJson: parsed.flight,
        hotelJson: parsed.hotel,
        winnerExpiresAt: row.winnerExpiresAt,
        priceExpiresAt: row.priceExpiresAt,
      };
    },
    async expireWinner(key, at) {
      await prisma.slotMatchCache.update({
        where: {
          homeAirport_departDate_returnDate_travelers_slot: key,
        },
        data: { winnerExpiresAt: at },
      });
    },
  };
}

type PricedPackage = Omit<DestinationPackage, "itinerary" | "rank"> & {
  itinerary: [];
};

function hotelNearestStayAdjustedCents(
  hotel: Hotel,
  stayAreas: DestinationRow["stayAreas"],
): number {
  if (stayAreas.length === 0) return hotel.totalCents;
  let minDist = Infinity;
  for (const s of stayAreas) {
    minDist = Math.min(
      minDist,
      haversineMeters(hotel.lat, hotel.lng, s.lat, s.lng),
    );
  }
  const score = hotelDistanceScore(minDist);
  return Math.round(
    hotel.totalCents * (1 + HOTEL_DISTANCE_WEIGHT * (1 - score)),
  );
}

async function priceWithFlight(
  slot: DestinationSlot,
  dest: DestinationRow,
  flight: Flight,
  req: TripSearchRequest,
  hotelSupplier: HotelSupplier,
  assemblyFeeRate: number,
): Promise<PricedPackage | null> {
  const areas = dest.stayAreas.slice(0, MAX_STAY_AREAS);
  const searchCenters: Array<{ lat: number; lng: number; name: string }> =
    areas.length > 0
      ? areas.map((a) => ({ lat: a.lat, lng: a.lng, name: a.name }))
      : [
          {
            lat: cityCoords(dest).lat,
            lng: cityCoords(dest).lng,
            name: "center",
          },
        ];

  const radiusKm = slot === "BEACH_ESCAPE" ? 3 : 8;
  const areaResults = await mapPool(searchCenters, CONCURRENCY, async (area) => {
    try {
      return await hotelSupplier.searchStays({
        latitude: area.lat,
        longitude: area.lng,
        radiusKm,
        checkIn: req.departDate,
        checkOut: req.returnDate,
        guests: req.travelers,
        minStars: 3,
      });
    } catch (err) {
      console.warn(
        `[matching] ${slot} ${dest.airportCode} hotel search @ ${area.name}:`,
        err instanceof Error ? err.message : err,
      );
      return [] as Hotel[];
    }
  });

  const byRate = new Map<string, Hotel>();
  for (const list of areaResults) {
    for (const h of list) {
      const key = h.hotelRateId || `${h.name}:${h.lat}:${h.lng}`;
      const prev = byRate.get(key);
      if (!prev || h.totalCents < prev.totalCents) byRate.set(key, h);
    }
  }
  const stays = [...byRate.values()];

  let hotel = stays[0];
  if (slot === "BEACH_ESCAPE") {
    const beachCenters = areas.length ? areas : [];
    if (beachCenters.length === 0) return null;
    hotel =
      stays.find((h) =>
        beachCenters.some((s) => {
          const dist = haversineMeters(h.lat, h.lng, s.lat, s.lng);
          h.distanceToBeachMeters = Math.round(
            Math.min(h.distanceToBeachMeters ?? dist, dist),
          );
          return dist <= BEACH_WALK_METERS;
        }),
      ) ?? undefined;
  } else if (stays.length > 0) {
    // Soft prefer hotels nearer any stay-area core — never excludes, only nudges.
    const scored = stays
      .map((h) => ({
        h,
        adjusted: hotelNearestStayAdjustedCents(h, areas),
      }))
      .sort((a, b) => a.adjusted - b.adjusted);
    const pick = scored[0]!;
    hotel = pick.h;
    if (stays[0] && pick.h.hotelRateId !== stays[0].hotelRateId) {
      console.info(
        `[matching] ${slot} ${dest.airportCode}: hotel multi-area pick ` +
          `raw $${(stays[0].totalCents / 100).toFixed(0)} → ` +
          `pick $${(pick.h.totalCents / 100).toFixed(0)} ` +
          `(adj $${(pick.adjusted / 100).toFixed(0)}; ${areas.length} areas)`,
      );
    }
  }
  if (!hotel) return null;

  const subtotalCents = flight.totalCents + hotel.totalCents;
  const { assemblyFeeCents, totalCents } = feesFromSubtotal(
    subtotalCents,
    assemblyFeeRate,
  );

  return {
    id: `pkg_tmp_${slot}_${dest.id}`,
    slot,
    city: dest.city,
    country: dest.country,
    airportCode: dest.airportCode,
    destinationId: dest.id,
    flight,
    hotel,
    itinerary: [],
    subtotalCents,
    assemblyFeeCents,
    totalCents,
    currency: "USD",
    images: [],
  };
}

/**
 * Full candidate scan: quote flights for all candidates, hotel-quote the
 * cheapest shortlist, return a single cheapest complete package.
 */
async function pickCheapestPackage(
  slot: DestinationSlot,
  candidates: DestinationRow[],
  req: TripSearchRequest,
  flightSupplier: FlightSupplier,
  hotelSupplier: HotelSupplier,
  assemblyFeeRate: number,
): Promise<DestinationPackage | null> {
  if (candidates.length === 0) return null;

  const t0 = Date.now();

  const flightQuotes = await mapPool(
    candidates,
    CONCURRENCY,
    async (dest) => {
      try {
        const flights = await flightSupplier.searchFlights({
          origin: req.homeAirport,
          destination: dest.airportCode,
          departDate: req.departDate,
          returnDate: req.returnDate,
          passengers: req.travelers,
          // Budget Getaway: nonstop only (Duffel max_connections: 0).
          ...(slot === "BUDGET_GETAWAY" ? { maxConnections: 0 } : {}),
        });
        // Soft prefer well-timed departures among offers to this destination.
        // Cross-destination ranking still uses raw totalCents below.
        const ranked = flights
          .map((f) => ({ f, adjusted: flightTimingAdjustedCents(f) }))
          .sort((a, b) => a.adjusted - b.adjusted);
        const best = ranked[0];
        if (!best) return null;
        if (
          flights[0] &&
          best.f.duffelOfferId !== flights[0].duffelOfferId
        ) {
          console.info(
            `[matching] ${slot} ${dest.airportCode}: flight timing override ` +
              `raw $${(flights[0].totalCents / 100).toFixed(0)} → ` +
              `pick $${(best.f.totalCents / 100).toFixed(0)} ` +
              `(adj $${(best.adjusted / 100).toFixed(0)})`,
          );
        }
        return { dest, flight: best.f };
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
        hotelSupplier,
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
  return { ...best, rank: 0, itinerary: [] };
}

/** Full-scan match (no cache). Used by the cache layer on Tier-1 miss / self-heal. */
export async function matchSlotPackage(
  slot: DestinationSlot,
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage> {
  const flightSupplier = deps.flightSupplier ?? createFlightSupplier();
  const hotelSupplier = deps.hotelSupplier ?? createHotelSupplier();
  const fee = feeFromDeps(deps);
  const all = await deps.listDestinations();

  const pkg = await pickCheapestPackage(
    slot,
    candidatesForSlot(slot, all, req.departDate, req.homeAirport),
    req,
    flightSupplier,
    hotelSupplier,
    fee,
  );

  if (!pkg) {
    throw new Error(`No valid offers found for ${slot}`);
  }
  return pkg;
}

async function scanAndCache(
  slot: DestinationSlot,
  req: TripSearchRequest,
  deps: MatchingDeps,
  store: SlotMatchCacheStore,
  key: CacheKey,
  now: Date,
): Promise<DestinationPackage> {
  const pkg = await matchSlotPackage(slot, req, deps);
  await store.upsert(rowFromPackage(key, pkg, now));
  console.info(`[matching] ${slot}: cache write (full scan)`);
  return pkg;
}

/**
 * Two-tier cache-aside: ~24h winner destination, ~1h price freshness via
 * revalidate. Self-heals once if offers expired.
 */
export async function getSlotPackageCached(
  slot: DestinationSlot,
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage> {
  const store = deps.cacheStore ?? prismaCacheStore();
  const now = deps.now?.() ?? new Date();
  const key = cacheKeyFromRequest(slot, req);
  const fee = feeFromDeps(deps);

  let cache = await store.find(key);

  // Tier 1 miss: no winner or winner stale → full scan once.
  if (!cache || cache.winnerExpiresAt < now) {
    console.info(
      `[matching] ${slot}: tier1 miss${cache ? " (winner expired)" : ""}`,
    );
    return scanAndCache(slot, req, deps, store, key, now);
  }

  // Tier 1 hit, Tier 2 fresh: zero supplier calls.
  if (cache.priceExpiresAt >= now) {
    console.info(`[matching] ${slot}: tier2 hit (serve cached price)`);
    return assemblePackage(slot, cache, fee);
  }

  // Tier 1 hit, Tier 2 stale: revalidate this offer/rate only.
  console.info(`[matching] ${slot}: tier2 stale → revalidate`);
  const flightSupplier = deps.flightSupplier ?? createFlightSupplier();
  const hotelSupplier = deps.hotelSupplier ?? createHotelSupplier();
  const [flight, hotel] = await Promise.all([
    flightSupplier.revalidateFlightOffer(cache.flightOfferId),
    hotelSupplier.revalidateStayRate(cache.hotelRateId),
  ]);

  if (!flight || !hotel) {
    console.warn(
      `[matching] ${slot}: revalidate failed — forcing full rescan`,
    );
    await store.expireWinner(key, now);
    return scanAndCache(slot, req, deps, store, key, now);
  }

  const subtotalCents = flight.totalCents + hotel.totalCents;

  const refreshed: SlotMatchCacheRow = {
    ...cache,
    flightOfferId: flight.duffelOfferId,
    hotelRateId: hotel.hotelRateId,
    flightJson: flight,
    hotelJson: hotel,
    subtotalCents,
    priceExpiresAt: new Date(now.getTime() + PRICE_TTL_MS),
    // Keep winner TTL as-is so we don't extend the destination choice.
  };
  await store.upsert(refreshed);
  return assemblePackage(slot, refreshed, fee);
}

/** @deprecated Prefer getSlotPackageCached. */
export async function matchSlotPackages(
  slot: DestinationSlot,
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage[]> {
  return [await getSlotPackageCached(slot, req, deps)];
}

export async function matchThreePackages(
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage[]> {
  const settled = await Promise.allSettled(
    ALL_SLOTS.map((slot) => getSlotPackageCached(slot, req, deps)),
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

/** In-memory cache store for unit tests. */
export function createMemoryCacheStore(): SlotMatchCacheStore {
  const map = new Map<string, SlotMatchCacheRow>();
  const k = (key: CacheKey) =>
    `${key.homeAirport}|${key.departDate.toISOString().slice(0, 10)}|${key.returnDate.toISOString().slice(0, 10)}|${key.travelers}|${key.slot}`;

  return {
    async find(key) {
      return map.get(k(key)) ?? null;
    },
    async upsert(row) {
      const copy = structuredClone(row);
      map.set(k(row), copy);
      return copy;
    },
    async expireWinner(key, at) {
      const existing = map.get(k(key));
      if (existing) {
        existing.winnerExpiresAt = at;
        map.set(k(key), existing);
      }
    },
  };
}
