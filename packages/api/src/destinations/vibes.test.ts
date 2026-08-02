import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeVibeTags, normalizeVibeTags } from "./vibes";

describe("mergeVibeTags", () => {
  it("keeps existing and appends new", () => {
    assert.deepEqual(mergeVibeTags(["BEACH", "URBAN"], ["FOODIE", "BEACH"]), [
      "BEACH",
      "URBAN",
      "FOODIE",
    ]);
  });

  it("normalizes casing and ignores unknown", () => {
    assert.deepEqual(mergeVibeTags([], ["beach", "NOT_A_VIBE", "exotic"]), [
      "BEACH",
      "EXOTIC",
    ]);
  });
});

describe("normalizeVibeTags", () => {
  it("dedupes", () => {
    assert.deepEqual(normalizeVibeTags(["BEACH", "beach", "URBAN"]), [
      "BEACH",
      "URBAN",
    ]);
  });
});
