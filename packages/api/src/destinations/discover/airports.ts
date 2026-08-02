import { readFileSync } from "node:fs";
import path from "node:path";

export type AirportGeo = {
  code: string;
  city: string;
  name: string;
  country: string;
  /** OurAirports type — large_airport / medium_airport / small_airport / … */
  type?: string;
  icao?: string;
  lat?: number;
  lng?: number;
};

const NA_ISO = new Set(["US", "CA", "MX", "PR", "VI", "GU"]);

/** Airports at or above this OurAirports class pass Stage 2.5. */
const QUALITY_TYPES = new Set(["large_airport", "medium_airport"]);

let cached: AirportGeo[] | null = null;

export function loadAirportIndex(): AirportGeo[] {
  if (cached) return cached;
  const candidates = [
    path.join(process.cwd(), "apps/web/data/airports.json"),
    path.join(process.cwd(), "data/airports.json"),
    path.join(process.cwd(), "../../apps/web/data/airports.json"),
  ];
  for (const file of candidates) {
    try {
      cached = JSON.parse(readFileSync(file, "utf8")) as AirportGeo[];
      return cached;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Airport index missing. Run: node scripts/sync-airports.mjs",
  );
}

export function lookupAirportByCode(code: string): AirportGeo | undefined {
  const c = code.trim().toUpperCase();
  return loadAirportIndex().find((a) => a.code === c);
}

export function airportCoordsForCode(
  code: string,
): { lat: number; lng: number } | null {
  const a = lookupAirportByCode(code);
  if (a?.lat == null || a?.lng == null) return null;
  return { lat: a.lat, lng: a.lng };
}

/** Stage 2.5 — reject small / heliport / seaplane before Duffel calls. */
export function isQualityCommercialAirport(airport: AirportGeo): boolean {
  if (airport.type) return QUALITY_TYPES.has(airport.type);
  // Legacy index without type: keep (coords-only sync) — re-run airports:sync.
  return true;
}

export function isNorthAmericaCountry(country: string): boolean {
  const raw = country.trim();
  const upper = raw.toUpperCase();
  if (NA_ISO.has(upper)) return true;
  const c = raw.toLowerCase();
  return (
    c.includes("united states") ||
    c === "usa" ||
    c === "us" ||
    c.includes("canada") ||
    c.includes("mexico") ||
    c.includes("puerto rico")
  );
}

/** Resolve a city name to a North American commercial airport by city match. */
export function resolveNearestAirport(
  city: string,
  countryHint?: string,
): AirportGeo | null {
  const airports = loadAirportIndex().filter((a) =>
    NA_ISO.has(a.country.toUpperCase()),
  );

  const q = city.trim().toLowerCase();
  const countryQ = countryHint?.trim().toLowerCase();

  const cityHits = airports.filter((a) => {
    const cityL = a.city.toLowerCase();
    const cityMatch =
      cityL === q || cityL.startsWith(q) || cityL.includes(q);
    if (!cityMatch) return false;
    if (!countryQ) return true;
    const iso = a.country.toUpperCase();
    if (countryQ.includes("united states") || countryQ === "usa") {
      return iso === "US" || iso === "PR" || iso === "VI" || iso === "GU";
    }
    if (countryQ.includes("canada")) return iso === "CA";
    if (countryQ.includes("mexico")) return iso === "MX";
    if (countryQ.includes("puerto rico")) return iso === "PR";
    return iso.toLowerCase() === countryQ || countryQ.includes(iso.toLowerCase());
  });

  if (cityHits.length === 0) return null;
  cityHits.sort((a, b) => {
    const ae = a.city.toLowerCase() === q ? 0 : 1;
    const be = b.city.toLowerCase() === q ? 0 : 1;
    const aq = isQualityCommercialAirport(a) ? 0 : 1;
    const bq = isQualityCommercialAirport(b) ? 0 : 1;
    return aq - bq || ae - be || a.city.length - b.city.length;
  });
  return cityHits[0]!;
}
