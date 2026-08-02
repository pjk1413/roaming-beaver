import type { FlightSupplier } from "../../travel/types";

/** Sample origins spanning US / Canada / Mexico regions — coarse access filter. */
export const ACCESS_SAMPLE_ORIGINS = [
  "LAX",
  "JFK",
  "ORD",
  "DFW",
  "ATL",
  "DEN",
  "SEA",
  "MIA",
  "YYZ",
  "MEX",
] as const;

export const ACCESS_PASS_RATE = Number(
  process.env.DISCOVER_ACCESS_PASS_RATE ?? 0.65,
);

export type AccessCheckResult = {
  airportCode: string;
  passRate: number;
  passed: boolean;
  sampleSize: number;
  reachableFrom: string[];
};

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Stage 3 — ease-of-access via live Duffel (or mock) searches.
 * Passes if ≥ ACCESS_PASS_RATE of sample origins have a ≤1-stop round-trip.
 */
export async function checkAccessFromSampleOrigins(
  destinationAirport: string,
  flightSupplier: FlightSupplier,
  opts?: {
    origins?: readonly string[];
    passRate?: number;
    passengers?: number;
  },
): Promise<AccessCheckResult> {
  const origins = (opts?.origins ?? ACCESS_SAMPLE_ORIGINS).filter(
    (o) => o !== destinationAirport.toUpperCase(),
  );
  const threshold = opts?.passRate ?? ACCESS_PASS_RATE;
  const departDate = isoDateOffset(45);
  const returnDate = isoDateOffset(50);
  const reachableFrom: string[] = [];

  for (const origin of origins) {
    try {
      const flights = await flightSupplier.searchFlights({
        origin,
        destination: destinationAirport.toUpperCase(),
        departDate,
        returnDate,
        passengers: opts?.passengers ?? 1,
        maxConnections: 1,
      });
      if (flights.length > 0) reachableFrom.push(origin);
    } catch (err) {
      console.warn(
        `[discover:access] ${origin}→${destinationAirport} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const passRate =
    origins.length === 0 ? 0 : reachableFrom.length / origins.length;
  return {
    airportCode: destinationAirport.toUpperCase(),
    passRate,
    passed: passRate >= threshold,
    sampleSize: origins.length,
    reachableFrom,
  };
}
