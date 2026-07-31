"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  const confirmCheckout = trpc.checkout.confirm.useMutation();

  const pkg = useMemo(
    () => search?.packages.find((p) => p.id === params.packageId),
    [search, params.packageId],
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [card, setCard] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [travelers, setTravelers] = useState(2);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem("rb_travelers");
    if (t) setTravelers(Number(t) || 2);
  }, []);

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Fill in your name and email to confirm.");
      return;
    }
    // In mock mode, also require card fields for design parity
    if (!clientSecret && card.trim().length < 8) {
      setError("Fill in your name, email, and card number to confirm.");
      return;
    }

    setError(null);
    setBooking(true);

    try {
      const parts = name.trim().split(/\s+/);
      const givenName = parts[0]!;
      const familyName = parts.slice(1).join(" ") || givenName;

      if (!orderId) {
        const result = await startCheckout.mutateAsync({
          searchId: params.searchId,
          packageId: params.packageId,
          email,
          travelers: [{ givenName, familyName }],
        });
        setClientSecret(result.clientSecret);
        setOrderId(result.orderId);
        setMock(result.mock);

        if (result.mock) {
          const order = await confirmCheckout.mutateAsync({
            orderId: result.orderId,
          });
          router.push(`/confirmation/${order.id}`);
          return;
        }
        setBooking(false);
        return;
      }

      if (mock && orderId) {
        const order = await confirmCheckout.mutateAsync({ orderId });
        router.push(`/confirmation/${order.id}`);
      }
    } catch (err) {
      setBooking(false);
      setError(err instanceof Error ? err.message : "Checkout failed");
    }
  }

  if (!pkg) {
    return (
      <div className="mx-auto max-w-[900px] px-8 py-20">
        <p>Loading…</p>
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

        {!clientSecret || mock ? (
          <form onSubmit={onConfirm} className="flex flex-col gap-5">
            <Field label="Full name">
              <input
                className="field-input text-[15px]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jamie Rivera"
                required
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className="field-input text-[15px]"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jamie@email.com"
                required
              />
            </Field>
            <Field label="Card number">
              <input
                className="field-input font-mono text-[15px]"
                value={card}
                onChange={(e) => setCard(e.target.value)}
                placeholder="4242 4242 4242 4242"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Expiry">
                <input
                  className="field-input font-mono text-[15px]"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder="MM/YY"
                />
              </Field>
              <Field label="CVC">
                <input
                  className="field-input font-mono text-[15px]"
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value)}
                  placeholder="123"
                />
              </Field>
            </div>
            {error && (
              <div className="text-sm font-semibold text-[var(--color-danger)]">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary mt-1" disabled={booking}>
              {booking ? "Confirming…" : "Confirm & book"}
            </button>
            <p className="m-0 text-center text-xs text-[var(--color-ink-soft)]">
              {mock || !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
                ? "Sandbox mode — no real payment is processed."
                : "Secure checkout powered by Stripe."}
            </p>
          </form>
        ) : (
          clientSecret &&
          stripePromise && (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <StripePayForm
                orderId={orderId!}
                name={name}
                email={email}
                onName={setName}
                onEmail={setEmail}
                onPaid={(id) => router.push(`/confirmation/${id}`)}
                onError={setError}
              />
            </Elements>
          )
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

function StripePayForm({
  orderId,
  name,
  email,
  onName,
  onEmail,
  onPaid,
  onError,
}: {
  orderId: string;
  name: string;
  email: string;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
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
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (stripeError) {
      onError(stripeError.message ?? "Payment failed");
      setPending(false);
      return;
    }
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
      <Field label="Full name">
        <input
          className="field-input text-[15px]"
          value={name}
          onChange={(e) => onName(e.target.value)}
          required
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          className="field-input text-[15px]"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          required
        />
      </Field>
      <PaymentElement />
      <button
        type="submit"
        className="btn-primary"
        disabled={!stripe || pending}
      >
        {pending ? "Confirming…" : "Confirm & book"}
      </button>
    </form>
  );
}
