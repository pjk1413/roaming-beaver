import type { Hotel } from "@mystery-trips/types";
import type {
  CreateStayBookingParams,
  HotelSupplier,
  StaySearchParams,
} from "../travel/types";

const LITEAPI_SEARCH_BASE = "https://api.liteapi.travel/v3.0";
const LITEAPI_BOOK_BASE = "https://book.liteapi.travel/v3.0";

type LiteApiHotelMeta = {
  id: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  stars?: number;
  rating?: number;
};

type LiteApiRateTotal = { amount: number; currency: string };

type LiteApiRoomType = {
  offerId: string;
  rates?: Array<{
    retailRate?: {
      total?: LiteApiRateTotal[];
    };
  }>;
};

type LiteApiHotelRates = {
  hotelId: string;
  roomTypes: LiteApiRoomType[];
};

type LiteApiRatesResponse = {
  data?: LiteApiHotelRates[];
  hotels?: LiteApiHotelMeta[];
};

type LiteApiPrebookResponse = {
  data?: {
    prebookId: string;
    hotelId?: string;
    checkin?: string;
    checkout?: string;
    currency?: string;
    price?: number | { amount?: number };
    hotel?: {
      name?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      stars?: number;
    };
    roomTypes?: Array<{
      rates?: Array<{
        retailRate?: { total?: LiteApiRateTotal[] };
      }>;
    }>;
  };
};

type LiteApiBookResponse = {
  data?: {
    bookingId: string;
    status?: string;
  };
};

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

function extractTotalCents(
  roomTypes: LiteApiRoomType[] | undefined,
): { totalCents: number; currency: string } | null {
  let best: { totalCents: number; currency: string } | null = null;
  for (const rt of roomTypes ?? []) {
    for (const rate of rt.rates ?? []) {
      const total = rate.retailRate?.total?.[0];
      if (!total || typeof total.amount !== "number") continue;
      const cents = dollarsToCents(total.amount);
      if (!best || cents < best.totalCents) {
        best = { totalCents: cents, currency: total.currency || "USD" };
      }
    }
  }
  return best;
}

function starBucket(minStars?: number, maxStars?: number): number[] {
  const min = Math.max(1, Math.floor(minStars ?? 2));
  const max = Math.min(5, Math.ceil(maxStars ?? 5));
  const stars: number[] = [];
  for (let s = min; s <= max; s++) stars.push(s);
  // LiteAPI accepts half-stars; include .5 variants in the band.
  for (let s = min; s < max; s++) stars.push(s + 0.5);
  return [...new Set(stars)].sort((a, b) => a - b);
}

/**
 * Live LiteAPI (Nuitée Connect) hotel supplier.
 * Flow: POST /hotels/rates → POST /rates/prebook → POST /rates/book
 * @see https://docs.liteapi.travel/reference
 */
