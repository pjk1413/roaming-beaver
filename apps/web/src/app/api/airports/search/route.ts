import { NextResponse } from "next/server";
import {
  findAirportByCode,
  resolveAirportQuery,
} from "@/lib/airports-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/airports/search?q=chicago — OurAirports index (+ AirportDB ICAO fallback) */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const code = searchParams.get("code")?.trim().toUpperCase() ?? "";

  if (code) {
    const hit = findAirportByCode(code);
    return NextResponse.json({ airports: hit ? [hit] : [] });
  }

  if (q.length < 1) {
    return NextResponse.json({ airports: [] });
  }

  const airports = await resolveAirportQuery(q, 8);
  return NextResponse.json({ airports });
}
