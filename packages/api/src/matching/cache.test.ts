import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProfileStatus } from "@mystery-trips/db";
import type { Flight, Hotel, TripSearchRequest } from "@mystery-trips/types";
import { MockTravelSupplier } from "../duffel/mock";
import { LiteApiMockSupplier } from "../liteapi/mock";
import type { FlightSupplier, HotelSupplier } from "../travel/types";
import {
  createMemoryCacheStore,
  getSlotPackageCached,
  type DestinationRow,
} from "./engine";

const DEST: DestinationRow = {
  id: "dest_mia",
  city: "Miami",
  country: "USA",
  airportCode: "MIA",
  airportLat: 25.7959,
  airportLng: -80.287,
  isBeach: true,
  isExoticShortlist: false,
  hasGoodPublicTransit: true,
  vibeTags: ["BEACH", "URBAN"],
  avgTempByMonthC: Array.from({ length: 12 }, () => 28),
  notes: null,
  metroRank: null,
  profileStatus: ProfileStatus.APPROVED,
  profiledAt: new Date(),
  reviewedAt: new Date(),
  reviewedBy: "test",
  createdAt: new Date(),
  updatedAt: new Date(),
  stayAreas: [
    {
      id: "stay_mia",
      name: "South Beach",
      lat: 25.7907,
      lng: -80.13,
      blurb: "Beachfront Art Deco.",
      isPrimary: true,
    },
  ],
};

const REQ: TripSearchRequest = {
  homeAirport: "JFK",
  departDate: "2026-09-10",
  returnDate: "2026-09-14",
  travelers: 2,
};

function countingSuppliers(opts?: {
  revalidateFlight?: Flight | null;
  revalidateHotel?: Hotel | null;
}): {
  flightSupplier: FlightSupplier & {
    searchFlightCalls: number;
    revalidateFlightCalls: number;
  };
  hotelSupplier: HotelSupplier & { revalidateStayCalls: number };
} {
  const flightBase = new MockTravelSupplier();
  const hotelBase = new LiteApiMockSupplier();
  let searchFlightCalls = 0;
  let revalidateFlightCalls = 0;
  let revalidateStayCalls = 0;

  const flightSupplier = {
    get searchFlightCalls() {
      return searchFlightCalls;
    },
    get revalidateFlightCalls() {
      return revalidateFlightCalls;
    },
    async searchFlights(
      params: Parameters<FlightSupplier["searchFlights"]>[0],
    ) {
      searchFlightCalls += 1;
      return flightBase.searchFlights(params);
    },
    async revalidateFlightOffer(offerId: string) {
      revalidateFlightCalls += 1;
      if (opts && "revalidateFlight" in opts) return opts.revalidateFlight ?? null;
      return flightBase.revalidateFlightOffer(offerId);
    },
    createFlightOrder: flightBase.createFlightOrder.bind(flightBase),
  };

  const hotelSupplier = {
    get revalidateStayCalls() {
      return revalidateStayCalls;
    },
    searchStays: hotelBase.searchStays.bind(hotelBase),
    async revalidateStayRate(rateId: string) {
      revalidateStayCalls += 1;
      if (opts && "revalidateHotel" in opts) return opts.revalidateHotel ?? null;
      return hotelBase.revalidateStayRate(rateId);
    },
    createStayBooking: hotelBase.createStayBooking.bind(hotelBase),
    cancelStayBooking: hotelBase.cancelStayBooking.bind(hotelBase),
  };

  return { flightSupplier, hotelSupplier };
}

