import { NextResponse } from "next/server";
import Stripe from "stripe";
import { fulfillOrderAfterPayment } from "@mystery-trips/api";
import { prisma } from "@mystery-trips/db";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;

  if (!secret || !key) {
    return NextResponse.json(
      { error: "Stripe webhook not configured" },
      { status: 501 },
    );
  }

  const stripe = new Stripe(key);
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("[stripe webhook]", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const orderId = pi.metadata.orderId;
    if (orderId) {
      await prisma.order.updateMany({
        where: { id: orderId, status: "PENDING_PAYMENT" },
        data: { status: "PAID", stripePaymentIntentId: pi.id },
      });
      try {
        await fulfillOrderAfterPayment(orderId);
      } catch (err) {
        console.error("[stripe webhook] fulfill failed", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
