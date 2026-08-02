import { z } from "zod";
import OpenAI from "openai";
import { openaiChatModel, openaiTemperature } from "../../openai-params";
import { webSearchBundle } from "../web-search";

export const VIABILITY_MIN_ATTRACTIONS = Number(
  process.env.DISCOVER_MIN_ATTRACTIONS ?? 6,
);

const JudgmentSchema = z.object({
  viable: z.boolean(),
  attractionCount: z.number().int().nonnegative(),
  reasoning: z.string().min(5),
});

export type ViabilityResult = z.infer<typeof JudgmentSchema> & {
  passed: boolean;
  researchSnippets: string[];
};

const globalForOpenAI = globalThis as unknown as { openai?: OpenAI };

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY required for viability check");
  if (!globalForOpenAI.openai) {
    globalForOpenAI.openai = new OpenAI({ apiKey: key });
  }
  return globalForOpenAI.openai;
}

async function fetchSnippet(query: string): Promise<string | null> {
  const text = await webSearchBundle(query, { maxResults: 4 });
  return text.length > 40 ? text : null;
}

async function wikiSnippet(city: string, country: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(`${city}, ${country}`)}`,
      { headers: { "User-Agent": "MysteryTrips/1.0 (discover-viability)" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { extract?: string };
    return json.extract ?? null;
  } catch {
    return null;
  }
}

/**
 * Stage 4 — cheap "enough to do" gate before full profile research.
 */
export async function checkViability(
  city: string,
  country: string,
  opts?: { minAttractions?: number },
): Promise<ViabilityResult> {
  const min = opts?.minAttractions ?? VIABILITY_MIN_ATTRACTIONS;
  const snippets: string[] = [];

  const [things, nightlife, wiki] = await Promise.all([
    fetchSnippet(`things to do in ${city} ${country}`),
    fetchSnippet(`${city} ${country} nightlife OR food scene tourist`),
    wikiSnippet(city, country),
  ]);
  if (things) snippets.push(things);
  if (nightlife) snippets.push(nightlife);
  if (wiki) snippets.push(wiki);

  const research =
    snippets.join("\n\n---\n\n") ||
    `No search snippets. City: ${city}, ${country}.`;

  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: openaiChatModel(),
    response_format: { type: "json_object" },
    ...openaiTemperature(0.2),
    messages: [
      {
        role: "system",
        content:
          "You judge whether a city has enough distinct tourist attractions/venues for a short leisure trip. JSON only.",
      },
      {
        role: "user",
        content: `City: ${city}, ${country}

Research snippets:
${research}

Count genuinely distinct named attractions, neighborhoods with things to do, or venues a tourist would visit (not generic categories). Respond JSON:
{"viable":true|false,"attractionCount":N,"reasoning":"one line"}

viable should be true only if attractionCount >= ${min}.`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JudgmentSchema.parse(
    JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim()),
  );

  return {
    ...parsed,
    passed: parsed.viable && parsed.attractionCount >= min,
    researchSnippets: snippets,
  };
}

/** Pure helper for unit tests — apply min without calling APIs. */
export function viabilityPasses(
  attractionCount: number,
  min = VIABILITY_MIN_ATTRACTIONS,
): boolean {
  return attractionCount >= min;
}
