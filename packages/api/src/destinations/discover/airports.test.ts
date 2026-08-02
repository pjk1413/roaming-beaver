import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isQualityCommercialAirport,
  type AirportGeo,
} from "./airports";

describe("isQualityCommercialAirport", () => {
  it("accepts large and medium", () => {
    assert.equal(
      isQualityCommercialAirport({
        code: "ORD",
        city: "Chicago",
        name: "O'Hare",
        country: "US",
        type: "large_airport",
      }),
      true,
    );
    assert.equal(
      isQualityCommercialAirport({
        code: "MSN",
        city: "Madison",
        name: "Dane County",
        country: "US",
        type: "medium_airport",
      }),
      true,
    );
  });

  it("rejects small / heliport", () => {
    const small: AirportGeo = {
      code: "XXX",
      city: "Tiny",
      name: "Tiny",
      country: "US",
      type: "small_airport",
    };
    assert.equal(isQualityCommercialAirport(small), false);
    assert.equal(
      isQualityCommercialAirport({ ...small, type: "heliport" }),
      false,
    );
  });

  it("keeps legacy entries without type", () => {
    assert.equal(
      isQualityCommercialAirport({
        code: "ORD",
        city: "Chicago",
        name: "O'Hare",
        country: "US",
      }),
      true,
    );
  });
});
