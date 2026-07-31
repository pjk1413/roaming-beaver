import type { Destination } from "@mystery-trips/db";
import {
  clampAssemblyFeeRate,
  ASSEMBLY_FEE_DEFAULT,
  type DestinationPackage,
  type DestinationSlot,
  type TripSearchRequest,
} from "@mystery-trips/types";
import { createTravelSupplier, type TravelSupplier } from "../duffel";
import { generateItinerary } from "../itinerary/generate";
import { BEACH_WALK_METERS, WARM_TEMP_C, haversineMeters } from "./geo";

type DestinationRow = Destination;

export type MatchingDeps = {
  supplier?: TravelSupplier;
  listDestinations: () => Promise<DestinationRow[]>;
  assemblyFeeRate?: number;
};

export const ALL_SLOTS: DestinationSlot[] = [
  "BUDGET_GETAWAY",
  "BEACH_ESCAPE",
  "EXOTIC_ADVENTURE",
];

function monthIndex(isoDate: string): number {
  return Number(isoDate.slice(5, 7)) - 1;
}

function tripNights(departDate: string, returnDate: string): number {
  const a = new Date(departDate);
  const b = new Date(returnDate);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
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
): DestinationRow[] {
  if (slot === "BUDGET_GETAWAY") {
    const budgetCandidates = all.filter(
      (d) => !d.isBeach || d.isExoticShortlist === false,
    );
    return budgetCandidates.length ? budgetCandidates : all;
  }
  if (slot === "BEACH_ESCAPE") {
    const beachPool = all.filter((d) => isWarmBeach(d, departDate));
    return beachPool.length ? beachPool : all.filter((d) => d.isBeach);
  }
  const exoticPool = all.filter((d) => d.isExoticShortlist);
  return exoticPool.length ? exoticPool : all;
}

async function assembleForDestination(
  slot: DestinationSlot,
  dest: DestinationRow,
  req: TripSearchRequest,
  supplier: TravelSupplier,
  assemblyFeeRate: number,
): Promise<DestinationPackage | null> {
  const coords = cityCoords(dest);

  const [flights, stays] = await Promise.all([
    supplier.searchFlights({
      origin: req.homeAirport,
      destination: dest.airportCode,
      departDate: req.departDate,
      returnDate: req.returnDate,
      passengers: req.travelers,
    }),
    supplier.searchStays({
      latitude: coords.lat,
      longitude: coords.lng,
      radiusKm: slot === "BEACH_ESCAPE" ? 3 : 8,
      checkIn: req.departDate,
      checkOut: req.returnDate,
      guests: req.travelers,
      minStars: 2.5,
      maxStars: 3.5,
    }),
  ]);

  const flight = flights[0];
  if (!flight) return null;

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

  const nights = tripNights(req.departDate, req.returnDate);
  const itinerary = await generateItinerary({
    city: dest.city,
    country: dest.country,
    nights,
    notes: dest.notes,
    slot,
  });

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
    itinerary,
    subtotalCents,
    assemblyFeeCents,
    totalCents,
    currency: "USD",
  };
}

async function pickCheapest(
  slot: DestinationSlot,
  candidates: DestinationRow[],
  req: TripSearchRequest,
  supplier: TravelSupplier,
  assemblyFeeRate: number,
): Promise<DestinationPackage | null> {
  const BATCH = 4;
  const results: DestinationPackage[] = [];

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const assembled = await Promise.all(
      batch.map((d) =>
        assembleForDestination(slot, d, req, supplier, assemblyFeeRate).catch(
          (err) => {
            console.warn(
              `[matching] ${slot} failed for ${d.airportCode}:`,
              err instanceof Error ? err.message : err,
            );
            return null;
          },
        ),
      ),
    );
    for (const pkg of assembled) {
      if (pkg) results.push(pkg);
    }
  }

  results.sort((a, b) => a.totalCents - b.totalCents);
  return results[0] ?? null;
}

function feeFromDeps(deps: MatchingDeps): number {
  return clampAssemblyFeeRate(
    deps.assemblyFeeRate ??
      Number(process.env.ASSEMBLY_FEE_RATE ?? ASSEMBLY_FEE_DEFAULT),
  );
}

/** Match a single slot — used by the streaming search path. */
export async function matchSlotPackage(
  slot: DestinationSlot,
  req: TripSearchRequest,
  deps: MatchingDeps,
): Promise<DestinationPackage> {
  const supplier = deps.supplier ?? createTravelSupplier();
  const fee = feeFromDeps(deps);
  const all = await deps.listDestinations();
  let pkg = await pickCheapest(
    slot,
    candidatesForSlot(slot, all, req.departDate),
    req,
    supplier,
    fee,
  );
  if (!pkg) {
    pkg = await pickCheapest(slot, all, req, supplier, fee);
  }
  if (!pkg) {
    throw new Error(`No valid offers found for ${slot}`);
  }
  return pkg;
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
