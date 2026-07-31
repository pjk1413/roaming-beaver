import type { Flight, Hotel, RentalCar } from "@mystery-trips/types";

export type FlightSearchParams = {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  passengers: number;
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

export type CarSearchParams = {
  airportCode: string;
  pickUpDate: string;
  dropOffDate: string;
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

export type CreateCarBookingParams = {
  quoteId: string;
  drivers: Array<{ givenName: string; familyName: string }>;
  email: string;
};

export interface TravelSupplier {
  searchFlights(params: FlightSearchParams): Promise<Flight[]>;
  searchStays(params: StaySearchParams): Promise<Hotel[]>;
  searchCars(params: CarSearchParams): Promise<RentalCar[]>;
  revalidateFlightOffer(offerId: string): Promise<Flight | null>;
  revalidateStayRate(rateId: string): Promise<Hotel | null>;
  createFlightOrder(params: CreateFlightOrderParams): Promise<{ id: string }>;
  createStayBooking(params: CreateStayBookingParams): Promise<{ id: string }>;
  createCarBooking(params: CreateCarBookingParams): Promise<{ id: string }>;
}
