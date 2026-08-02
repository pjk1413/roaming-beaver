/**
 * Destination photo gallery — Wikipedia/Wikimedia first, Unsplash fill if keyed.
 * Soft-fails: never throws for upstream outages.
 */

export const MAX_DESTINATION_IMAGES = Number(
  process.env.MAX_DESTINATION_IMAGES ?? 8,
);

const UA =
  "MysteryTrips/1.0 (destination-images; contact=ops@mysterytrips.app)";

export type DestinationImageDraft = {
  url: string;
  thumbUrl?: string | null;
  attribution?: string | null;
  source: "wikipedia" | "wikimedia" | "unsplash";
  sourcePageUrl?: string | null;
  kind: "hero" | "gallery";
  caption?: string | null;
  sortOrder: number;
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function looksLikeJunkTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.endsWith(".svg") ||
    t.includes("icon") ||
    t.includes("logo") ||
    t.includes("map of") ||
    t.includes("locator") ||
    t.includes("flag of") ||
    t.includes("coat of arms") ||
    t.includes("symbol")
  );
}

async function fetchWikipediaHero(
  city: string,
  country: string,
): Promise<DestinationImageDraft | null> {
  try {
    const titles = [`${city}`, `${city}, ${country}`];
    for (const title of titles) {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { "User-Agent": UA, Accept: "application/json" } },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        title?: string;
        originalimage?: { source?: string };
        thumbnail?: { source?: string };
        content_urls?: { desktop?: { page?: string } };
        description?: string;
      };
      const url = json.originalimage?.source ?? json.thumbnail?.source;
      if (!url) continue;
      return {
        url,
        thumbUrl: json.thumbnail?.source ?? null,
        attribution: "Wikipedia",
        source: "wikipedia",
        sourcePageUrl: json.content_urls?.desktop?.page ?? null,
        kind: "hero",
        caption: json.description ?? json.title ?? city,
        sortOrder: 0,
      };
    }
  } catch (err) {
    console.warn(
      "[images] Wikipedia hero failed:",
      err instanceof Error ? err.message : err,
    );
  }
  return null;
}

