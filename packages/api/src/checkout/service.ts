import { prisma } from "@mystery-trips/db";
import type { CheckoutRequest, DestinationPackage, Order } from "@mystery-trips/types";
import { DestinationPackageSchema } from "@mystery-trips/types";
import Stripe from "stripe";
import { Resend } from "resend";
import { createFlightSupplier, createHotelSupplier } from "../travel";

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const g = globalThis as unknown as { stripe?: Stripe };
  if (!g.stripe) {
    g.stripe = new Stripe(key);
  }
  return g.stripe;
}

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const g = globalThis as unknown as { resend?: Resend };
  if (!g.resend) {
    g.resend = new Resend(apiKey);
  }
  return g.resend;
}

export async function createPaymentIntent(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const stripe = getStripe();

  if (!stripe) {
    // Dev mode: fake payment intent
    const fakeId = `pi_mock_${orderId}`;
    await prisma.order.update({
      where: { id: orderId },
      data: { stripePaymentIntentId: fakeId, status: "PENDING_PAYMENT" },
    });
    return {
      clientSecret: `${fakeId}_secret_mock`,
      paymentIntentId: fakeId,
      mock: true as const,
    };
  }

  const pi = await stripe.paymentIntents.create({
    amount: order.totalCents,
    currency: order.currency.toLowerCase(),
    metadata: { orderId: order.id },
    automatic_payment_methods: { enabled: true },
    // Name + email collected in Payment Element; copied onto the PI at confirm
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { stripePaymentIntentId: pi.id },
  });

  return {
    clientSecret: pi.client_secret!,
    paymentIntentId: pi.id,
    mock: false as const,
  };
}

export async function createOrderFromCheckout(
  input: CheckoutRequest,
  userId?: string,
) {
  const pkg = await prisma.destinationPackage.findFirst({
    where: { id: input.packageId, searchId: input.searchId },
  });
  if (!pkg) {
    throw new Error("Package not found for this search");
  }

  const snapshot = DestinationPackageSchema.parse({
    id: pkg.id,
    slot: pkg.slot,
    rank: pkg.rank,
    city: pkg.city,
    country: pkg.country,
    airportCode: pkg.airportCode,
    destinationId: pkg.destinationId,
    flight: pkg.flightJson,
    hotel: pkg.hotelJson,
    itinerary: pkg.itineraryJson,
    subtotalCents: pkg.subtotalCents,
    assemblyFeeCents: pkg.assemblyFeeCents,
    totalCents: pkg.totalCents,
    currency: pkg.currency,
  });

  // Revalidate offers before charging (Duffel flight + LiteAPI hotel)
  const flightSupplier = createFlightSupplier();
  const hotelSupplier = createHotelSupplier();
  const flightOk = await flightSupplier.revalidateFlightOffer(
    snapshot.flight.duffelOfferId,
  );
  const stayOk = await hotelSupplier.revalidateStayRate(
    snapshot.hotel.hotelRateId,
  );
  if (!flightOk || !stayOk) {
    throw new Error(
      "Offers expired or changed. Please search again for fresh prices.",
    );
  }

  // Sync prices if they moved (still charge updated total)
  const subtotal = flightOk.totalCents + stayOk.totalCents;
  const feeRate =
    pkg.subtotalCents > 0 ? pkg.assemblyFeeCents / pkg.subtotalCents : 0.08;
  const assemblyFeeCents = Math.round(subtotal * feeRate);
  const totalCents = subtotal + assemblyFeeCents;

  snapshot.flight = {
    ...snapshot.flight,
    ...flightOk,
    outbound: flightOk.outbound,
    inbound: flightOk.inbound,
  };
  snapshot.hotel = {
    ...snapshot.hotel,
    ...stayOk,
    checkIn: snapshot.hotel.checkIn,
    checkOut: snapshot.hotel.checkOut,
  };
  snapshot.subtotalCents = subtotal;
  snapshot.assemblyFeeCents = assemblyFeeCents;
  snapshot.totalCents = totalCents;

  const travelerCount = input.travelerCount ?? 1;
  const placeholderTravelers = Array.from({ length: travelerCount }, (_, i) => ({
    givenName: "Traveler",
    familyName: String(i + 1),
  }));

  const order = await prisma.order.create({
    data: {
      status: "PENDING_PAYMENT",
      // Replaced from Stripe PaymentIntent billing details after pay
      email: "pending@checkout.local",
      userId: userId ?? null,
      searchId: input.searchId,
      packageId: input.packageId,
      packageSnapshot: snapshot,
      travelersJson: placeholderTravelers,
      totalCents,
      currency: snapshot.currency,
    },
  });

  return order;
}

