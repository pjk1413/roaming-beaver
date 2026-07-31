import { DuffelClient } from "./client";
import { HybridTravelSupplier } from "./hybrid";
import { MockTravelSupplier } from "./mock";
import type { TravelSupplier } from "./types";

const globalForSupplier = globalThis as unknown as {
  travelSupplier: TravelSupplier | undefined;
};

function isMockKey(key: string | undefined): boolean {
  return !key || key === "test" || key.startsWith("mock");
}

/** Lazy-initialized Duffel (or mock) client — safe under Cloud Run scale-to-zero. */
export function createTravelSupplier(): TravelSupplier {
  const key = process.env.DUFFEL_API_KEY?.trim();
  const existing = globalForSupplier.travelSupplier;

  if (existing) {
    const expectMock = isMockKey(key);
    const ok =
      (expectMock && existing instanceof MockTravelSupplier) ||
      (!expectMock && existing instanceof HybridTravelSupplier);
    if (ok) return existing;
  }

  let supplier: TravelSupplier;

  if (isMockKey(key)) {
    supplier = new MockTravelSupplier();
    console.info("[duffel] Using MockTravelSupplier (no real DUFFEL_API_KEY)");
  } else {
    // Stays/Cars often aren't enabled on test tokens — hybrid falls back to mock.
    supplier = new HybridTravelSupplier(
      new DuffelClient(key!),
      new MockTravelSupplier(),
    );
    console.info(
      "[duffel] Using HybridTravelSupplier (live flights; mock stays/cars if not enabled)",
    );
  }

  globalForSupplier.travelSupplier = supplier;
  return supplier;
}

/** True when offers may include synthetic hotel/car (or fully mock supplier). */
export function isMockTravelSupplier(): boolean {
  const key = process.env.DUFFEL_API_KEY?.trim();
  if (isMockKey(key)) return true;
  const supplier = globalForSupplier.travelSupplier;
  if (supplier instanceof HybridTravelSupplier) {
    return supplier.usesMockStays();
  }
  return false;
}

export { DuffelClient } from "./client";
export { HybridTravelSupplier } from "./hybrid";
export { MockTravelSupplier } from "./mock";
export type * from "./types";
