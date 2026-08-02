import { NextResponse } from "next/server";
import { prisma, ProfileStatus } from "@mystery-trips/db";
import type { Airport } from "@/lib/airports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Home-airport picker: APPROVED destinations only (known-cities-only).
 * Global OurAirports JSON is not used for this field.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const code = searchParams.get("code")?.trim().toUpperCase() ?? "";

  if (code) {
    const hit = await prisma.destination.findFirst({
      where: { airportCode: code, profileStatus: ProfileStatus.APPROVED },
    });
    const airports: Airport[] = hit
      ? [
          {
            code: hit.airportCode,
            city: hit.city,
            name: `${hit.city} Airport`,
            country: hit.country,
          },
        ]
      : [];
    return NextResponse.json({ airports });
  }

  if (q.length < 1) {
    return NextResponse.json({ airports: [] });
  }

  const lower = q.toLowerCase();
  const rows = await prisma.destination.findMany({
    where: {
      profileStatus: ProfileStatus.APPROVED,
      OR: [
        { airportCode: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 40,
    orderBy: { city: "asc" },
  });

  const scored = rows
    .map((d) => {
      const codeL = d.airportCode.toLowerCase();
      const cityL = d.city.toLowerCase();
      let score = 50;
      if (codeL === lower) score = 100;
      else if (codeL.startsWith(lower)) score = 90;
      else if (cityL.startsWith(lower)) score = 80;
      else if (cityL.includes(lower)) score = 70;
      return { d, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.d.city.localeCompare(b.d.city),
    )
    .slice(0, 8);

  const airports: Airport[] = scored.map(({ d }) => ({
    code: d.airportCode,
    city: d.city,
    name: `${d.city} Airport`,
    country: d.country,
  }));

  return NextResponse.json({ airports });
}
