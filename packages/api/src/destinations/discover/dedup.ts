import { prisma } from "@mystery-trips/db";
import { resolveNearestAirport, type AirportGeo } from "./airports";
import type { DiscoveredCandidate } from "./candidates";

export type ResolvedCandidate = DiscoveredCandidate & {
  airport: AirportGeo;
};

/**
 * Stage 2 — resolve each candidate to a commercial airport, drop duplicates
 * of existing Destination.airportCode (and within this batch).
 */
export async function dedupeAgainstExisting(
  candidates: DiscoveredCandidate[],
): Promise<{
  fresh: ResolvedCandidate[];
  skippedExisting: string[];
  unresolved: string[];
}> {
  const existing = await prisma.destination.findMany({
    select: { airportCode: true, city: true },
  });
  const existingCodes = new Set(
    existing.map((d) => d.airportCode.toUpperCase()),
  );

  const fresh: ResolvedCandidate[] = [];
  const skippedExisting: string[] = [];
  const unresolved: string[] = [];
  const batchCodes = new Set<string>();

  for (const c of candidates) {
    const airport = resolveNearestAirport(c.city, c.country);
    if (!airport) {
      unresolved.push(`${c.city}, ${c.country}`);
      continue;
    }
    const code = airport.code.toUpperCase();
    if (existingCodes.has(code) || batchCodes.has(code)) {
      skippedExisting.push(`${c.city} → ${code}`);
      continue;
    }
    batchCodes.add(code);
    fresh.push({ ...c, airport });
  }

  return { fresh, skippedExisting, unresolved };
}
