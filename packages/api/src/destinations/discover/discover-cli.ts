/**
 * Cloud Run Job entry: monthly destination discovery.
 *
 *   pnpm discover-destinations
 *   pnpm discover-destinations -- --skip-profile
 *   pnpm discover-destinations -- --max 5
 */
import { prisma } from "@mystery-trips/db";
import { runDiscoverDestinations } from "./run";

async function main() {
  const args = process.argv.slice(2);
  const skipProfile = args.includes("--skip-profile");
  const maxIdx = args.indexOf("--max");
  const maxNew =
    maxIdx >= 0 ? Number(args[maxIdx + 1]) : undefined;

  const summary = await runDiscoverDestinations({
    skipProfile,
    maxNew: Number.isFinite(maxNew) ? maxNew : undefined,
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
