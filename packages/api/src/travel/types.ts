import type { Flight, Hotel } from "@mystery-trips/types";

export type FlightSearchParams = {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  passengers: number;
  /** 0 = direct only; omit for Duffel's default (up to 1 connection). */
  maxConnections?: number;
};

export type StaySearchParams = {
  latitude: number;
  longitude: number;
  radiusKm: number;
  checkIn: string;
  checkOut: string;
  guests: number;
  minStars?: number;
  maxStars?: number;
};

export type CreateFlightOrderParams = {
  offerId: string;
  passengers: Array<{
    givenName: string;
    familyName: string;
    bornOn?: string;
    email: string;
  }>;
};

export type CreateStayBookingParams = {
  rateId: string;
  guests: Array<{ givenName: string; familyName: string }>;
  email: string;
};

export interface FlightSupplier {
  searchFlights(params: FlightSearchParams): Promise<Flight[]>;
  revalidateFlightOffer(offerId: string): Promise<Flight | null>;
  createFlightOrder(params: CreateFlightOrderParams): Promise<{ id: string }>;
}

export interface HotelSupplier {
  searchStays(params: StaySearchParams): Promise<Hotel[]>;
  revalidateStayRate(rateId: string): Promise<Hotel | null>;
  createStayBooking(params: CreateStayBookingParams): Promise<{ id: string }>;
  /** Best-effort cancel for checkout rollback. Throws on hard failure. */
  cancelStayBooking(bookingId: string): Promise<void>;
}