function splitName(fullName: string): { givenName: string; familyName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "Traveler", familyName: "1" };
  if (parts.length === 1) return { givenName: parts[0]!, familyName: parts[0]! };
  return {
    givenName: parts[0]!,
    familyName: parts.slice(1).join(" "),
  };
}

/**
 * Pull buyer email + name from a succeeded PaymentIntent onto the order
 * (Payment Element billing details / receipt_email).
 */
export async function syncBuyerFromStripePaymentIntent(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const stripe = getStripe();
  const piId = order.stripePaymentIntentId;
  if (!stripe || !piId || piId.startsWith("pi_mock_")) {
    if (order.email === "pending@checkout.local") {
      return prisma.order.update({
        where: { id: orderId },
        data: { email: "guest@example.com" },
      });
    }
    return order;
  }

  const pi = await stripe.paymentIntents.retrieve(piId, {
    expand: ["latest_charge"],
  });

  const charge =
    typeof pi.latest_charge === "object" && pi.latest_charge
      ? pi.latest_charge
      : null;
  const billing = charge?.billing_details ?? null;
  const email =
    (typeof pi.receipt_email === "string" && pi.receipt_email) ||
    (typeof billing?.email === "string" && billing.email) ||
    null;
  const fullName =
    typeof billing?.name === "string" && billing.name.trim()
      ? billing.name.trim()
      : null;

  const existingTravelers = (order.travelersJson as Array<{
    givenName: string;
    familyName: string;
    bornOn?: string;
  }>) ?? [{ givenName: "Traveler", familyName: "1" }];

  let travelersJson = existingTravelers;
  if (fullName) {
    const primary = splitName(fullName);
    travelersJson = existingTravelers.map((t, i) =>
      i === 0 ? { ...t, ...primary } : t,
    );
  }

  const nextEmail =
    email && email.includes("@") ? email : order.email;

  if (
    nextEmail === order.email &&
    JSON.stringify(travelersJson) === JSON.stringify(existingTravelers)
  ) {
    return order;
  }

  return prisma.order.update({
    where: { id: orderId },
    data: {
      email: nextEmail,
      travelersJson,
    },
  });
}

/**
 * After Stripe payment succeeds: book hotel (LiteAPI) then flight (Duffel).
 * Hotel first because a cancelled hotel is usually cleaner to unwind than an
 * airline ticket. On any booking failure: cancel hotel if booked, refund Stripe.
 */
