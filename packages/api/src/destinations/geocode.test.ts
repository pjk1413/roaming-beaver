import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areaNameVariants,
  geocodeQueryCandidates,
  touristAreaAliases,
} from "./profile";

describe("areaNameVariants", () => {
  it("strips parentheticals and ampersand clauses", () => {
    const v = areaNameVariants(
      "Punta Cancun (Central Hotel Zone), Cancun",
    );
    assert.ok(v.some((x) => /Punta Cancun/i.test(x) && !x.includes("(")));
    assert.equal(v.includes("Punta Cancun"), true);
  });

  it("splits on dash", () => {
    const v = areaNameVariants(
      "Downtown Las Vegas (Fremont Street / Old Vegas) - Paradise",
    );
    assert.ok(v.some((x) => /Downtown Las Vegas/i.test(x)));
  });
});

describe("touristAreaAliases", () => {
  it("maps Cancun hotel zone phrasing to Zona Hotelera", () => {
    const a = touristAreaAliases(
      "Punta Cancún (Central Hotel Zone)",
      "Cancún",
    );
    assert.ok(a.some((x) => /Zona Hotelera/i.test(x)));
  });
});

describe("geocodeQueryCandidates", () => {
  it("puts Zona Hotelera queries early for Cancun hotel zone names", () => {
    const q = geocodeQueryCandidates(
      "La Isla & Playa Marlin (Hotel Zone pocket)",
      "Cancún",
      "Mexico",
    );
    assert.ok(q.some((x) => /Zona Hotelera/i.test(x)));
    assert.ok(q.some((x) => /La Isla/i.test(x)));
  });
});
