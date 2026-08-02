/**
 * Live web search for destination research.
 * Prefer Tavily (real results) when TAVILY_API_KEY is set; fall back to
 * DuckDuckGo Instant Answer (often sparse for "where to stay" queries).
 */

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  provider: "tavily" | "duckduckgo";
};

const UA = "MysteryTrips/1.0 (web-search)";

export function hasTavilySearch(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

async function searchTavily(
  query: string,
  maxResults: number,
): Promise<WebSearchHit[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      include_answer: false,
      include_images: false,
      max_results: maxResults,
      // Travel blogs / guides tend to be English; keep default topic general.
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[web-search] Tavily ${res.status}: ${body.slice(0, 200)}`);
    return [];
  }

  const json = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;
  };

  return (json.results ?? [])
    .filter((r) => r.url && (r.content || r.title))
    .map((r) => ({
      title: (r.title ?? "").trim() || r.url!,
      url: r.url!,
      snippet: (r.content ?? "").trim().slice(0, 800),
      provider: "tavily" as const,
    }));
}

/** DuckDuckGo Instant Answer — weak for neighborhood queries; last resort. */
async function searchDuckDuckGo(query: string): Promise<WebSearchHit[]> {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?${new URLSearchParams({
        q: query,
        format: "json",
        no_html: "1",
        skip_disambig: "1",
      })}`,
      { headers: { "User-Agent": UA } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const hits: WebSearchHit[] = [];
    if (json.AbstractText) {
      hits.push({
        title: json.Heading || query,
        url: json.AbstractURL || "https://duckduckgo.com/",
        snippet: json.AbstractText,
        provider: "duckduckgo",
      });
    }
    for (const t of json.RelatedTopics ?? []) {
      if (!t.Text) continue;
      hits.push({
        title: t.Text.slice(0, 80),
        url: t.FirstURL || "https://duckduckgo.com/",
        snippet: t.Text,
        provider: "duckduckgo",
      });
      if (hits.length >= 6) break;
    }
    return hits;
  } catch {
    return [];
  }
}

/**
 * Search the web for a query. Tavily when keyed; otherwise DuckDuckGo Instant Answer.
 */
export async function webSearch(
  query: string,
  opts?: { maxResults?: number },
): Promise<WebSearchHit[]> {
  const maxResults = opts?.maxResults ?? 5;
  if (hasTavilySearch()) {
    try {
      const hits = await searchTavily(query, maxResults);
      if (hits.length > 0) return hits;
      console.warn(
        `[web-search] Tavily returned 0 for "${query}" — trying DuckDuckGo`,
      );
    } catch (err) {
      console.warn(
        "[web-search] Tavily failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return searchDuckDuckGo(query);
}

/** Format hits into a research chunk for the LLM. */
export function formatWebSearchHits(
  query: string,
  hits: WebSearchHit[],
): string {
  if (hits.length === 0) return "";
  const provider = hits[0]?.provider ?? "web";
  const lines = hits.map(
    (h, i) =>
      `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`,
  );
  return `Web search (${provider}) for "${query}":\n${lines.join("\n")}`;
}

export async function webSearchBundle(
  query: string,
  opts?: { maxResults?: number },
): Promise<string> {
  const hits = await webSearch(query, opts);
  return formatWebSearchHits(query, hits);
}
