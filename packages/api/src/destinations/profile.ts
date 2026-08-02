import { z } from "zod";
import OpenAI from "openai";
import { prisma, type Destination, ProfileStatus } from "@mystery-trips/db";
import { legacyFlagsFromVibes, mergeVibeTags, VIBE_TAGS } from "./vibes";
import { openaiChatModel, openaiTemperature } from "../openai-params";
import { haversineMeters } from "../matching/geo";
import { fetchDestinationImages } from "./images";
import { webSearchBundle, hasTavilySearch } from "./web-search";

/** Cap stay neighborhoods per destination (profile + matching hotel searches). */
export const MAX_STAY_AREAS = Number(process.env.MAX_STAY_AREAS ?? 5);

const ActivityJsonSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? o.title ?? o.place ?? "").trim();
  let description = String(
    o.description ?? o.blurb ?? o.summary ?? o.about ?? "",
  ).trim();
  if (name && description.length > 0 && description.length < 5) {
    description = `${description} — worth a visit.`;
  }
  if (name && !description) {
    description = `A notable spot near this stay area: ${name}.`;
  }
  return {
    ...o,
    name,
    description,
    category: o.category ?? null,
  };
}, z.object({
  name: z.string().min(2),
  description: z.string().min(5),
  category: z
    .enum(["food", "sight", "activity", "nightlife"])
    .optional()
    .nullable(),
}));

/** Models (esp. small ones) often omit or rename the activities array. */
function coerceActivities(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") {
    return Array.isArray(raw) ? raw : [];
  }
  if (Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  for (const key of [
    "activities",
    "thingsToDo",
    "things_to_do",
    "places",
    "pois",
    "highlights",
    "attractions",
  ]) {
    const v = o[key];
    if (Array.isArray(v) && v.length > 0) return v;
  }
  // Prefer empty activities array over undefined so Zod default can apply.
  if (Array.isArray(o.activities)) return o.activities;
  return [];
}

function normalizeStayAreaInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  const areaName =
    o.areaName ?? o.name ?? o.neighborhood ?? o.district ?? o.title;
  const blurb = o.blurb ?? o.description ?? o.summary ?? o.about;
  return {
    ...o,
    areaName,
    blurb,
    activities: coerceActivities(o),
  };
}

const StayAreaJsonSchema = z.preprocess(
  normalizeStayAreaInput,
  z.object({
    areaName: z.string().min(3),
    blurb: z.string().min(10),
    /** First / tourist-default neighborhood — hotel search primary center. */
    isPrimary: z.boolean().optional(),
    activities: z.array(ActivityJsonSchema).default([]),
  }),
);

const ProfileJsonSchema = z.object({
  vibeTags: z.array(z.string()).min(1).max(8).optional(),
  stayAreas: z
    .array(StayAreaJsonSchema)
    .min(1)
    .max(MAX_STAY_AREAS),
});

export type ProfileJson = z.infer<typeof ProfileJsonSchema>;
export type StayAreaJson = z.infer<typeof StayAreaJsonSchema>;

const globalForOpenAI = globalThis as unknown as {
  openai?: OpenAI;
};

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to profile destinations");
  }
  if (!globalForOpenAI.openai) {
    globalForOpenAI.openai = new OpenAI({ apiKey });
  }
  return globalForOpenAI.openai;
}

