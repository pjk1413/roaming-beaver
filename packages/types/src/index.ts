import { z } from "zod";

export * from "./dates";

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

const HotelFieldsSchema = z.object({
  hotelRateId: z.string(),
  hotelSearchResultId: z.string().optional(),
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

/** Accepts legacy Duffel field names when reading stored JSON snapshots. */
export const HotelSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.hotelRateId !== "string" && typeof o.duffelRateId === "string") {
      return {
        ...o,
        hotelRateId: o.duffelRateId,
        hotelSearchResultId:
          o.hotelSearchResultId ?? o.duffelSearchResultId,
      };
    }
  }
  return raw;
}, HotelFieldsSchema);
export type Hotel = z.infer<typeof HotelFieldsSchema>;

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
  /** 0 = first (and only) result per slot */
  rank: z.number().int().min(0).max(2).default(0),
  city: z.string(),
  country: z.string(),
  airportCode: z.string(),
  destinationId: z.string(),
  flight: FlightSchema,
  hotel: HotelSchema,
  itinerary: z.array(ItineraryItemSchema),
  subtotalCents: z.number().int().nonnegative(),
  assemblyFeeCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().default("USD"),
  /** Loaded live from DestinationImage (not match-cache). */
  images: z
    .array(
      z.object({
        url: z.string(),
        thumbUrl: z.string().nullable().optional(),
        attribution: z.string().nullable().optional(),
        source: z.string().optional(),
        sourcePageUrl: z.string().nullable().optional(),
        kind: z.enum(["hero", "gallery"]).or(z.string()),
        caption: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .default([]),
});
export type DestinationPackage = z.infer<typeof DestinationPackageSchema>;

export type DestinationImageDto = DestinationPackage["images"][number];

/** Exactly one package per slot (Budget / Beach / Exotic). */
export const TripSearchResultSchema = z.object({
  searchId: z.string(),
  packages: z.array(DestinationPackageSchema).min(1).max(3),
});
export type TripSearchResult = z.infer<typeof TripSearchResultSchema>;

export const PACKAGES_PER_SLOT = 1 as const;

export const CheckoutRequestSchema = z.object({
  searchId: z.string(),
  packageId: z.string(),
  /** Used for placeholder passenger slots; names/email come from Stripe after pay. */
  travelerCount: z.number().int().min(1).max(9).default(1),
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
  hotelBookingId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const ASSEMBLY_FEE_MIN = 0.05;
export const ASSEMBLY_FEE_MAX = 0.1;
export const ASSEMBLY_FEE_DEFAULT = 0.08;

export function clampAssemblyFeeRate(rate: number): number {
  return Math.min(ASSEMBLY_FEE_MAX, Math.max(ASSEMBLY_FEE_MIN, rate));
}
