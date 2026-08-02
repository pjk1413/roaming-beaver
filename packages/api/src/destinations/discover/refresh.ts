import { prisma, ProfileStatus } from "@mystery-trips/db";
import { profileDestination } from "../profile";

const REFRESH_AFTER_MS = Number(
  process.env.PROFILE_REFRESH_AFTER_DAYS ?? 90,
) * 86_400_000;

/**
 * Re-profile APPROVED destinations older than ~3 months.
 * Each becomes PENDING_REVIEW (offline until admin re-approves).
 */
export async function runRefreshDestinationProfiles(opts?: {
  limit?: number;
}): Promise<{ refreshed: number; errors: number; skipped: number }> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_MS);
  const stale = await prisma.destination.findMany({
    where: {
      profileStatus: ProfileStatus.APPROVED,
      OR: [{ profiledAt: null }, { profiledAt: { lt: cutoff } }],
    },
    orderBy: { profiledAt: "asc" },
    take: opts?.limit ?? 50,
  });

  let refreshed = 0;
  let errors = 0;
  const skipped = 0;

  console.info(
    `[refresh] ${stale.length} APPROVED destination(s) older than cutoff ${cutoff.toISOString()} (vibe tags merge on re-profile)`,
  );

  for (const d of stale) {
    try {
      console.info(`[refresh] ${d.city} (${d.airportCode})…`);
      await profileDestination(d.id);
      refreshed += 1;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      errors += 1;
      console.error(
        `[refresh] failed ${d.city}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.info("[refresh] summary", { refreshed, errors, skipped });
  return { refreshed, errors, skipped };
}