export class LiteApiClient implements HotelSupplier {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("LITEAPI_API_KEY is required");
    }
  }

  private async request<T>(
    base: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: T | { error?: unknown; message?: string } = {} as T;
    if (text) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        throw new Error(
          `LiteAPI ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`,
        );
      }
    }

    if (!res.ok) {
      throw new Error(
        `LiteAPI ${method} ${path} failed (${res.status}): ${JSON.stringify(json).slice(0, 400)}`,
      );
    }
    return json as T;
  }

  async searchStays(params: StaySearchParams): Promise<Hotel[]> {
    // We are merchant of record (Stripe + assembly fee); request net rates.
    const body = {
      checkin: params.checkIn,
      checkout: params.checkOut,
      currency: "USD",
      guestNationality: "US",
      occupancies: [{ adults: Math.max(1, params.guests) }],
      latitude: params.latitude,
      longitude: params.longitude,
      radius: Math.round(params.radiusKm * 1000),
      starRating: starBucket(params.minStars, params.maxStars),
      margin: 0,
      limit: 50,
      sort: [{ field: "price", direction: "ascending" }],
    };

    const json = await this.request<LiteApiRatesResponse>(
      LITEAPI_SEARCH_BASE,
      "POST",
      "/hotels/rates",
      body,
    );

    const hotelMeta = new Map(
      (json.hotels ?? []).map((h) => [h.id, h] as const),
    );

    const hotels: Hotel[] = [];
    for (const row of json.data ?? []) {
      const cheapestRoom = [...(row.roomTypes ?? [])]
        .map((rt) => {
          const priced = extractTotalCents([rt]);
          return priced ? { rt, ...priced } : null;
        })
        .filter(
          (x): x is { rt: LiteApiRoomType; totalCents: number; currency: string } =>
            x != null,
        )
        .sort((a, b) => a.totalCents - b.totalCents)[0];

      if (!cheapestRoom?.rt.offerId) continue;

      const meta = hotelMeta.get(row.hotelId);
      const stars = meta?.stars ?? meta?.rating ?? 3;
      if (params.minStars != null && stars < params.minStars) continue;
      if (params.maxStars != null && stars > params.maxStars) continue;

      hotels.push({
        hotelRateId: cheapestRoom.rt.offerId,
        hotelSearchResultId: row.hotelId,
        name: meta?.name ?? `Hotel ${row.hotelId}`,
        starRating: Math.min(5, Math.max(1, Math.round(stars))),
        address: meta?.address ?? "",
        lat: meta?.latitude ?? params.latitude,
        lng: meta?.longitude ?? params.longitude,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        currency: cheapestRoom.currency,
        totalCents: cheapestRoom.totalCents,
      });
    }

    return hotels.sort((a, b) => a.totalCents - b.totalCents);
  }

  async revalidateStayRate(rateId: string): Promise<Hotel | null> {
    try {
      const json = await this.request<LiteApiPrebookResponse>(
        LITEAPI_BOOK_BASE,
        "POST",
        "/rates/prebook",
        { offerId: rateId, usePaymentSdk: false },
      );
      const data = json.data;
      if (!data?.prebookId) return null;

      let totalCents: number | null = null;
      let currency = data.currency ?? "USD";

      if (typeof data.price === "number") {
        totalCents = dollarsToCents(data.price);
      } else if (data.price && typeof data.price.amount === "number") {
        totalCents = dollarsToCents(data.price.amount);
      } else {
        const fromRooms = extractTotalCents(data.roomTypes as LiteApiRoomType[]);
        if (fromRooms) {
          totalCents = fromRooms.totalCents;
          currency = fromRooms.currency;
        }
      }
      if (totalCents == null) return null;

      return {
        hotelRateId: rateId,
        hotelSearchResultId: data.hotelId,
        name: data.hotel?.name ?? "Hotel",
        starRating: Math.min(
          5,
          Math.max(1, Math.round(data.hotel?.stars ?? 3)),
        ),
        address: data.hotel?.address ?? "",
        lat: data.hotel?.latitude ?? 0,
        lng: data.hotel?.longitude ?? 0,
        checkIn: data.checkin ?? "",
        checkOut: data.checkout ?? "",
        currency,
        totalCents,
      };
    } catch {
      return null;
    }
  }

  async createStayBooking(params: CreateStayBookingParams) {
    // Prebook locks the rate, then book settles via the account card on file
    // (ACC_CREDIT_CARD). Sandbox accepts this without charging.
    const prebook = await this.request<LiteApiPrebookResponse>(
      LITEAPI_BOOK_BASE,
      "POST",
      "/rates/prebook",
      { offerId: params.rateId, usePaymentSdk: false },
    );
    const prebookId = prebook.data?.prebookId;
    if (!prebookId) {
      throw new Error("LiteAPI prebook did not return a prebookId");
    }

    const primary = params.guests[0]!;
    const book = await this.request<LiteApiBookResponse>(
      LITEAPI_BOOK_BASE,
      "POST",
      "/rates/book",
      {
        prebookId,
        holder: {
          firstName: primary.givenName,
          lastName: primary.familyName,
          email: params.email,
        },
        guests: params.guests.map((g) => ({
          occupancyNumber: 1,
          firstName: g.givenName,
          lastName: g.familyName,
          email: params.email,
        })),
        payment: {
          method: "ACC_CREDIT_CARD",
        },
      },
    );

    const bookingId = book.data?.bookingId;
    if (!bookingId) {
      throw new Error("LiteAPI book did not return a bookingId");
    }
    return { id: bookingId };
  }

  async cancelStayBooking(bookingId: string): Promise<void> {
    await this.request(LITEAPI_BOOK_BASE, "PUT", `/bookings/${bookingId}`, {});
  }
}