async function fetchCommonsSearch(
  query: string,
  limit: number,
): Promise<DestinationImageDraft[]> {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrsearch: `filetype:bitmap ${query}`,
      gsrlimit: String(Math.min(limit, 10)),
      gsrnamespace: "6",
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata|size",
      iiurlwidth: "1600",
    });
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              thumburl?: string;
              mime?: string;
              extmetadata?: Record<
                string,
                { value?: string } | undefined
              >;
            }>;
          }
        >;
      };
    };
    const out: DestinationImageDraft[] = [];
    for (const page of Object.values(json.query?.pages ?? {})) {
      const title = page.title ?? "";
      if (looksLikeJunkTitle(title)) continue;
      const info = page.imageinfo?.[0];
      if (!info?.url) continue;
      const mime = (info.mime ?? "").toLowerCase();
      if (mime && !mime.startsWith("image/")) continue;
      if (mime.includes("svg")) continue;

      const meta = info.extmetadata ?? {};
      const artist = stripHtml(meta.Artist?.value ?? "");
      const license = stripHtml(meta.LicenseShortName?.value ?? "");
      const attribution = [artist || "Wikimedia Commons", license]
        .filter(Boolean)
        .join(" / ");
      const caption = stripHtml(meta.ObjectName?.value ?? title.replace(/^File:/, ""));

      out.push({
        url: info.url,
        thumbUrl: info.thumburl ?? null,
        attribution,
        source: "wikimedia",
        sourcePageUrl: title
          ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
          : null,
        kind: "gallery",
        caption: caption || null,
        sortOrder: 0,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[images] Commons search failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function fetchUnsplashFill(
  queries: string[],
  needed: number,
): Promise<DestinationImageDraft[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key || needed <= 0) return [];

  const out: DestinationImageDraft[] = [];
  for (const q of queries) {
    if (out.length >= needed) break;
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?${new URLSearchParams({
          query: q,
          per_page: String(Math.min(needed - out.length + 2, 8)),
          orientation: "landscape",
          content_filter: "high",
        })}`,
        {
          headers: {
            Authorization: `Client-ID ${key}`,
            "Accept-Version": "v1",
            "User-Agent": UA,
          },
        },
      );
      if (!res.ok) {
        console.warn(`[images] Unsplash ${res.status} for "${q}"`);
        continue;
      }
      const json = (await res.json()) as {
        results?: Array<{
          urls?: { regular?: string; small?: string; full?: string };
          user?: { name?: string; links?: { html?: string } };
          links?: { html?: string };
          alt_description?: string | null;
          description?: string | null;
        }>;
      };
      for (const photo of json.results ?? []) {
        if (out.length >= needed) break;
        const url = photo.urls?.regular ?? photo.urls?.full;
        if (!url) continue;
        const name = photo.user?.name ?? "Unsplash";
        out.push({
          url,
          thumbUrl: photo.urls?.small ?? null,
          attribution: `Photo: ${name} / Unsplash`,
          source: "unsplash",
          sourcePageUrl: photo.links?.html ?? photo.user?.links?.html ?? null,
          kind: "gallery",
          caption: photo.alt_description ?? photo.description ?? null,
          sortOrder: 0,
        });
      }
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.warn(
        "[images] Unsplash failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return out;
}

function dedupeByUrl(images: DestinationImageDraft[]): DestinationImageDraft[] {
  const seen = new Set<string>();
  const out: DestinationImageDraft[] = [];
  for (const img of images) {
    const key = img.url.split("?")[0]!;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
  }
  return out;
}

export type ImageFetchContext = {
  city: string;
  country: string;
  stayAreaNames?: string[];
  activityNames?: string[];
};

/**
 * Build a destination gallery: Wikipedia/Commons first, Unsplash fill if keyed.
 */
export async function fetchDestinationImages(
  ctx: ImageFetchContext,
): Promise<DestinationImageDraft[]> {
  const cap = Math.max(1, MAX_DESTINATION_IMAGES);
  const collected: DestinationImageDraft[] = [];

  const hero = await fetchWikipediaHero(ctx.city, ctx.country);
  if (hero) collected.push(hero);

  const queries = [
    `${ctx.city} ${ctx.country}`,
    ...((ctx.stayAreaNames ?? []).slice(0, 3).map((n) => `${n} ${ctx.city}`)),
    ...((ctx.activityNames ?? []).slice(0, 3).map((n) => `${n} ${ctx.city}`)),
  ];

  for (const q of queries) {
    if (collected.length >= cap) break;
    const hits = await fetchCommonsSearch(q, cap - collected.length + 2);
    collected.push(...hits);
    await new Promise((r) => setTimeout(r, 250));
  }

  let ordered = dedupeByUrl(collected).slice(0, cap);

  if (ordered.length < cap) {
    const unsplashQueries = [
      `${ctx.city} ${ctx.country} travel`,
      `${ctx.city} skyline`,
      ...(ctx.stayAreaNames ?? []).slice(0, 2).map((n) => `${n} ${ctx.city}`),
    ];
    const fill = await fetchUnsplashFill(
      unsplashQueries,
      cap - ordered.length,
    );
    ordered = dedupeByUrl([...ordered, ...fill]).slice(0, cap);
  }

  // Exactly one hero: keep Wikipedia hero if present, else promote first.
  let heroIdx = ordered.findIndex((i) => i.kind === "hero");
  if (heroIdx < 0) heroIdx = 0;

  return ordered.map((img, i) => ({
    ...img,
    kind: (i === heroIdx ? "hero" : "gallery") as "hero" | "gallery",
    sortOrder: i === heroIdx ? 0 : i + (i < heroIdx ? 1 : 0),
  }));
}
