import type { Flight, FlightLeg, Hotel, RentalCar } from "@mystery-trips/types";
import type {
  CarSearchParams,
  CreateCarBookingParams,
  CreateFlightOrderParams,
  CreateStayBookingParams,
  FlightSearchParams,
  StaySearchParams,
  TravelSupplier,
} from "./types";

const DUFFEL_BASE = "https://api.duffel.com";

type DuffelJson = Record<string, unknown>;

function dollarsToCents(amount: string | number): number {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  return Math.round(n * 100);
}

export class DuffelClient implements TravelSupplier {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("DUFFEL_API_KEY is required");
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${DUFFEL_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (!res.ok) {
      throw new Error(
        `Duffel ${method} ${path} failed (${res.status}): ${JSON.stringify(json.errors ?? json)}`,
      );
    }
    return json.data as T;
  }

  async searchFlights(params: FlightSearchParams): Promise<Flight[]> {
    const passengers = Array.from({ length: params.passengers }, () => ({
      type: "adult",
    }));

    const offerRequest = await this.request<{
      id: string;
      offers: Array<DuffelJson>;
    }>("POST", "/air/offer_requests?return_offers=true", {
      data: {
        slices: [
          {
            origin: params.origin,
            destination: params.destination,
            departure_date: params.departDate,
          },
          {
            origin: params.destination,
            destination: params.origin,
            departure_date: params.returnDate,
          },
        ],
        passengers,
        cabin_class: "economy",
      },
    });

    const offers = (offerRequest.offers ?? []) as Array<{
      id: string;
      total_amount: string;
      total_currency: string;
      slices: Array<{
        duration: string;
        segments: Array<{
          marketing_carrier: { iata_code: string; name?: string };
          marketing_carrier_flight_number: string;
          departing_at: string;
          arriving_at: string;
          origin: { iata_code: string };
          destination: { iata_code: string };
          duration: string;
        }>;
      }>;
    }>;

    const flights: Flight[] = [];
    for (const offer of offers) {
      const outbound = offer.slices[0]?.segments.map(mapSegment) ?? [];
      const inbound = offer.slices[1]?.segments.map(mapSegment) ?? [];
      if (!outbound.length || !inbound.length) continue;
      flights.push({
        duffelOfferId: offer.id,
        duffelOfferRequestId: offerRequest.id,
        currency: offer.total_currency,
        totalCents: dollarsToCents(offer.total_amount),
        outbound,
        inbound,
      });
    }
    return flights.sort((a, b) => a.totalCents - b.totalCents);
  }

  async searchStays(params: StaySearchParams): Promise<Hotel[]> {
    const search = await this.request<{
      results: Array<{
        id: string;
        accommodation: {
          name: string;
          rating?: number;
          location?: {
            geographic_coordinates?: { latitude: number; longitude: number };
            address?: { line_one?: string; city_name?: string; country_code?: string };
          };
        };
        cheapest_rate_total_amount?: string;
        cheapest_rate_currency?: string;
        rooms?: Array<{
          rates?: Array<{
            id: string;
            total_amount: string;
            total_currency: string;
          }>;
        }>;
      }>;
    }>("POST", "/stays/search", {
      data: {
        rooms: params.guests,
        guests: Array.from({ length: params.guests }, () => ({ type: "adult" })),
        check_in_date: params.checkIn,
        check_out_date: params.checkOut,
        location: {
          radius: params.radiusKm,
          geographic_coordinates: {
            latitude: params.latitude,
            longitude: params.longitude,
          },
        },
      },
    });

    const hotels: Hotel[] = [];
    for (const result of search.results ?? []) {
      const rating = result.accommodation.rating ?? 0;
      if (params.minStars != null && rating < params.minStars) continue;
      if (params.maxStars != null && rating > params.maxStars) continue;

      const rate =
        result.rooms?.flatMap((r) => r.rates ?? []).sort(
          (a, b) =>
            dollarsToCents(a.total_amount) - dollarsToCents(b.total_amount),
        )[0] ?? null;

      if (!rate) continue;
      const coords = result.accommodation.location?.geographic_coordinates;
      if (!coords) continue;

      const addr = result.accommodation.location?.address;
      hotels.push({
        duffelRateId: rate.id,
        duffelSearchResultId: result.id,
        name: result.accommodation.name,
        starRating: rating,
        address: [addr?.line_one, addr?.city_name, addr?.country_code]
          .filter(Boolean)
          .join(", "),
        lat: coords.latitude,
        lng: coords.longitude,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        currency: rate.total_currency,
        totalCents: dollarsToCents(rate.total_amount),
      });
    }

    return hotels.sort((a, b) => a.totalCents - b.totalCents);
  }

