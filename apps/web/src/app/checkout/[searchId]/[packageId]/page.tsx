"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { trpc } from "@/lib/trpc";
import { SLOT_META, formatMoney, nightsBetween } from "@/lib/format";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

export default function CheckoutPage() {
  const params = useParams<{ searchId: string; packageId: string }>();
  const router = useRouter();
  const { data: search } = trpc.search.get.useQuery({
    searchId: params.searchId,
  });
  const startCheckout = trpc.checkout.start.useMutation();

  const pkg = useMemo(
    () => search?.packages.find((p) => p.id === params.packageId),
    [search, params.packageId],
  );

  const [travelers, setTravelers] = useState(2);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    const t = sessionStorage.getItem("rb_travelers");
    if (t) setTravelers(Number(t) || 2);
  }, []);

  // Create PaymentIntent as soon as the package is known — Stripe Element only
  useEffect(() => {
    if (!pkg || started.current) return;
    started.current = true;

    void startCheckout
      .mutateAsync({
        searchId: params.searchId,
        packageId: params.packageId,
        travelerCount: travelers,
      })
      .then((result) => {
        setClientSecret(result.clientSecret);
        setOrderId(result.orderId);
        setMock(result.mock);
        setBooting(false);
      })
      .catch((err) => {
        setBooting(false);
        setError(err instanceof Error ? err.message : "Checkout failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg, params.searchId, params.packageId, travelers]);

  if (!pkg || booting) {
    return (
      <div className="mx-auto max-w-[900px] px-8 py-20">
        <p className="text-[var(--color-ink-soft)]">Preparing secure checkout…</p>
      </div>
    );
  }

  const meta = SLOT_META[pkg.slot];
  const nights = nightsBetween(pkg.hotel.checkIn, pkg.hotel.checkOut);

  return (
    <div className="mx-auto grid max-w-[900px] gap-10 px-8 pb-20 pt-11 md:grid-cols-[1.3fr_1fr] animate-fade-up">
      <div>
        <h2 className="mb-7 font-display text-[32px] font-bold tracking-[-0.02em]">
          Lock it in.
        </h2>

        {error && (
          <div className="mb-4 text-sm font-semibold text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {mock || !stripePromise || !clientSecret ? (
          <MockCheckout
            orderId={orderId}
            onPaid={(id) => router.push(`/confirmation/${id}`)}
            onError={setError}
          />
        ) : (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "#c45c26",
                  borderRadius: "12px",
                },
              },
            }}
          >
            <StripePayForm
              orderId={orderId!}
              onPaid={(id) => router.push(`/confirmation/${id}`)}
              onError={setError}
            />
          </Elements>
        )}
      </div>

      <aside className="h-fit rounded-[20px] bg-white p-7">
        <div className="mb-[18px] text-[13px] font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
          Order summary
        </div>
        <div className="mb-1 font-display text-xl font-bold">{pkg.city}</div>
        <div className="mb-[18px] text-[13px] text-[var(--color-ink-soft)]">
          {meta.label} · {nights} nights
        </div>
        <div className="flex justify-between border-t border-[var(--color-line)] py-2.5 text-sm">
          <span>Travelers</span>
          <span className="font-mono">{travelers}</span>
        </div>
        <div className="flex justify-between border-t border-[var(--color-line)] py-2.5 text-sm">
          <span>Flights + hotel</span>
          <span className="font-mono">included</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-[var(--color-line-strong)] py-3.5 text-lg font-bold">
          <span>Total</span>
          <span>{formatMoney(pkg.totalCents, pkg.currency)}</span>
        </div>
      </aside>
    </div>
  );
}

function MockCheckout({
  orderId,
  onPaid,
  onError,
}: {
  orderId: string | null;
  onPaid: (orderId: string) => void;
  onError: (msg: string) => void;
}) {
  const confirmCheckout = trpc.checkout.confirm.useMutation();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setPending(true);
    try {
      const order = await confirmCheckout.mutateAsync({ orderId });
      onPaid(order.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Booking failed");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <p className="m-0 text-sm text-[var(--color-ink-soft)]">
        Stripe isn’t configured — this confirms a mock booking with no card
        charge.
      </p>
      <button type="submit" className="btn-primary" disabled={!orderId || pending}>
        {pending ? "Confirming…" : "Confirm mock booking"}
      </button>
    </form>
  );
}

function StripePayForm({
  orderId,
  onPaid,
  onError,
}: {
  orderId: string;
  onPaid: (orderId: string) => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const confirmCheckout = trpc.checkout.confirm.useMutation();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    onError("");

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        // Payment Element collects name + email; return_url for redirect methods
        return_url: `${window.location.origin}/confirmation/${orderId}`,
      },
    });

    if (stripeError) {
      onError(stripeError.message ?? "Payment failed");
      setPending(false);
      return;
    }

    try {
      // Server pulls email/name from the PaymentIntent, then books Duffel
      const order = await confirmCheckout.mutateAsync({ orderId });
      onPaid(order.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Booking failed");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <PaymentElement
        options={{
          layout: "tabs",
          fields: {
            billingDetails: {
              name: "auto",
              email: "auto",
              phone: "never",
              address: "never",
            },
          },
        }}
      />
      <button
        type="submit"
        className="btn-primary"
        disabled={!stripe || pending}
      >
        {pending ? "Confirming…" : "Confirm & book"}
      </button>
      <p className="m-0 text-center text-xs text-[var(--color-ink-soft)]">
        Secure checkout powered by Stripe. Name and email are collected with
        your payment.
      </p>
    </form>
  );
}