describe("getSlotPackageCached", () => {
  it("cold miss: full scan then caches", async () => {
    const { flightSupplier, hotelSupplier } = countingSuppliers();
    const store = createMemoryCacheStore();
    const now = new Date("2026-07-01T12:00:00Z");

    const pkg = await getSlotPackageCached("BEACH_ESCAPE", REQ, {
      flightSupplier,
      hotelSupplier,
      listDestinations: async () => [DEST],
      cacheStore: store,
      now: () => now,
      assemblyFeeRate: 0.08,
    });

    assert.equal(pkg.airportCode, "MIA");
    assert.equal(pkg.rank, 0);
    assert.ok(flightSupplier.searchFlightCalls >= 1);

    const cached = await store.find({
      homeAirport: "JFK",
      departDate: new Date("2026-09-10"),
      returnDate: new Date("2026-09-14"),
      travelers: 2,
      slot: "BEACH_ESCAPE",
    });
    assert.ok(cached);
    assert.equal(cached!.destinationId, "dest_mia");
  });

  it("tier1 hit + tier2 fresh: zero supplier calls", async () => {
    const { flightSupplier, hotelSupplier } = countingSuppliers();
    const store = createMemoryCacheStore();
    const t0 = new Date("2026-07-01T12:00:00Z");

    await getSlotPackageCached("BEACH_ESCAPE", REQ, {
      flightSupplier,
      hotelSupplier,
      listDestinations: async () => [DEST],
      cacheStore: store,
      now: () => t0,
      assemblyFeeRate: 0.08,
    });
    const afterScan = flightSupplier.searchFlightCalls;

    const pkg = await getSlotPackageCached("BEACH_ESCAPE", REQ, {
      flightSupplier,
      hotelSupplier,
      listDestinations: async () => [DEST],
      cacheStore: store,
      now: () => new Date(t0.getTime() + 5 * 60 * 1000),
      assemblyFeeRate: 0.08,
    });

    assert.equal(pkg.airportCode, "MIA");
    assert.equal(flightSupplier.searchFlightCalls, afterScan);
    assert.equal(flightSupplier.revalidateFlightCalls, 0);
    assert.equal(hotelSupplier.revalidateStayCalls, 0);
  });

  it("tier1 hit + tier2 stale: revalidates without full scan", async () => {
    const { flightSupplier, hotelSupplier } = countingSuppliers();
    const store = createMemoryCacheStore();
    const t0 = new Date("2026-07-01T12:00:00Z");

    await getSlotPackageCached("BEACH_ESCAPE", REQ, {
      flightSupplier,
      hotelSupplier,
      listDestinations: async () => [DEST],
      cacheStore: store,
      now: () => t0,
      assemblyFeeRate: 0.08,
    });
    const afterScan = flightSupplier.searchFlightCalls;

    const pkg = await getSlotPackageCached("BEACH_ESCAPE", REQ, {
      flightSupplier,
      hotelSupplier,
      listDestinations: async () => [DEST],
      cacheStore: store,
      now: () => new Date(t0.getTime() + 90 * 60 * 1000),
      assemblyFeeRate: 0.08,
    });

    assert.equal(pkg.airportCode, "MIA");
    assert.equal(flightSupplier.searchFlightCalls, afterScan);
    assert.equal(flightSupplier.revalidateFlightCalls, 1);
    assert.equal(hotelSupplier.revalidateStayCalls, 1);
  });

  it("revalidate failure forces one full rescan", async () => {
    const store = createMemoryCacheStore();
    const t0 = new Date("2026-07-01T12:00:00Z");

    const warm = countingSuppliers();
    await getSlotPackageCached("BEACH_ESCAPE", REQ, {
      flightSupplier: warm.flightSupplier,
      hotelSupplier: warm.hotelSupplier,
      listDestinations: async () => [DEST],
      cacheStore: store,
      now: () => t0,
      assemblyFeeRate: 0.08,
    });

    const { flightSupplier, hotelSupplier } = countingSuppliers({
      revalidateFlight: null,
      revalidateHotel: null,
    });

    const pkg = await getSlotPackageCached("BEACH_ESCAPE", REQ, {
      flightSupplier,
      hotelSupplier,
      listDestinations: async () => [DEST],
      cacheStore: store,
      now: () => new Date(t0.getTime() + 90 * 60 * 1000),
      assemblyFeeRate: 0.08,
    });

    assert.equal(pkg.airportCode, "MIA");
    assert.equal(flightSupplier.revalidateFlightCalls, 1);
    assert.equal(hotelSupplier.revalidateStayCalls, 1);
    assert.ok(flightSupplier.searchFlightCalls >= 1);
  });
});
