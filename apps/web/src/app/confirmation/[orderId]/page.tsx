"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { SLOT_META, formatMoney, nightsBetween } from "@/lib/format";

export default function ConfirmationPage() {
  const params = useParams<{ orderId: string }>();
  const { data: order, isLoading } = trpc.checkout.get.useQuery({
    orderId: params.orderId,
  });
  const [origin, setOrigin] = useState("HOME");

  useEffect(() => {
    const o = sessionStorage.getItem("rb_origin");
    if (o) setOrigin(o.slice(0, 3).toUpperCase());
  }, []);

  if (isLoading || !order) {
    return (
      <div className="mx-auto max-w-[640px] px-8 py-20 text-center">
        <p>Loading confirmation…</p>
      </div>
    );
  }

  const pkg = order.packageSnapshot;
  const meta = SLOT_META[pkg.slot];
  const nights = nightsBetween(pkg.hotel.checkIn, pkg.hotel.checkOut);
  const code =
    order.duffelFlightOrderId?.slice(0, 10).toUpperCase() ||
    `RB-${order.id.slice(-5).toUpperCase()}`;

  return (
    <div className="mx-auto max-w-[640px] px-8 pb-[100px] pt-20 text-center animate-fade-up">
      <div
        className="animate-pop mx-auto mb-7 flex h-[72px] w-[72px] items-center justify-center rounded-full"
        style={{ background: meta.hue }}
      >
        <span className="text-[32px] font-bold text-white">✓</span>
      </div>
      <div
        className="mb-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.04em]"
        style={{ color: meta.hue }}
      >
        Booked · {code}
      </div>
      <h2 className="mb-3.5 font-display text-[38px] font-bold tracking-[-0.02em]">
        You&apos;re going to {pkg.city}.
      </h2>
      <p className="mb-9 text-base text-[var(--color-ink-soft)]">
        {nights} nights · {origin} → {pkg.airportCode} ·{" "}
        {formatMoney(order.totalCents, order.currency)} flat, already paid.
      </p>

      <div className="mb-8 rounded-[20px] bg-white p-7 text-left">
        <div className="mb-4 text-[13px] font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
          What happens next
        </div>
        <div className="text-[15px] leading-relaxed text-[var(--color-ink-deep)]">
          Your e-tickets and hotel confirmation land in{" "}
          <strong>{order.email}</strong> within a few minutes. Nothing else to
          plan.
        </div>
        {(order.duffelFlightOrderId || order.hotelBookingId) && (
          <dl className="mt-5 space-y-1 font-mono text-xs text-[var(--color-ink-soft)]">
            {order.duffelFlightOrderId && (
              <div>Flight: {order.duffelFlightOrderId}</div>
            )}
            {order.hotelBookingId && (
              <div>Hotel: {order.hotelBookingId}</div>
            )}
          </dl>
        )}
      </div>

      <div className="flex justify-center gap-3.5">
        <Link href="/" className="btn-secondary !px-[26px] !py-3.5 !text-[15px]">
          Back to home
        </Link>
        <Link
          href="/search"
          className="btn-primary !px-[26px] !py-3.5 !text-[15px]"
        >
          Plan another trip
        </Link>
      </div>
    </div>
  );
}
