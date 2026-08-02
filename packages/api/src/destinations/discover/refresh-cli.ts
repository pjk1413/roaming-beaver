/**
 * Cloud Run Job entry: quarterly profile refresh for stale APPROVED rows.
 *
 *   pnpm refresh-destination-profiles
 *   pnpm refresh-destination-profiles -- --limit 10
 */
import { prisma } from "@mystery-trips/db";
import { runRefreshDestinationProfiles } from "./refresh";

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit =
    limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;

  const summary = await runRefreshDestinationProfiles({
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
