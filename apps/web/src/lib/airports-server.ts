import { readFileSync } from "node:fs";
import path from "node:path";

export type Airport = {
  code: string;
  city: string;
  name: string;
  country: string;
  icao?: string;
};

const globalForAirports = globalThis as unknown as {
  airportIndex?: Airport[];
};

function loadAirports(): Airport[] {
  if (globalForAirports.airportIndex) return globalForAirports.airportIndex;
  const candidates = [
    path.join(process.cwd(), "data/airports.json"),
    path.join(process.cwd(), "apps/web/data/airports.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Airport[];
      globalForAirports.airportIndex = raw;
      return raw;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Airport index missing. Run: node scripts/sync-airports.mjs",
  );
}

export function formatAirport(a: Airport): string {
  return `${a.code} — ${a.city}`;
}

export function formatAirportDetail(a: Airport): string {
  return `${a.name} · ${a.country}`;
}

export function findAirportByCode(code: string): Airport | undefined {
  const c = code.trim().toUpperCase();
  return loadAirports().find((a) => a.code === c);
}

export function findAirportByIcao(icao: string): Airport | undefined {
  const c = icao.trim().toUpperCase();
  return loadAirports().find((a) => a.icao === c);
}

/** Ranked search: exact IATA > IATA prefix > city prefix > name/country. */
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: Array<{ airport: Airport; score: number }> = [];

  for (const a of loadAirports()) {
    const code = a.code.toLowerCase();
    const city = a.city.toLowerCase();
    const name = a.name.toLowerCase();
    const country = a.country.toLowerCase();
    const icao = (a.icao ?? "").toLowerCase();
    let score = -1;

    if (code === q || icao === q) score = 100;
    else if (code.startsWith(q) || icao.startsWith(q)) score = 90;
    else if (city.startsWith(q)) score = 80;
    else if (city.includes(q)) score = 70;
    else if (name.includes(q) || country.includes(q)) score = 50;

    if (score >= 0) scored.push({ airport: a, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.airport.city.localeCompare(b.airport.city),
    )
    .slice(0, limit)
    .map((s) => s.airport);
}

/**
 * Optional AirportDB lookup by ICAO.
 * @see https://airportdb.io/ — only endpoint is /airport/{ICAO}
 */
export async function lookupAirportDb(
  icao: string,
): Promise<Airport | null> {
  const token = process.env.AIRPORTDB_API_TOKEN?.trim();
  if (!token) return null;

  const code = icao.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;

  const url = `https://airportdb.io/api/v1/airport/${code}?apiToken=${encodeURIComponent(token)}`;
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;
  const nested =
    data.data && typeof data.data === "object"
      ? (data.data as Record<string, unknown>)
      : data;

  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = nested[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };

  const iata = str("iata_code", "iata", "iataCode").toUpperCase();
  const name = str("name", "airport_name", "airportName") || code;
  const city = str("municipality", "city", "town") || name;
  const country = str(
    "iso_country",
    "country_code",
    "countryCode",
    "country",
  );

  if (!iata || iata.length !== 3) return null;

  return { code: iata, city, name, country, icao: code };
}

export async function resolveAirportQuery(
  query: string,
  limit = 8,
): Promise<Airport[]> {
  const local = searchAirports(query, limit);
  if (local.length > 0) return local;

  const q = query.trim().toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(q)) {
    const fromIndex = findAirportByIcao(q);
    if (fromIndex) return [fromIndex];
    const remote = await lookupAirportDb(q);
    if (remote) return [remote];
  }
  return [];
}
