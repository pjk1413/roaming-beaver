import type { Flight, FlightLeg } from "@mystery-trips/types";
import type {
  CreateFlightOrderParams,
  FlightSearchParams,
  FlightSupplier,
} from "../travel/types";

const DUFFEL_BASE = "https://api.duffel.com";

type DuffelJson = Record<string, unknown>;

function dollarsToCents(amount: string | number): number {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  return Math.round(n * 100);
}

export class DuffelClient implements FlightSupplier {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("DUFFEL_API_KEY is required");
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
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

    const text = await res.text();
    let json: { data?: T; errors?: unknown } = {};
    if (text) {
      try {
        json = JSON.parse(text) as { data?: T; errors?: unknown };
      } catch {
        if (!res.ok) {
          throw new Error(
            `Duffel ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`,
          );
        }
        throw new Error(
          `Duffel ${method} ${path}: expected JSON, got: ${text.slice(0, 200)}`,
        );
      }
    }

    if (res.status === 429 && attempt < 3) {
      const reset = res.headers.get("ratelimit-reset");
      const resetMs = reset ? Date.parse(reset) - Date.now() : NaN;
      const waitMs = Number.isFinite(resetMs)
        ? Math.min(Math.max(resetMs, 500), 15_000)
        : 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(method, path, body, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(
        `Duffel ${method} ${path} failed (${res.status}): ${JSON.stringify(json.errors ?? json) || text.slice(0, 300)}`,
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
        ...(params.maxConnections != null
          ? { max_connections: params.maxConnections }
          : {}),
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
      if (
        params.maxConnections === 0 &&
        (outbound.length > 1 || inbound.length > 1)
      ) {
        continue;
      }
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
