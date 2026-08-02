import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Flight, Hotel } from "@mystery-trips/types";
import {
  FLIGHT_TIME_WEIGHT,
  HOTEL_DISTANCE_WEIGHT,
  HOTEL_IDEAL_METERS,
  HOTEL_MAX_METERS,
  flightTimingAdjustedCents,
  hotelDistanceAdjustedCents,
  hotelDistanceScore,
  hourOfDay,
  outboundTimeScore,
  returnTimeScore,
} from "./scoring";

describe("hourOfDay", () => {
  it("reads wall-clock hour from ISO without depending on server TZ", () => {
    assert.equal(hourOfDay("2026-09-10T08:00:00"), 8);
    assert.equal(hourOfDay("2026-09-10T15:30:00"), 15.5);
  });
});

describe("outboundTimeScore", () => {
  it("scores 8am highest among morning options", () => {
    const eight = outboundTimeScore(8);
    const ten = outboundTimeScore(10);
    const noon = outboundTimeScore(12);
    const evening = outboundTimeScore(18);
    assert.equal(eight, 1);
    assert.ok(eight > ten);
    assert.ok(ten > noon);
    assert.ok(noon > evening);
  });

  it("treats 8am and 10am as close, not night-and-day", () => {
    const delta = outboundTimeScore(8) - outboundTimeScore(10);
    assert.ok(delta > 0 && delta < 0.2);
  });
});

describe("returnTimeScore", () => {
  it("scores 3–4pm ideal", () => {
    assert.equal(returnTimeScore(15), 1);
    assert.equal(returnTimeScore(15.5), 1);
    assert.equal(returnTimeScore(16), 1);
  });

  it("penalizes early morning returns more than late afternoon", () => {
    assert.ok(returnTimeScore(17) > returnTimeScore(9));
    assert.ok(returnTimeScore(14) > returnTimeScore(10));
  });
});

describe("flightTimingAdjustedCents", () => {
  function flightAt(outHour: string, retHour: string, totalCents: number): Flight {
    return {
      duffelOfferId: "off_test",
      currency: "USD",
      totalCents,
      outbound: [
        {
          airline: "MT",
          flightNumber: "MT1",
          origin: "STL",
          destination: "AUS",
          departAt: `2026-09-10T${outHour}:00`,
          arriveAt: `2026-09-10T${outHour}:00`,
          durationMinutes: 120,
        },
      ],
      inbound: [
        {
          airline: "MT",
          flightNumber: "MT2",
          origin: "AUS",
          destination: "STL",
          departAt: `2026-09-14T${retHour}:00`,
          arriveAt: `2026-09-14T${retHour}:00`,
          durationMinutes: 120,
        },
      ],
    };
  }

  it("does not inflate a perfectly timed flight", () => {
    const f = flightAt("08:00", "15:00", 20_000);
    assert.equal(flightTimingAdjustedCents(f), 20_000);
  });

  it("inflates a poorly timed flight up to the weight cap", () => {
    const f = flightAt("22:00", "06:00", 20_000);
    const adjusted = flightTimingAdjustedCents(f);
    assert.ok(adjusted > 20_000);
    assert.ok(adjusted <= Math.round(20_000 * (1 + FLIGHT_TIME_WEIGHT)));
  });

  it("prefers a slightly pricier well-timed flight over a cheap late one", () => {
    const cheapLate = flightAt("20:00", "07:00", 18_000);
    const dearIdeal = flightAt("08:00", "15:00", 19_500);
    assert.ok(
      flightTimingAdjustedCents(dearIdeal) <
        flightTimingAdjustedCents(cheapLate),
    );
  });
});

describe("hotelDistanceScore", () => {
  it("scores within ideal radius as 1.0", () => {
    assert.equal(hotelDistanceScore(0), 1);
    assert.equal(hotelDistanceScore(HOTEL_IDEAL_METERS), 1);
  });

  it("scores at/beyond max as 0", () => {
    assert.equal(hotelDistanceScore(HOTEL_MAX_METERS), 0);
    assert.equal(hotelDistanceScore(HOTEL_MAX_METERS + 1000), 0);
  });

  it("linearly interpolates between ideal and max", () => {
    const mid =
      HOTEL_IDEAL_METERS + (HOTEL_MAX_METERS - HOTEL_IDEAL_METERS) / 2;
    assert.ok(Math.abs(hotelDistanceScore(mid) - 0.5) < 1e-9);
  });
});

describe("hotelDistanceAdjustedCents", () => {
  const center = { lat: 30.2672, lng: -97.7431 }; // Austin downtown

  function hotelAt(
    lat: number,
    lng: number,
    totalCents: number,
  ): Hotel {
    return {
      hotelRateId: "rate_test",
      name: "Test",
      starRating: 3,
      address: "somewhere",
      lat,
      lng,
      checkIn: "2026-09-10",
      checkOut: "2026-09-14",
      currency: "USD",
      totalCents,
    };
  }

  it("does not inflate a downtown hotel", () => {
    const h = hotelAt(center.lat, center.lng, 10_000);
    assert.equal(
      hotelDistanceAdjustedCents(h, center.lat, center.lng),
      10_000,
    );
  });

  it("inflates a far-out hotel up to the weight cap", () => {
    // ~10km north of downtown — past HOTEL_MAX_METERS
    const h = hotelAt(center.lat + 0.1, center.lng, 10_000);
    const adjusted = hotelDistanceAdjustedCents(h, center.lat, center.lng);
    assert.equal(
      adjusted,
      Math.round(10_000 * (1 + HOTEL_DISTANCE_WEIGHT)),
    );
  });
});
