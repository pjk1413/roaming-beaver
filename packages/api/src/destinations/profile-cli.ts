/**
 * Profile a destination (or all DRAFTs).
 *
 *   pnpm --filter @mystery-trips/api profile -- <destinationId>
 *   pnpm --filter @mystery-trips/api profile -- --drafts
 *   pnpm --filter @mystery-trips/api profile -- --airport AUS
 */
import { prisma } from "@mystery-trips/db";
import { profileAllDrafts, profileDestination } from "./profile";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--drafts")) {
    const n = await profileAllDrafts();
    console.log(`Profiled ${n} draft destination(s).`);
    return;
  }

  const airportIdx = args.indexOf("--airport");
  if (airportIdx >= 0) {
    const code = args[airportIdx + 1]?.trim().toUpperCase();
    if (!code) throw new Error("Usage: --airport AUS");
    const dest = await prisma.destination.findFirst({
      where: { airportCode: code },
    });
    if (!dest) throw new Error(`No destination with airport ${code}`);
    await profileDestination(dest.id);
    return;
  }

  const id = args[0];
  if (!id || id.startsWith("-")) {
    console.error(
      "Usage:\n  profile <id>\n  profile --airport AUS\n  profile --drafts",
    );
    process.exit(1);
  }
  await profileDestination(id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
