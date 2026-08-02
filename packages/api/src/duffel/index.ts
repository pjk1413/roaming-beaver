import { DuffelClient } from "./client";
import { MockTravelSupplier } from "./mock";
import type { FlightSupplier } from "../travel/types";

const globalForSupplier = globalThis as unknown as {
  flightSupplier: FlightSupplier | undefined;
};

function isMockKey(key: string | undefined): boolean {
  return !key || key === "test" || key.startsWith("mock");
}

/** Lazy-initialized Duffel (or mock) flight client — safe under Cloud Run scale-to-zero. */
export function createFlightSupplier(): FlightSupplier {
  const key = process.env.DUFFEL_API_KEY?.trim();
  const existing = globalForSupplier.flightSupplier;

  if (existing) {
    const expectMock = isMockKey(key);
    const ok =
      (expectMock && existing instanceof MockTravelSupplier) ||
      (!expectMock && existing instanceof DuffelClient);
    if (ok) return existing;
  }

  let supplier: FlightSupplier;

  if (isMockKey(key)) {
    supplier = new MockTravelSupplier();
    console.info("[duffel] Using MockTravelSupplier (no real DUFFEL_API_KEY)");
  } else {
    supplier = new DuffelClient(key!);
    console.info("[duffel] Using DuffelClient (live flights)");
  }

  globalForSupplier.flightSupplier = supplier;
  return supplier;
}

/** @deprecated Use createFlightSupplier — kept for gradual call-site migration. */
export function createTravelSupplier(): FlightSupplier {
  return createFlightSupplier();
}

export function isMockFlightSupplier(): boolean {
  return isMockKey(process.env.DUFFEL_API_KEY?.trim());
}

/** @deprecated Use isMockFlightSupplier / isMockHotelSupplier. */
export function isMockTravelSupplier(): boolean {
  return isMockFlightSupplier();
}

export { DuffelClient } from "./client";
export { MockTravelSupplier } from "./mock";
export type {
  FlightSearchParams,
  CreateFlightOrderParams,
  FlightSupplier,
} from "../travel/types";
