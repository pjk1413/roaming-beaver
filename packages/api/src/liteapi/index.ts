import { LiteApiClient } from "./client";
import { LiteApiMockSupplier } from "./mock";

export { LiteApiClient } from "./client";
export { LiteApiMockSupplier } from "./mock";

const globalForHotel = globalThis as unknown as {
  hotelSupplier: import("../travel/types").HotelSupplier | undefined;
};

function isMockKey(key: string | undefined): boolean {
  return !key || key === "test" || key.startsWith("mock");
}

/** Lazy-initialized LiteAPI (or mock) hotel client. */
export function createHotelSupplier() {
  const key = process.env.LITEAPI_API_KEY?.trim();
  const existing = globalForHotel.hotelSupplier;

  if (existing) {
    const expectMock = isMockKey(key);
    const ok =
      (expectMock && existing instanceof LiteApiMockSupplier) ||
      (!expectMock && existing instanceof LiteApiClient);
    if (ok) return existing;
  }

  const supplier = isMockKey(key)
    ? new LiteApiMockSupplier()
    : new LiteApiClient(key!);

  if (isMockKey(key)) {
    console.info("[liteapi] Using LiteApiMockSupplier (no real LITEAPI_API_KEY)");
  } else {
    console.info("[liteapi] Using LiteApiClient (live hotels)");
  }

  globalForHotel.hotelSupplier = supplier;
  return supplier;
}

export function isMockHotelSupplier(): boolean {
  return isMockKey(process.env.LITEAPI_API_KEY?.trim());
}
