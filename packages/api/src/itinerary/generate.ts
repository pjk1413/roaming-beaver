import OpenAI from "openai";
import {
  ItineraryItemSchema,
  type DestinationSlot,
  type ItineraryItem,
} from "@mystery-trips/types";
import { z } from "zod";
import { openaiChatModel, openaiTemperature } from "../openai-params";

const ResponseSchema = z.object({
  items: z.array(ItineraryItemSchema).min(1),
});

export type ItineraryInput = {
  city: string;
  country: string;
  nights: number;
  notes?: string | null;
  slot: DestinationSlot;
};

const globalForOpenAI = globalThis as unknown as {
  openai: OpenAI | undefined;
};

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!globalForOpenAI.openai) {
    globalForOpenAI.openai = new OpenAI({ apiKey });
  }
  return globalForOpenAI.openai;
}

export async function generateItinerary(
  input: ItineraryInput,
): Promise<ItineraryItem[]> {
  const client = getOpenAI();
  if (!client) {
    return fallbackItinerary(input);
  }

  try {
    const days = input.nights + 1;
    const completion = await client.chat.completions.create({
      model: openaiChatModel(),
      response_format: { type: "json_object" },
      ...openaiTemperature(0.7),
      messages: [
        {
          role: "system",
          content:
            "You are a travel itinerary planner. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: `Create a day-by-day travel itinerary for ${input.city}, ${input.country}.
Trip length: ${days} days (${input.nights} nights).
Package type: ${input.slot}.
Destination notes: ${input.notes ?? "none"}.

Return JSON matching:
{"items":[{"day":1,"title":"...","description":"...","timeOfDay":"morning|afternoon|evening"}]}

Rules:
- 3-5 activities per day
- Practical, enjoyable suggestions matching the package type
- No markdown fences`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const jsonText = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = ResponseSchema.parse(JSON.parse(jsonText));
    return parsed.items;
  } catch (err) {
    console.warn(
      "[itinerary] OpenAI failed, using fallback:",
      err instanceof Error ? err.message : err,
    );
    return fallbackItinerary(input);
  }
}

function fallbackItinerary(input: ItineraryInput): ItineraryItem[] {
  const days = input.nights + 1;
  const items: ItineraryItem[] = [];
  for (let day = 1; day <= days; day++) {
    items.push(
      {
        day,
        title: `Morning in ${input.city}`,
        description: `Start with coffee and a walk through a local neighborhood. ${input.notes ?? ""}`.trim(),
        timeOfDay: "morning",
      },
      {
        day,
        title: "Signature afternoon",
        description: `Explore a landmark or museum that defines ${input.city}.`,
        timeOfDay: "afternoon",
      },
      {
        day,
        title: "Evening unwind",
        description: "Dinner at a well-loved local spot, then a sunset stroll.",
        timeOfDay: "evening",
      },
    );
  }
  return items;
}
