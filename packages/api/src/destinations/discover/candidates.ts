import { z } from "zod";
import OpenAI from "openai";
import { openaiChatModel, openaiTemperature } from "../../openai-params";
import { isNorthAmericaCountry } from "./airports";
import { webSearchBundle } from "../web-search";

const CandidateSchema = z.object({
  city: z.string().min(2),
  country: z.string().min(2),
  note: z.string().min(5),
  sourceUrl: z.string().optional().nullable(),
});

const ExtractSchema = z.object({
  candidates: z.array(CandidateSchema).min(1).max(40),
});

export type DiscoveredCandidate = z.infer<typeof CandidateSchema>;

const globalForOpenAI = globalThis as unknown as { openai?: OpenAI };

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY required for discovery");
  if (!globalForOpenAI.openai) {
    globalForOpenAI.openai = new OpenAI({ apiKey: key });
  }
  return globalForOpenAI.openai;
}

function discoveryQueries(year: number): string[] {
  return [
    `best places to visit North America ${year}`,
    `underrated travel destinations United States Canada Mexico ${year}`,
    `top foodie cities North America`,
    `best nightlife cities US Canada`,
    `hidden gem weekend trips North America`,
    `best beach towns to visit this year United States Mexico`,
  ];
}

/**
 * Stage 1 — find North American city candidates from rotating travel queries.
 */
export async function findCandidateCities(): Promise<DiscoveredCandidate[]> {
  const year = new Date().getUTCFullYear();
  const queries = discoveryQueries(year);
  const bundles: string[] = [];

  for (const q of queries) {
    const text = await webSearchBundle(q, { maxResults: 6 });
    if (text) bundles.push(text);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Seed from Wikipedia "Tourism in …" style summaries for major countries
  for (const page of [
    "Tourism in the United States",
    "Tourism in Canada",
    "Tourism in Mexico",
  ]) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page)}`,
        { headers: { "User-Agent": "MysteryTrips/1.0 (discover-candidates)" } },
      );
      if (res.ok) {
        const json = (await res.json()) as { extract?: string; content_urls?: { desktop?: { page?: string } } };
        if (json.extract) {
          bundles.push(
            `${page}:\n${json.extract}\n${json.content_urls?.desktop?.page ?? ""}`,
          );
        }
      }
    } catch {
      /* ignore */
    }
  }

  const research =
    bundles.join("\n\n---\n\n") ||
    "No live search results. Suggest well-known North American leisure cities.";

  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: openaiChatModel(),
    response_format: { type: "json_object" },
    ...openaiTemperature(0.5),
    messages: [
      {
        role: "system",
        content:
          "Extract North American leisure travel cities. JSON only. Prefer places with their own commercial airport.",
      },
      {
        role: "user",
        content: `From the research below, extract a deduplicated list of named cities/towns in the United States, Canada, or Mexico worth considering as short leisure trip destinations. Each needs a one-line note on why it surfaced and a source URL when available.

Only include places that typically have (or sit next to) their own commercial airport — not car-only towns like Sedona unless you name the city that actually has the airport.

Research:
${research.slice(0, 12000)}

Respond JSON:
{"candidates":[{"city":"...","country":"United States|Canada|Mexico","note":"...","sourceUrl":"https://..."}]}`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  const parsed = ExtractSchema.parse(
    JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim()),
  );

  const seen = new Set<string>();
  const out: DiscoveredCandidate[] = [];
  for (const c of parsed.candidates) {
    if (!isNorthAmericaCountry(c.country)) continue;
    const key = `${c.city.toLowerCase()}|${c.country.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
