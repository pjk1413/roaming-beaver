import { z } from "zod";

export const DestinationSlotSchema = z.enum([
  "BUDGET_GETAWAY",
  "BEACH_ESCAPE",
  "EXOTIC_ADVENTURE",
]);
export type DestinationSlot = z.infer<typeof DestinationSlotSchema>;

export const TripSearchRequestSchema = z.object({
  homeAirport: z
    .string()
    .length(3)
    .transform((s) => s.toUpperCase()),
  departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  travelers: z.number().int().min(1).max(9),
});
export type TripSearchRequest = z.infer<typeof TripSearchRequestSchema>;

export const FlightLegSchema = z.object({
  airline: z.string(),
  flightNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  departAt: z.string(),
  arriveAt: z.string(),
  durationMinutes: z.number().int().nonnegative(),
});
export type FlightLeg = z.infer<typeof FlightLegSchema>;

export const FlightSchema = z.object({
  duffelOfferId: z.string(),
  duffelOfferRequestId: z.string().optional(),
  currency: z.string().default("USD"),
  totalCents: z.number().int().nonnegative(),
  outbound: z.array(FlightLegSchema).min(1),
  inbound: z.array(FlightLegSchema).min(1),
});
export type Flight = z.infer<typeof FlightSchema>;

export const HotelSchema = z.object({
  duffelRateId: z.string(),
  duffelSearchResultId: z.string().optional(),
  name: z.string(),
  starRating: z.number().min(1).max(5),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  checkIn: z.string(),
  checkOut: z.string(),
  currency: z.string().default("USD"),
  totalCents: z.number().int().nonnegative(),
  distanceToBeachMeters: z.number().nonnegative().optional(),
});
export type Hotel = z.infer<typeof HotelSchema>;

export const RentalCarSchema = z.object({
  duffelQuoteId: z.string(),
  vendor: z.string(),
  vehicleName: z.string(),
  pickupLocation: z.string(),
  dropoffLocation: z.string(),
  currency: z.string().default("USD"),
  totalCents: z.number().int().nonnegative(),
});
export type RentalCar = z.infer<typeof RentalCarSchema>;

export const ItineraryItemSchema = z.object({
  day: z.number().int().min(1),
  title: z.string(),
  description: z.string(),
  timeOfDay: z.enum(["morning", "afternoon", "evening"]).optional(),
});
export type ItineraryItem = z.infer<typeof ItineraryItemSchema>;

export const DestinationPackageSchema = z.object({
  id: z.string(),
  slot: DestinationSlotSchema,
  city: z.string(),
  country: z.string(),
  airportCode: z.string(),
  destinationId: z.string(),
  flight: FlightSchema,
  hotel: HotelSchema,
  rentalCar: RentalCarSchema.nullable(),
  itinerary: z.array(ItineraryItemSchema),
  subtotalCents: z.number().int().nonnegative(),
  assemblyFeeCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().default("USD"),
});
export type DestinationPackage = z.infer<typeof DestinationPackageSchema>;

export const TripSearchResultSchema = z.object({
  searchId: z.string(),
  packages: z.array(DestinationPackageSchema).length(3),
});
export type TripSearchResult = z.infer<typeof TripSearchResultSchema>;

export const CheckoutRequestSchema = z.object({
  searchId: z.string(),
  packageId: z.string(),
  email: z.string().email(),
  travelers: z
    .array(
      z.object({
        givenName: z.string().min(1),
        familyName: z.string().min(1),
        bornOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .min(1),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const OrderStatusSchema = z.enum([
  "PENDING_PAYMENT",
  "PAID",
  "BOOKING",
  "CONFIRMED",
  "FAILED",
  "REFUNDED",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  status: OrderStatusSchema,
  email: z.string().email(),
  packageSnapshot: DestinationPackageSchema,
  totalCents: z.number().int().nonnegative(),
  currency: z.string(),
  stripePaymentIntentId: z.string().nullable().optional(),
  duffelFlightOrderId: z.string().nullable().optional(),
  duffelStayBookingId: z.string().nullable().optional(),
  duffelCarBookingId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const ASSEMBLY_FEE_MIN = 0.05;
export const ASSEMBLY_FEE_MAX = 0.1;
export const ASSEMBLY_FEE_DEFAULT = 0.08;

export function clampAssemblyFeeRate(rate: number): number {
  return Math.min(ASSEMBLY_FEE_MAX, Math.max(ASSEMBLY_FEE_MIN, rate));
}
