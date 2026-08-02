/** First-draft vibe vocabulary — string array, not a Prisma enum. */
export const VIBE_TAGS = [
  "BEACH",
  "URBAN",
  "NATURE",
  "MOUNTAIN",
  "HISTORIC",
  "NIGHTLIFE",
  "FOODIE",
  "ARTS_CULTURE",
  "ROMANTIC",
  "ADVENTURE",
  "WELLNESS",
  "FAMILY_FRIENDLY",
  "EXOTIC",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

export function hasVibe(
  tags: string[] | null | undefined,
  tag: VibeTag,
): boolean {
  return (tags ?? []).includes(tag);
}

/** Keep legacy booleans in sync when writing vibeTags. */
export function legacyFlagsFromVibes(tags: string[]): {
  isBeach: boolean;
  isExoticShortlist: boolean;
} {
  return {
    isBeach: tags.includes("BEACH"),
    isExoticShortlist: tags.includes("EXOTIC"),
  };
}

export function normalizeVibeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(VIBE_TAGS);
  return [
    ...new Set(
      raw
        .map((t) => String(t).trim().toUpperCase().replace(/\s+/g, "_"))
        .filter((t) => allowed.has(t)),
    ),
  ];
}

/** Union existing + incoming (order: existing first, then new). */
export function mergeVibeTags(
  existing: string[] | null | undefined,
  incoming: unknown,
): string[] {
  return normalizeVibeTags([...(existing ?? []), ...(Array.isArray(incoming) ? incoming : [])]);
}