/** Pull travel-oriented text from Wikivoyage / Wikipedia (no API key). */
export async function researchDestination(
  city: string,
  country: string,
): Promise<string> {
  const query = `${city} ${country}`;
  const chunks: string[] = [];

  try {
    const wv = await fetch(
      `https://en.wikivoyage.org/w/api.php?${new URLSearchParams({
        action: "query",
        prop: "extracts",
        exintro: "1",
        explaintext: "1",
        redirects: "1",
        format: "json",
        titles: city,
      })}`,
      { headers: { "User-Agent": "MysteryTrips/1.0 (destination-profiler)" } },
    );
    if (wv.ok) {
      const json = (await wv.json()) as {
        query?: { pages?: Record<string, { extract?: string; title?: string }> };
      };
      const page = Object.values(json.query?.pages ?? {})[0];
      if (page?.extract && page.extract.length > 80) {
        chunks.push(`Wikivoyage (${page.title}):\n${page.extract.slice(0, 2500)}`);
      }
    }
  } catch (err) {
    console.warn("[profile] Wikivoyage fetch failed:", err);
  }

  try {
    const wiki = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "MysteryTrips/1.0 (destination-profiler)" } },
    );
    if (wiki.ok) {
      const json = (await wiki.json()) as { extract?: string; title?: string };
      if (json.extract) {
        chunks.push(`Wikipedia (${json.title}):\n${json.extract.slice(0, 1500)}`);
      }
    }
  } catch (err) {
    console.warn("[profile] Wikipedia fetch failed:", err);
  }

  // Multiple "where to stay" angles — prefer Tavily web search when keyed.
  const stayQueries = [
    `best neighborhoods to stay in ${city} ${country} tourist`,
    `where to stay in ${city} for tourists hotel districts`,
    `${city} ${country} best area for first time visitors`,
    `${city} affordable hotel neighborhood vs downtown`,
    `${city} trendy historic nightlife neighborhood stay`,
  ];
  if (hasTavilySearch()) {
    console.info(`[profile] Web search via Tavily (${stayQueries.length} queries)`);
  } else {
    console.info(
      "[profile] TAVILY_API_KEY unset — using DuckDuckGo Instant Answer (often thin)",
    );
  }
  for (const q of stayQueries) {
    try {
      const block = await webSearchBundle(q, { maxResults: 5 });
      if (block.length > 40) chunks.push(block);
    } catch (err) {
      console.warn("[profile] stay-search fetch failed:", err);
    }
    await new Promise((r) => setTimeout(r, hasTavilySearch() ? 200 : 300));
  }

  if (chunks.length === 0) {
    return `Limited research available. City: ${city}, Country: ${country}. Use widely known tourist neighborhoods.`;
  }
  return chunks.join("\n\n---\n\n");
}

