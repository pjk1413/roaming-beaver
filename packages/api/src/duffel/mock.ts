import type { Flight, Hotel, RentalCar } from "@mystery-trips/types";
import type {
  CarSearchParams,
  CreateCarBookingParams,
  CreateFlightOrderParams,
  CreateStayBookingParams,
  FlightSearchParams,
  StaySearchParams,
  TravelSupplier,
} from "./types";

/** Deterministic sandbox supplier for local UI / matching-engine work without Duffel keys. */
export class MockTravelSupplier implements TravelSupplier {
  async searchFlights(params: FlightSearchParams): Promise<Flight[]> {
    const seed = hash(`${params.origin}-${params.destination}-${params.departDate}`);
    const base = 18000 + (seed % 40000);
    return [
      {
        duffelOfferId: `off_mock_${params.destination}_${seed}`,
        duffelOfferRequestId: `orq_mock_${seed}`,
        currency: "USD",
        totalCents: base * params.passengers,
        outbound: [
          {
            airline: "MT",
            flightNumber: `MT${100 + (seed % 800)}`,
            origin: params.origin,
            destination: params.destination,
            departAt: `${params.departDate}T08:30:00`,
            arriveAt: `${params.departDate}T12:10:00`,
            durationMinutes: 220,
          },
        ],
        inbound: [
          {
            airline: "MT",
            flightNumber: `MT${200 + (seed % 800)}`,
            origin: params.destination,
            destination: params.origin,
            departAt: `${params.returnDate}T16:00:00`,
            arriveAt: `${params.returnDate}T20:20:00`,
            durationMinutes: 260,
          },
        ],
      },
    ];
  }

  async searchStays(params: StaySearchParams): Promise<Hotel[]> {
    const seed = hash(`${params.latitude}-${params.longitude}-${params.checkIn}`);
    const stars = params.minStars ?? 3;
    return [
      {
        duffelRateId: `rate_mock_${seed}`,
        duffelSearchResultId: `ssr_mock_${seed}`,
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

  async searchCars(params: CarSearchParams): Promise<RentalCar[]> {
    const seed = hash(`${params.airportCode}-${params.pickUpDate}`);
    return [
      {
        duffelQuoteId: `quote_mock_${seed}`,
        vendor: "Mystery Rentals",
        vehicleName: "Compact",
        pickupLocation: params.airportCode,
        dropoffLocation: params.airportCode,
        currency: "USD",
        totalCents: 4500 + (seed % 5000),
      },
    ];
  }

  async revalidateFlightOffer(offerId: string): Promise<Flight | null> {
    return {
      duffelOfferId: offerId,
      currency: "USD",
      totalCents: 25000,
      outbound: [
        {
          airline: "MT",
          flightNumber: "MT101",
          origin: "AAA",
          destination: "BBB",
          departAt: "2026-08-01T08:00:00",
          arriveAt: "2026-08-01T12:00:00",
          durationMinutes: 240,
        },
      ],
      inbound: [
        {
          airline: "MT",
          flightNumber: "MT202",
          origin: "BBB",
          destination: "AAA",
          departAt: "2026-08-05T16:00:00",
          arriveAt: "2026-08-05T20:00:00",
          durationMinutes: 240,
        },
      ],
    };
  }

  async revalidateStayRate(rateId: string): Promise<Hotel | null> {
    return {
      duffelRateId: rateId,
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

  async createFlightOrder(_params: CreateFlightOrderParams) {
    return { id: `flord_mock_${Date.now()}` };
  }

  async createStayBooking(_params: CreateStayBookingParams) {
    return { id: `stb_mock_${Date.now()}` };
  }

  async createCarBooking(_params: CreateCarBookingParams) {
    return { id: `crb_mock_${Date.now()}` };
  }
}

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}