export async function fulfillOrderAfterPayment(orderId: string) {
  await syncBuyerFromStripePaymentIntent(orderId);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status === "CONFIRMED") return order;
  if (order.status === "FAILED" || order.status === "REFUNDED") return order;

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "BOOKING" },
  });

  const snapshot = DestinationPackageSchema.parse(order.packageSnapshot);
  const travelers = order.travelersJson as Array<{
    givenName: string;
    familyName: string;
    bornOn?: string;
  }>;
  const flightSupplier = createFlightSupplier();
  const hotelSupplier = createHotelSupplier();

  let hotelBookingId: string | undefined;
  let flightOrderId: string | undefined;

  try {
    // 1. Hotel first (easier to cancel than a ticketed flight)
    const stay = await hotelSupplier.createStayBooking({
      rateId: snapshot.hotel.hotelRateId,
      guests: travelers.map((t) => ({
        givenName: t.givenName,
        familyName: t.familyName,
      })),
      email: order.email,
    });
    hotelBookingId = stay.id;

    // 2. Flight via Duffel Balance
    const flight = await flightSupplier.createFlightOrder({
      offerId: snapshot.flight.duffelOfferId,
      passengers: travelers.map((t) => ({
        givenName: t.givenName,
        familyName: t.familyName,
        bornOn: t.bornOn,
        email: order.email,
      })),
    });
    flightOrderId = flight.id;

    const confirmed = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CONFIRMED",
        duffelFlightOrderId: flightOrderId,
        hotelBookingId,
        userId: order.userId ?? (await ensureUserForEmail(order.email)),
      },
    });

    await sendConfirmationEmail(confirmed.id, snapshot);
    return confirmed;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[checkout] CRITICAL: supplier booking failed after payment for order ${orderId}:`,
      reason,
    );

    if (hotelBookingId) {
      try {
        await hotelSupplier.cancelStayBooking(hotelBookingId);
        console.info(
          `[checkout] Cancelled hotel booking ${hotelBookingId} after flight failure for order ${orderId}`,
        );
      } catch (cancelErr) {
        // Money moved + hotel may still exist with no matching flight — page ops.
        console.error(
          `[checkout] CRITICAL OPS: hotel cancel failed for order ${orderId}, hotelBookingId=${hotelBookingId}. Manual intervention required.`,
          cancelErr instanceof Error ? cancelErr.message : cancelErr,
        );
      }
    }

    await refundOrder(orderId, reason);
    throw err;
  }
}

async function ensureUserForEmail(email: string): Promise<string | null> {
  // Only link if they already have a Supabase-backed profile. Guest checkouts
  // stay email-only until the traveler signs in with the same address.
  const existing = await prisma.user.findUnique({ where: { email } });
  return existing?.id ?? null;
}

async function refundOrder(orderId: string, reason: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const stripe = getStripe();

  if (stripe && order.stripePaymentIntentId && !order.stripePaymentIntentId.startsWith("pi_mock_")) {
    try {
      await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
      });
    } catch (refundErr) {
      console.error(
        `[checkout] CRITICAL: refund also failed for order ${orderId}`,
        refundErr,
      );
    }
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "REFUNDED",
      failureReason: reason,
    },
  });
}

async function sendConfirmationEmail(
  orderId: string,
  snapshot: DestinationPackage,
) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(
      `[email] Skipping Resend (no key). Would send confirmation for ${orderId} to ${order.email}`,
    );
    return;
  }

  const resend = getResend();
  if (!resend) return;
  await resend.emails.send({
    from: "Mystery Trips <bookings@mysterytrips.app>",
    to: order.email,
    subject: `Your Mystery Trip to ${snapshot.city} is confirmed`,
    html: `
      <h1>You're going to ${snapshot.city}!</h1>
      <p>Order <strong>${order.id}</strong> is confirmed.</p>
      <ul>
        <li>Flight: ${order.duffelFlightOrderId ?? "—"}</li>
        <li>Hotel: ${order.hotelBookingId ?? "—"}</li>
      </ul>
      <p>Total paid: $${(order.totalCents / 100).toFixed(2)} ${order.currency}</p>
    `,
  });
}

export function toOrderDto(order: {
  id: string;
  status: string;
  email: string;
  packageSnapshot: unknown;
  totalCents: number;
  currency: string;
  stripePaymentIntentId: string | null;
  duffelFlightOrderId: string | null;
  hotelBookingId: string | null;
  createdAt: Date;
}): Order {
  return {
    id: order.id,
    status: order.status as Order["status"],
    email: order.email,
    packageSnapshot: DestinationPackageSchema.parse(order.packageSnapshot),
    totalCents: order.totalCents,
    currency: order.currency,
    stripePaymentIntentId: order.stripePaymentIntentId,
    duffelFlightOrderId: order.duffelFlightOrderId,
    hotelBookingId: order.hotelBookingId,
    createdAt: order.createdAt.toISOString(),
  };
}
