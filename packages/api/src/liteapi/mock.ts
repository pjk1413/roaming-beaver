import type { Hotel } from "@mystery-trips/types";
import type {
  CreateStayBookingParams,
  HotelSupplier,
  StaySearchParams,
} from "../travel/types";

/** Deterministic sandbox hotels when LITEAPI_API_KEY is unset. */
export class LiteApiMockSupplier implements HotelSupplier {
  async searchStays(params: StaySearchParams): Promise<Hotel[]> {
    const seed = hash(`${params.latitude}-${params.longitude}-${params.checkIn}`);
    const stars = params.minStars ?? 3;
    return [
      {
        hotelRateId: `rate_mock_${seed}`,
        hotelSearchResultId: `hotel_mock_${seed}`,
        name: `Mystery ${Math.round(stars)}★ Stay`,
        starRating: Math.round(stars),
        address: "Near city center",
        lat: params.latitude + 0.002,
        lng: params.longitude + 0.002,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        currency: "USD",
        totalCents: 9000 + (seed % 12000) * params.guests,
      },
    ];
  }

  async revalidateStayRate(rateId: string): Promise<Hotel | null> {
    return {
      hotelRateId: rateId,
      name: "Mystery 3★ Stay",
      starRating: 3,
      address: "Near beach",
      lat: 0,
      lng: 0,
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
      currency: "USD",
      totalCents: 12000,
    };
  }

  async createStayBooking(_params: CreateStayBookingParams) {
    return { id: `htb_mock_${Date.now()}` };
  }

  async cancelStayBooking(_bookingId: string): Promise<void> {
    // no-op in mock
  }
}

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}
