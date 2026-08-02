import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Flight } from "@mystery-trips/types";
import type { FlightSupplier } from "../../travel/types";
import {
  ACCESS_PASS_RATE,
  checkAccessFromSampleOrigins,
} from "./access";
import { viabilityPasses } from "./viability";

function flightStub(origin: string, dest: string): Flight {
  return {
    duffelOfferId: `off_${origin}_${dest}`,
    currency: "USD",
    totalCents: 20000,
    outbound: [
      {
        airline: "X",
        flightNumber: "X1",
        origin,
        destination: dest,
        departAt: "2026-09-10T08:00:00",
        arriveAt: "2026-09-10T12:00:00",
        durationMinutes: 240,
      },
    ],
    inbound: [
      {
        airline: "X",
        flightNumber: "X2",
        origin: dest,
        destination: origin,
        departAt: "2026-09-14T15:00:00",
        arriveAt: "2026-09-14T20:00:00",
        durationMinutes: 240,
      },
    ],
  };
}

describe("checkAccessFromSampleOrigins", () => {
  it("passes a well-connected hub when most origins find flights", async () => {
    const supplier: FlightSupplier = {
      async searchFlights(params) {
        // Simulate unreachable from SEA only
        if (params.origin === "SEA") return [];
        return [flightStub(params.origin, params.destination)];
      },
      async revalidateFlightOffer() {
        return null;
      },
      async createFlightOrder() {
        return { id: "x" };
      },
    };

    const result = await checkAccessFromSampleOrigins("MIA", supplier, {
      origins: ["LAX", "JFK", "ORD", "SEA"],
      passRate: 0.65,
    });
    assert.equal(result.reachableFrom.length, 3);
    assert.ok(result.passRate >= 0.65);
    assert.equal(result.passed, true);
  });

  it("fails a dead-end airport with no bookable routes", async () => {
    const supplier: FlightSupplier = {
      async searchFlights() {
        return [];
      },
      async revalidateFlightOffer() {
        return null;
      },
      async createFlightOrder() {
        return { id: "x" };
      },
    };

    const result = await checkAccessFromSampleOrigins("XXX", supplier, {
      origins: ["LAX", "JFK", "ORD"],
      passRate: ACCESS_PASS_RATE,
    });
    assert.equal(result.passed, false);
    assert.equal(result.passRate, 0);
  });
});

describe("viabilityPasses", () => {
  it("requires the minimum attraction count", () => {
    assert.equal(viabilityPasses(6, 6), true);
    assert.equal(viabilityPasses(5, 6), false);
    assert.equal(viabilityPasses(12, 6), true);
  });
});
