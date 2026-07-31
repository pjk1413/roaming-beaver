import type { Flight, Hotel, RentalCar } from "@mystery-trips/types";
import type { DuffelClient } from "./client";
import type { MockTravelSupplier } from "./mock";
import type {
  CarSearchParams,
  CreateCarBookingParams,
  CreateFlightOrderParams,
  CreateStayBookingParams,
  FlightSearchParams,
  StaySearchParams,
  TravelSupplier,
} from "./types";

function isProductDisabled(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /not enabled for your account/i.test(msg) ||
    /contact sales to get access/i.test(msg) ||
    /This feature is not enabled/i.test(msg)
  );
}

/**
 * Live Duffel Flights + mock Stays/Cars when those products aren't on the account.
 * Test tokens often have Air but not Stays.
 */
export class HybridTravelSupplier implements TravelSupplier {
  private staysMock = false;
  private carsMock = false;
  private warnedStays = false;
  private warnedCars = false;

  constructor(
    private readonly live: DuffelClient,
    private readonly mock: MockTravelSupplier,
  ) {}

  usesMockStays(): boolean {
    return this.staysMock;
  }

  async searchFlights(params: FlightSearchParams): Promise<Flight[]> {
    return this.live.searchFlights(params);
  }

  async searchStays(params: StaySearchParams): Promise<Hotel[]> {
    if (this.staysMock) return this.mock.searchStays(params);
    try {
      return await this.live.searchStays(params);
    } catch (err) {
      if (!isProductDisabled(err)) throw err;
      this.staysMock = true;
      if (!this.warnedStays) {
        this.warnedStays = true;
        console.warn(
          "[duffel] Stays not enabled on this account — using mock hotels. Contact Duffel sales to enable Stays.",
        );
      }
      return this.mock.searchStays(params);
    }
  }

  async searchCars(params: CarSearchParams): Promise<RentalCar[]> {
    if (this.carsMock) return this.mock.searchCars(params);
    try {
      return await this.live.searchCars(params);
    } catch (err) {
      if (!isProductDisabled(err) && !/failed \(404\)/.test(String(err))) {
        throw err;
      }
      this.carsMock = true;
      if (!this.warnedCars) {
        this.warnedCars = true;
        console.warn(
          "[duffel] Cars unavailable on this account — using mock car quotes.",
        );
      }
      return this.mock.searchCars(params);
    }
  }

  revalidateFlightOffer(offerId: string) {
    return this.live.revalidateFlightOffer(offerId);
  }

  revalidateStayRate(rateId: string) {
    if (this.staysMock || rateId.startsWith("rate_mock_")) {
      return this.mock.revalidateStayRate(rateId);
    }
    return this.live.revalidateStayRate(rateId);
  }

  createFlightOrder(params: CreateFlightOrderParams) {
    return this.live.createFlightOrder(params);
  }

  createStayBooking(params: CreateStayBookingParams) {
    if (this.staysMock || params.rateId.startsWith("rate_mock_")) {
      return this.mock.createStayBooking(params);
    }
    return this.live.createStayBooking(params);
  }

  createCarBooking(params: CreateCarBookingParams) {
    if (this.carsMock || params.quoteId.startsWith("quote_mock_")) {
      return this.mock.createCarBooking(params);
    }
    return this.live.createCarBooking(params);
  }
}
