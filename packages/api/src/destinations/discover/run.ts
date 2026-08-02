import { prisma, ProfileStatus } from "@mystery-trips/db";
import { createFlightSupplier } from "../../travel";
import { profileDestination } from "../profile";
import { checkAccessFromSampleOrigins } from "./access";
import { isQualityCommercialAirport } from "./airports";
import { findCandidateCities } from "./candidates";
import { dedupeAgainstExisting, type ResolvedCandidate } from "./dedup";
import { checkViability } from "./viability";

export const MAX_NEW_DESTINATIONS_PER_RUN = Number(
  process.env.MAX_NEW_DESTINATIONS_PER_RUN ?? 12,
);

export type DiscoverSummary = {
  candidatesFound: number;
  afterDedup: number;
  qualityFailed: number;
  accessFailed: number;
  viabilityFailed: number;
  created: number;
  waitlisted: number;
  profiled: number;
  profileErrors: number;
};

type Ranked = ResolvedCandidate & {
  accessPassRate: number;
  attractionCount: number;
};

/**
 * Full discovery pipeline: Stages 1–4, create DRAFT rows (capped), then Stage 5 profile.
 */
export async function runDiscoverDestinations(opts?: {
  maxNew?: number;
  skipProfile?: boolean;
}): Promise<DiscoverSummary> {
  const maxNew = opts?.maxNew ?? MAX_NEW_DESTINATIONS_PER_RUN;
  const summary: DiscoverSummary = {
    candidatesFound: 0,
    afterDedup: 0,
    qualityFailed: 0,
    accessFailed: 0,
    viabilityFailed: 0,
    created: 0,
    waitlisted: 0,
    profiled: 0,
    profileErrors: 0,
  };

  // Pull capacity overflow from last month first
  const waitlistedPrior = await prisma.discoveryWaitlist.findMany({
    orderBy: [{ attractionCount: "desc" }, { accessPassRate: "desc" }],
    take: maxNew,
  });

  console.info("[discover] Stage 1 — find candidates…");
  const found = await findCandidateCities();
  summary.candidatesFound = found.length;
  console.info(`[discover] Stage 1 found ${found.length} candidates`);

  console.info("[discover] Stage 2 — dedup…");
  const { fresh, skippedExisting, unresolved } =
    await dedupeAgainstExisting(found);
  summary.afterDedup = fresh.length;
  console.info(
    `[discover] Stage 2: ${fresh.length} fresh, ${skippedExisting.length} existing, ${unresolved.length} unresolved`,
  );

  const flightSupplier = createFlightSupplier();
  const ranked: Ranked[] = [];

  // Promote waitlist entries that still aren't destinations
  for (const w of waitlistedPrior) {
    if (!w.airportCode) continue;
    const exists = await prisma.destination.findFirst({
      where: { airportCode: w.airportCode },
    });
    if (exists) {
      await prisma.discoveryWaitlist.delete({ where: { id: w.id } });
      continue;
    }
    ranked.push({
      city: w.city,
      country: w.country,
      note: w.sourceNote ?? "waitlist",
      sourceUrl: w.sourceUrl,
      airport: {
        code: w.airportCode,
        city: w.city,
        name: w.city,
        country: w.country,
      },
      accessPassRate: w.accessPassRate ?? 0,
      attractionCount: w.attractionCount ?? 0,
    });
  }

  for (const c of fresh) {
    // Stage 2.5 — OurAirports class gate before any Duffel spend
    if (!isQualityCommercialAirport(c.airport)) {
      summary.qualityFailed += 1;
      console.info(
        `[discover] Stage 2.5 FAIL ${c.city} (${c.airport.code}) type=${c.airport.type ?? "unknown"}`,
      );
      continue;
    }

    console.info(`[discover] Stage 3 access ${c.city} (${c.airport.code})…`);
    const access = await checkAccessFromSampleOrigins(
      c.airport.code,
      flightSupplier,
    );
    if (!access.passed) {
      summary.accessFailed += 1;
      console.info(
        `[discover] access FAIL ${c.airport.code} rate=${access.passRate.toFixed(2)}`,
      );
      continue;
    }

    console.info(`[discover] Stage 4 viability ${c.city}…`);
    const viability = await checkViability(c.city, c.country);
    if (!viability.passed) {
      summary.viabilityFailed += 1;
      console.info(
        `[discover] viability FAIL ${c.city}: ${viability.reasoning}`,
      );
      continue;
    }

    ranked.push({
      ...c,
      accessPassRate: access.passRate,
      attractionCount: viability.attractionCount,
    });
  }

  ranked.sort(
    (a, b) =>
      b.attractionCount - a.attractionCount ||
      b.accessPassRate - a.accessPassRate,
  );

  const take = ranked.slice(0, maxNew);
  const overflow = ranked.slice(maxNew);

  for (const o of overflow) {
    await prisma.discoveryWaitlist.upsert({
      where: {
        city_country: { city: o.city, country: o.country },
      },
      create: {
        city: o.city,
        country: o.country,
        airportCode: o.airport.code,
        sourceNote: o.note,
        sourceUrl: o.sourceUrl ?? null,
        attractionCount: o.attractionCount,
        accessPassRate: o.accessPassRate,
      },
      update: {
        airportCode: o.airport.code,
        sourceNote: o.note,
        sourceUrl: o.sourceUrl ?? null,
        attractionCount: o.attractionCount,
        accessPassRate: o.accessPassRate,
      },
    });
    summary.waitlisted += 1;
  }

  for (const c of take) {
    const dest = await prisma.destination.create({
      data: {
        city: c.city,
        country: c.country,
        airportCode: c.airport.code,
        airportLat: c.airport.lat ?? null,
        airportLng: c.airport.lng ?? null,
        notes: c.note,
        profileStatus: ProfileStatus.DRAFT,
      },
    });
    summary.created += 1;

    // Remove from waitlist if it was promoted
    await prisma.discoveryWaitlist
      .deleteMany({
        where: { city: c.city, country: c.country },
      })
      .catch(() => undefined);

    if (opts?.skipProfile) continue;

    try {
      console.info(`[discover] Stage 5 profile ${c.city}…`);
      await profileDestination(dest.id);
      summary.profiled += 1;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      summary.profileErrors += 1;
      console.error(
        `[discover] profile failed ${c.city}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.info("[discover] summary", summary);
  return summary;
}
