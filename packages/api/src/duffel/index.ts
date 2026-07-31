import { DuffelClient } from "./client";
import { MockTravelSupplier } from "./mock";
import type { TravelSupplier } from "./types";

const globalForSupplier = globalThis as unknown as {
  travelSupplier: TravelSupplier | undefined;
};

/** Lazy-initialized Duffel (or mock) client — safe under Cloud Run scale-to-zero. */
export function createTravelSupplier(): TravelSupplier {
  if (globalForSupplier.travelSupplier) {
    return globalForSupplier.travelSupplier;
  }

  const key = process.env.DUFFEL_API_KEY?.trim();
  const supplier =
    !key || key === "test" || key.startsWith("mock")
      ? new MockTravelSupplier()
      : new DuffelClient(key);

  if (!key || key === "test" || key.startsWith("mock")) {
    console.info("[duffel] Using MockTravelSupplier (no real DUFFEL_API_KEY)");
  }

  globalForSupplier.travelSupplier = supplier;
  return supplier;
}

export { DuffelClient } from "./client";
export { MockTravelSupplier } from "./mock";
export type * from "./types";