  async searchCars(params: CarSearchParams): Promise<RentalCar[]> {
    // Duffel Cars: create a search then fetch quotes
    const search = await this.request<{
      id: string;
      quotes?: Array<{
        id: string;
        total_amount: string;
        total_currency: string;
        vehicle?: { name?: string };
        supplier?: { name?: string };
        pick_up_location?: { name?: string };
        drop_off_location?: { name?: string };
      }>;
    }>("POST", "/car_rentals/searches", {
      data: {
        pick_up_location: { iata_code: params.airportCode },
        drop_off_location: { iata_code: params.airportCode },
        pick_up_date_time: `${params.pickUpDate}T10:00:00`,
        drop_off_date_time: `${params.dropOffDate}T10:00:00`,
      },
    });

    return (search.quotes ?? [])
      .map(
        (q) =>
          ({
            duffelQuoteId: q.id,
            vendor: q.supplier?.name ?? "Rental partner",
            vehicleName: q.vehicle?.name ?? "Economy car",
            pickupLocation: q.pick_up_location?.name ?? params.airportCode,
            dropoffLocation: q.drop_off_location?.name ?? params.airportCode,
            currency: q.total_currency,
            totalCents: dollarsToCents(q.total_amount),
          }) satisfies RentalCar,
      )
      .sort((a, b) => a.totalCents - b.totalCents);
  }

  async revalidateFlightOffer(offerId: string): Promise<Flight | null> {
    try {
      const offer = await this.request<{
        id: string;
        total_amount: string;
        total_currency: string;
        slices: Array<{
          segments: Array<{
            marketing_carrier: { iata_code: string };
            marketing_carrier_flight_number: string;
            departing_at: string;
            arriving_at: string;
            origin: { iata_code: string };
            destination: { iata_code: string };
            duration: string;
          }>;
        }>;
      }>("GET", `/air/offers/${offerId}`);

      const outbound = offer.slices[0]?.segments.map(mapSegment) ?? [];
      const inbound = offer.slices[1]?.segments.map(mapSegment) ?? [];
      if (!outbound.length || !inbound.length) return null;

      return {
        duffelOfferId: offer.id,
        currency: offer.total_currency,
        totalCents: dollarsToCents(offer.total_amount),
        outbound,
        inbound,
      };
    } catch {
      return null;
    }
  }

  async revalidateStayRate(rateId: string): Promise<Hotel | null> {
    try {
      const rate = await this.request<{
        id: string;
        total_amount: string;
        total_currency: string;
        accommodation?: {
          name?: string;
          rating?: number;
          location?: {
            geographic_coordinates?: { latitude: number; longitude: number };
            address?: { line_one?: string; city_name?: string };
          };
        };
      }>("GET", `/stays/rates/${rateId}`);

      const coords =
        rate.accommodation?.location?.geographic_coordinates ?? {
          latitude: 0,
          longitude: 0,
        };
      const addr = rate.accommodation?.location?.address;

      return {
        duffelRateId: rate.id,
        name: rate.accommodation?.name ?? "Hotel",
        starRating: rate.accommodation?.rating ?? 3,
        address: [addr?.line_one, addr?.city_name].filter(Boolean).join(", "),
        lat: coords.latitude,
        lng: coords.longitude,
        checkIn: "",
        checkOut: "",
        currency: rate.total_currency,
        totalCents: dollarsToCents(rate.total_amount),
      };
    } catch {
      return null;
    }
  }

  async createFlightOrder(params: CreateFlightOrderParams) {
    const order = await this.request<{ id: string }>("POST", "/air/orders", {
      data: {
        type: "instant",
        selected_offers: [params.offerId],
        payments: [
          {
            type: "balance",
            currency: "USD",
            amount: undefined, // Duffel fills from offer when using balance in some flows
          },
        ],
        passengers: params.passengers.map((p, i) => ({
          id: `pas_${i + 1}`,
          type: "adult",
          given_name: p.givenName,
          family_name: p.familyName,
          born_on: p.bornOn ?? "1990-01-01",
          email: p.email,
          phone_number: "+12025550100",
        })),
      },
    });
    return { id: order.id };
  }

  async createStayBooking(params: CreateStayBookingParams) {
    const booking = await this.request<{ id: string }>("POST", "/stays/bookings", {
      data: {
        quote_id: params.rateId,
        guests: params.guests.map((g) => ({
          given_name: g.givenName,
          family_name: g.familyName,
        })),
        email: params.email,
        phone_number: "+12025550100",
        payment: { type: "balance" },
      },
    });
    return { id: booking.id };
  }

  async createCarBooking(params: CreateCarBookingParams) {
    const booking = await this.request<{ id: string }>(
      "POST",
      "/car_rentals/bookings",
      {
        data: {
          quote_id: params.quoteId,
          drivers: params.drivers.map((d) => ({
            given_name: d.givenName,
            family_name: d.familyName,
          })),
          email: params.email,
          payment: { type: "balance" },
        },
      },
    );
    return { id: booking.id };
  }
}

function parseIsoDurationMinutes(duration: string): number {
  // PT2H30M style
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(duration);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + minutes;
}

function mapSegment(seg: {
  marketing_carrier: { iata_code: string };
  marketing_carrier_flight_number: string;
  departing_at: string;
  arriving_at: string;
  origin: { iata_code: string };
  destination: { iata_code: string };
  duration: string;
}): FlightLeg {
  return {
    airline: seg.marketing_carrier.iata_code,
    flightNumber: `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`,
    origin: seg.origin.iata_code,
    destination: seg.destination.iata_code,
    departAt: seg.departing_at,
    arriveAt: seg.arriving_at,
    durationMinutes: parseIsoDurationMinutes(seg.duration),
  };
}
