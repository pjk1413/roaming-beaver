import { prisma } from "@mystery-trips/db";
import type { CheckoutRequest, DestinationPackage, Order } from "@mystery-trips/types";
import { DestinationPackageSchema } from "@mystery-trips/types";
import Stripe from "stripe";
import { Resend } from "resend";
import { createTravelSupplier } from "../duffel";

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
    receipt_email: order.email,
    automatic_payment_methods: { enabled: true },
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
    city: pkg.city,
    country: pkg.country,
    airportCode: pkg.airportCode,
    destinationId: pkg.destinationId,
    flight: pkg.flightJson,
    hotel: pkg.hotelJson,
    rentalCar: pkg.rentalCarJson,
    itinerary: pkg.itineraryJson,
    subtotalCents: pkg.subtotalCents,
    assemblyFeeCents: pkg.assemblyFeeCents,
    totalCents: pkg.totalCents,
    currency: pkg.currency,
  });

  // Revalidate offers before charging
  const supplier = createTravelSupplier();
  const flightOk = await supplier.revalidateFlightOffer(
    snapshot.flight.duffelOfferId,
  );
  const stayOk = await supplier.revalidateStayRate(snapshot.hotel.duffelRateId);
  if (!flightOk || !stayOk) {
    throw new Error(
      "Offers expired or changed. Please search again for fresh prices.",
    );
  }

  // Sync prices if they moved (still charge updated total)
  const rentalCents = snapshot.rentalCar?.totalCents ?? 0;
  const subtotal =
    flightOk.totalCents + stayOk.totalCents + rentalCents;
  const feeRate =
    pkg.subtotalCents > 0 ? pkg.assemblyFeeCents / pkg.subtotalCents : 0.08;
  const assemblyFeeCents = Math.round(subtotal * feeRate);
  const totalCents = subtotal + assemblyFeeCents;

  snapshot.flight = { ...snapshot.flight, ...flightOk, outbound: flightOk.outbound, inbound: flightOk.inbound };
  snapshot.hotel = {
    ...snapshot.hotel,
    ...stayOk,
    checkIn: snapshot.hotel.checkIn,
    checkOut: snapshot.hotel.checkOut,
  };
  snapshot.subtotalCents = subtotal;
  snapshot.assemblyFeeCents = assemblyFeeCents;
  snapshot.totalCents = totalCents;

  const order = await prisma.order.create({
    data: {
      status: "PENDING_PAYMENT",
      email: input.email,
      userId: userId ?? null,
      searchId: input.searchId,
      packageId: input.packageId,
      packageSnapshot: snapshot,
      travelersJson: input.travelers,
      totalCents,
      currency: snapshot.currency,
    },
  });

  return order;
}

/**
 * After Stripe payment succeeds: book via Duffel Balance, email, or refund on failure.
 */
export async function fulfillOrderAfterPayment(orderId: string) {
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
  const primary = travelers[0]!;
  const supplier = createTravelSupplier();

  let flightOrderId: string | undefined;
  let stayBookingId: string | undefined;
  let carBookingId: string | undefined;

  try {
    const flight = await supplier.createFlightOrder({
      offerId: snapshot.flight.duffelOfferId,
      passengers: travelers.map((t) => ({
        givenName: t.givenName,
        familyName: t.familyName,
        bornOn: t.bornOn,
        email: order.email,
      })),
    });
    flightOrderId = flight.id;

    const stay = await supplier.createStayBooking({
      rateId: snapshot.hotel.duffelRateId,
      guests: travelers.map((t) => ({
        givenName: t.givenName,
        familyName: t.familyName,
      })),
      email: order.email,
    });
    stayBookingId = stay.id;

    if (snapshot.rentalCar) {
      const car = await supplier.createCarBooking({
        quoteId: snapshot.rentalCar.duffelQuoteId,
        drivers: [
          { givenName: primary.givenName, familyName: primary.familyName },
        ],
        email: order.email,
      });
      carBookingId = car.id;
    }

    const confirmed = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CONFIRMED",
        duffelFlightOrderId: flightOrderId,
        duffelStayBookingId: stayBookingId,
        duffelCarBookingId: carBookingId ?? null,
        userId: order.userId ?? (await ensureUserForEmail(order.email)),
      },
    });

    await sendConfirmationEmail(confirmed.id, snapshot);
    return confirmed;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[checkout] CRITICAL: Duffel booking failed after payment for order ${orderId}:`,
      reason,
    );

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
        <li>Hotel: ${order.duffelStayBookingId ?? "—"}</li>
        ${order.duffelCarBookingId ? `<li>Car: ${order.duffelCarBookingId}</li>` : ""}
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
  duffelStayBookingId: string | null;
  duffelCarBookingId: string | null;
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
    duffelStayBookingId: order.duffelStayBookingId,
    duffelCarBookingId: order.duffelCarBookingId,
    createdAt: order.createdAt.toISOString(),
  };
}
