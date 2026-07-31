export type Airport = {
  code: string;
  city: string;
  name: string;
  country: string;
  icao?: string;
};

export function formatAirport(a: Airport): string {
  return `${a.code} — ${a.city}`;
}

export function formatAirportDetail(a: Airport): string {
  return `${a.name} · ${a.country}`;
}

export async function searchAirportsClient(
  query: string,
  signal?: AbortSignal,
): Promise<Airport[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetch(
    `/api/airports/search?q=${encodeURIComponent(q)}`,
    { signal },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { airports: Airport[] };
  return data.airports ?? [];
}

export async function fetchAirportByCode(
  code: string,
  signal?: AbortSignal,
): Promise<Airport | null> {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  const res = await fetch(
    `/api/airports/search?code=${encodeURIComponent(c)}`,
    { signal },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { airports: Airport[] };
  return data.airports?.[0] ?? null;
}