export async function synthesizeProfile(
  city: string,
  country: string,
  research: string,
  existingVibeTags: string[] = [],
): Promise<ProfileJson> {
  const client = getOpenAI();
  const existingNote =
    existingVibeTags.length > 0
      ? `\nExisting vibe tags on this destination (keep any that still apply; ADD any new ones from the set that feel clearly relevant — do not drop good existing tags just to make room): ${existingVibeTags.join(", ")}.`
      : "";

  const targetCount = Math.min(MAX_STAY_AREAS, 5);
  const completion = await client.chat.completions.create({
    model: openaiChatModel(),
    response_format: { type: "json_object" },
    ...openaiTemperature(0.4),
    messages: [
      {
        role: "system",
        content:
          "You research tourist stay areas. Respond with valid JSON only — no markdown.",
      },
      {
        role: "user",
        content: `Given these search results about ${city}, ${country}, identify ${targetCount} distinct, real neighborhoods or districts that are genuinely good for a tourist to stay in — walkable, near things to do, with hotel inventory.

Aim for variety across the set: e.g. classic tourist/hotel core, a more affordable adjacent district, a foodie/nightlife pocket, a quieter or scenic option — only when those are real for this city. Do not invent neighborhoods. Prefer places mentioned across sources or widely known hotel districts.

CORROBORATION RULE: Prefer neighborhoods mentioned across two or more independent sources, or explicitly described as tourist/hotel districts. A single blog's opinion should lose to a place that appears repeatedly.

For each area:
- Name it with an OpenStreetMap-friendly local name (e.g. "Zona Hotelera, Cancún", "Las Vegas Strip", "South Beach") — avoid long marketing phrases in parentheses like "Punta Cancún (Central Hotel Zone pocket)".
- Write a 2–3 sentence blurb selling why stay there.
- You MUST include an "activities" array (key name exactly "activities") with 3–6 objects: {"name","description","category"} where category is food|sight|activity|nightlife. Do not omit activities. Do not use alternate keys like thingsToDo.
- Mark exactly one area isPrimary: true (best default for a first-time visitor).

Also assign 2–5 destination-level vibe tags from this set only: ${VIBE_TAGS.join(", ")}.${existingNote}
Return vibeTags as the full recommended set (existing that still apply + any new relevant ones).

Research:
${research}

Respond only as JSON with this exact shape:
{"vibeTags":["FOODIE"],"stayAreas":[{"areaName":"...","blurb":"...","isPrimary":true,"activities":[{"name":"...","description":"...","category":"food"}]}]}`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  const jsonText = text.replace(/^```json\s*|\s*```$/g, "").trim();
  let parsed = ProfileJsonSchema.parse(JSON.parse(jsonText));

  // Ensure exactly one primary; prefer model choice, else first.
  let areas = parsed.stayAreas.slice(0, MAX_STAY_AREAS);
  const needsActivities = areas.some((a) => a.activities.length < 3);
  if (needsActivities) {
    console.info(
      `[profile] Repairing missing activities for ${city} (${areas.filter((a) => a.activities.length < 3).length} areas)…`,
    );
    areas = await repairStayAreaActivities(city, country, areas);
  }

  const primaryIdx = areas.findIndex((a) => a.isPrimary);
  const withPrimary = areas.map((a, i) => ({
    ...a,
    isPrimary: primaryIdx >= 0 ? i === primaryIdx : i === 0,
  }));

  return { ...parsed, stayAreas: withPrimary };
}

/** Second pass when the model returns stay areas without enough activities. */
async function repairStayAreaActivities(
  city: string,
  country: string,
  areas: StayAreaJson[],
): Promise<StayAreaJson[]> {
  const thin = areas.filter((a) => a.activities.length < 3);
  if (thin.length === 0) return areas;

  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: openaiChatModel(),
      response_format: { type: "json_object" },
      ...openaiTemperature(0.3),
      messages: [
        {
          role: "system",
          content:
            "You list real tourist places near neighborhoods. JSON only.",
        },
        {
          role: "user",
          content: `For each neighborhood in ${city}, ${country}, return 3–5 real named places to eat, see, or do nearby.

Neighborhoods:
${thin.map((a) => `- ${a.areaName}: ${a.blurb}`).join("\n")}

Respond exactly:
{"areas":[{"areaName":"...","activities":[{"name":"...","description":"...","category":"food|sight|activity|nightlife"}]}]}`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content ?? "";
    const jsonText = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const RepairSchema = z.object({
      areas: z.array(
        z.object({
          areaName: z.string(),
          activities: z.array(ActivityJsonSchema).default([]),
        }),
      ),
    });
    const repaired = RepairSchema.parse(JSON.parse(jsonText));
    const byName = new Map(
      repaired.areas.map((a) => [
        a.areaName.trim().toLowerCase(),
        a.activities,
      ]),
    );

    return areas.map((a) => {
      if (a.activities.length >= 3) return a;
      const found =
        byName.get(a.areaName.trim().toLowerCase()) ??
        [...byName.entries()].find(([k]) =>
          a.areaName.toLowerCase().includes(k) ||
          k.includes(a.areaName.toLowerCase().slice(0, 12)),
        )?.[1];
      if (found && found.length > 0) {
        return { ...a, activities: found.slice(0, 8) };
      }
      return a;
    });
  } catch (err) {
    console.warn(
      "[profile] Activity repair failed:",
      err instanceof Error ? err.message : err,
    );
    return areas;
  }
}

/** Nominatim geocode — never trust LLM lat/lng. */

const NOMINATIM_UA =
  "MysteryTrips/1.0 (destination-profiler; contact=ops@mysterytrips.app)";

/** Hits within this of city center are treated as "missed the neighborhood". */
const CITY_CENTER_EPS_METERS = 500;

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

/** Strip LLM flourishes into Nominatim-friendly name variants. */
export function areaNameVariants(areaName: string): string[] {
  const raw = areaName.trim();
  const out: string[] = [];
  const push = (s: string | undefined) => {
    const t = s?.replace(/\s+/g, " ").trim();
    if (t && t.length >= 3 && !out.includes(t)) out.push(t);
  };

  push(raw);
  // Drop parentheticals / brackets: "Punta Cancún (Central Hotel Zone)" → "Punta Cancún"
  const noParen = raw
    .replace(/\s*[([].*?[)\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  push(noParen);
  // Before dash / em dash: "Downtown Las Vegas - Fremont Street" → "Downtown Las Vegas"
  push(noParen.split(/\s+[—–\-|/]\s+/)[0]);
  // Before ampersand: "La Isla & Playa Marlin" → "La Isla"
  push(noParen.split(/\s*&\s*/)[0]);
  // First comma clause if the model already embedded the city
  if (noParen.includes(",")) push(noParen.split(",")[0]);

  return out;
}

/** Common tourist-area aliases when LLM uses English marketing names. */
export function touristAreaAliases(
  areaName: string,
  city: string,
): string[] {
  const n = areaName.toLowerCase();
  const c = city.trim();
  const out: string[] = [];
  const push = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };

  if (
    /hotel zone|zona hotelera|hotel strip|punta cancun|punta cancún|playa marlin|la isla/.test(
      n,
    )
  ) {
    push(`Zona Hotelera, ${c}`);
    push(`Zona Hotelera`);
  }
  if (/centro|downtown/.test(n) && /cancun|cancún/i.test(c)) {
    push(`Cancún Centro`);
    push(`Centro, Cancún`);
  }
  if (/strip|mid-?strip|paradise/.test(n) && /vegas/i.test(c)) {
    push(`Las Vegas Strip`);
    push(`The Strip, Las Vegas`);
  }
  if (/fremont|old vegas|downtown/.test(n) && /vegas/i.test(c)) {
    push(`Fremont Street, Las Vegas`);
    push(`Downtown Las Vegas`);
  }
  if (/arts district|18b|5th street/.test(n) && /vegas/i.test(c)) {
    push(`Arts District, Las Vegas`);
  }
  if (/south beach|southbeach/.test(n)) {
    push(`South Beach, Miami`);
    push(`South Beach`);
  }
  if (/waikiki/.test(n)) {
    push(`Waikiki, Honolulu`);
    push(`Waikiki`);
  }

  return out;
}

export function geocodeQueryCandidates(
  areaName: string,
  city: string,
  country: string,
): string[] {
  const variants = [
    ...touristAreaAliases(areaName, city),
    ...areaNameVariants(areaName),
  ];
  const queries: string[] = [];
  const push = (q: string) => {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length >= 3 && !queries.includes(t)) queries.push(t);
  };

  for (const v of variants) {
    // Alias strings may already include city
    if (/,/.test(v)) push(v);
    push(`${v}, ${city}, ${country}`);
    push(`${v}, ${city}`);
    push(v);
  }
  return queries;
}

async function nominatimSearch(
  q: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q,
    format: "json",
    limit: "1",
  })}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": NOMINATIM_UA,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Nominatim failed (${res.status}) for ${q}`);
  }
  const json = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = json[0];
  if (!hit) return null;
  return {
    lat: Number.parseFloat(hit.lat),
    lng: Number.parseFloat(hit.lon),
  };
}

async function geocodeCityCenter(
  city: string,
  country: string,
): Promise<{ lat: number; lng: number }> {
  const hit = await nominatimSearch(`${city}, ${country}`);
  if (!hit) {
    throw new Error(`Could not geocode city center: ${city}, ${country}`);
  }
  return hit;
}

export type GeocodeResult = {
  lat: number;
  lng: number;
  /** True when we had to use city center (or a hit indistinguishable from it). */
  fallback: boolean;
  queryUsed: string;
};

/**
 * Geocode a stay-area name with progressive simplification + tourist aliases.
 * Rejects hits that collapse to city center while better queries remain.
 */
export async function geocodeAreaName(
  areaName: string,
  city: string,
  country: string,
): Promise<GeocodeResult> {
  await new Promise((r) => setTimeout(r, 1100));
  const cityCenter = await geocodeCityCenter(city, country);
  const candidates = geocodeQueryCandidates(areaName, city, country);

  let cityish: GeocodeResult | null = null;

  for (const q of candidates) {
    await new Promise((r) => setTimeout(r, 1100));
    try {
      const hit = await nominatimSearch(q);
      if (!hit) continue;
      const dist = metersBetween(hit, cityCenter);
      if (dist > CITY_CENTER_EPS_METERS) {
        console.info(
          `[profile] Geocoded "${areaName}" via "${q}" (${dist.toFixed(0)}m from city center)`,
        );
        return { ...hit, fallback: false, queryUsed: q };
      }
      // Near city center — keep as last resort but keep trying better names
      if (!cityish) {
        cityish = { ...hit, fallback: true, queryUsed: q };
      }
    } catch (err) {
      console.warn(
        `[profile] Nominatim error for "${q}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (cityish) {
    console.warn(
      `[profile] Area geocode weak for "${areaName}" — best hit still near city center (via "${cityish.queryUsed}")`,
    );
    return cityish;
  }

  console.warn(
    `[profile] Area geocode miss for "${areaName}" — using city center`,
  );
  return {
    ...cityCenter,
    fallback: true,
    queryUsed: `${city}, ${country}`,
  };
}

/**
 * Full profile pass for one destination.
 * Writes StayArea(s) + activities and sets profileStatus = PENDING_REVIEW.
 * Replacing an APPROVED profile takes it offline until re-approved.
 */
export async function profileDestination(
  destinationId: string,
): Promise<Destination> {
  const dest = await prisma.destination.findUniqueOrThrow({
    where: { id: destinationId },
  });

  console.info(`[profile] Researching ${dest.city}, ${dest.country}…`);
  const research = await researchDestination(dest.city, dest.country);
  console.info(`[profile] Synthesizing stay areas (up to ${MAX_STAY_AREAS})…`);
  const synthesized = await synthesizeProfile(
    dest.city,
    dest.country,
    research,
    dest.vibeTags ?? [],
  );

  const geocoded: Array<StayAreaJson & { lat: number; lng: number }> = [];
  for (const area of synthesized.stayAreas) {
    console.info(`[profile] Geocoding "${area.areaName}"…`);
    const coords = await geocodeAreaName(
      area.areaName,
      dest.city,
      dest.country,
    );
    // Drop duplicate city-center collapses when we already have a better point
    const tooCloseToExisting = geocoded.some(
      (g) => metersBetween(g, coords) < 250,
    );
    if (coords.fallback && tooCloseToExisting) {
      console.warn(
        `[profile] Skipping near-duplicate fallback for "${area.areaName}" (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`,
      );
      // Still keep the area but nudge slightly so hotel search isn't identical —
      // prefer keeping with a warning; matching needs a center. Use city offset
      // only as last resort so admin can see it was weak.
    }
    if (tooCloseToExisting && !coords.fallback) {
      console.warn(
        `[profile] "${area.areaName}" geocoded very near another stay area — keeping both`,
      );
    }
    geocoded.push({
      ...area,
      lat: coords.lat,
      lng: coords.lng,
    });
  }

  const uniquePoints = new Set(
    geocoded.map((g) => `${g.lat.toFixed(3)},${g.lng.toFixed(3)}`),
  );
  if (uniquePoints.size < geocoded.length) {
    console.warn(
      `[profile] ${dest.city}: ${geocoded.length} stay areas but only ${uniquePoints.size} distinct geocode points — some areas may still be collapsed`,
    );
  }

  // Refresh/update passes append relevant tags; never drop admin- or prior-curated ones.
  const vibeTags = mergeVibeTags(dest.vibeTags, synthesized.vibeTags);
  const flags = legacyFlagsFromVibes(vibeTags);

  console.info(`[profile] Fetching destination images…`);
  let images: Awaited<ReturnType<typeof fetchDestinationImages>> = [];
  try {
    images = await fetchDestinationImages({
      city: dest.city,
      country: dest.country,
      stayAreaNames: geocoded.map((a) => a.areaName),
      activityNames: geocoded.flatMap((a) =>
        a.activities.slice(0, 2).map((x) => x.name),
      ),
    });
  } catch (err) {
    console.warn(
      "[profile] Image fetch soft-failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.destinationActivity.deleteMany({
      where: { stayArea: { destinationId: dest.id } },
    });
    await tx.stayArea.deleteMany({ where: { destinationId: dest.id } });
    await tx.destinationImage.deleteMany({ where: { destinationId: dest.id } });

    for (const area of geocoded) {
      await tx.stayArea.create({
        data: {
          destinationId: dest.id,
          name: area.areaName,
          lat: area.lat,
          lng: area.lng,
          blurb: area.blurb,
          isPrimary: area.isPrimary ?? false,
          activities: {
            create: area.activities.map((a) => ({
              name: a.name,
              description: a.description,
              category: a.category ?? null,
            })),
          },
        },
      });
    }

    if (images.length > 0) {
      await tx.destinationImage.createMany({
        data: images.map((img) => ({
          destinationId: dest.id,
          url: img.url,
          thumbUrl: img.thumbUrl ?? null,
          attribution: img.attribution ?? null,
          source: img.source,
          sourcePageUrl: img.sourcePageUrl ?? null,
          kind: img.kind,
          caption: img.caption ?? null,
          sortOrder: img.sortOrder,
        })),
      });
    }

    return tx.destination.update({
      where: { id: dest.id },
      data: {
        profileStatus: ProfileStatus.PENDING_REVIEW,
        profiledAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        vibeTags,
        isBeach: flags.isBeach,
        isExoticShortlist: flags.isExoticShortlist,
      },
    });
  });

  const names = geocoded.map((a) => a.areaName).join("; ");
  console.info(
    `[profile] ${dest.city} → PENDING_REVIEW (${geocoded.length} stay areas: ${names}; ${images.length} images)`,
  );
  return updated;
}

export async function profileAllDrafts(): Promise<number> {
  const drafts = await prisma.destination.findMany({
    where: { profileStatus: ProfileStatus.DRAFT },
    select: { id: true, city: true },
  });
  let ok = 0;
  for (const d of drafts) {
    try {
      await profileDestination(d.id);
      ok += 1;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(
        `[profile] Failed ${d.city}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return ok;
}
