"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  SLOT_META,
  formatDateRange,
  formatMoney,
  nightsBetween,
} from "@/lib/format";

export default function TripDetailPage() {
  const params = useParams<{ searchId: string; packageId: string }>();
  const { data, isLoading } = trpc.search.get.useQuery({
    searchId: params.searchId,
  });
  const [origin, setOrigin] = useState("HOME");
  const [travelers, setTravelers] = useState(2);

  useEffect(() => {
    const o = sessionStorage.getItem("rb_origin");
    const t = sessionStorage.getItem("rb_travelers");
    if (o) setOrigin(o.slice(0, 3).toUpperCase());
    if (t) setTravelers(Number(t) || 2);
  }, []);

  const pkg = useMemo(
    () => data?.packages.find((p) => p.id === params.packageId),
    [data, params.packageId],
  );

  if (isLoading || !pkg) {
    return (
      <div className="mx-auto max-w-[920px] px-8 py-20">
        <p className="text-[var(--color-ink-soft)]">Loading trip…</p>
      </div>
    );
  }

  const meta = SLOT_META[pkg.slot];
  const nights = nightsBetween(pkg.hotel.checkIn, pkg.hotel.checkOut);
  const tagline =
    pkg.itinerary[0]?.description ??
    `${pkg.hotel.starRating}★ ${pkg.hotel.name} · flights included.`;

  return (
    <div className="mx-auto max-w-[920px] px-8 pb-36 pt-10 animate-fade-up">
      <div
        className="mb-2.5 font-mono text-xs font-bold uppercase tracking-[0.04em]"
        style={{ color: meta.hue }}
      >
        {meta.label}
      </div>
      <h2 className="mb-1.5 font-display text-[40px] font-bold tracking-[-0.02em]">
        {pkg.city}, {pkg.country}
      </h2>
      <p className="mb-7 max-w-[600px] text-base text-[var(--color-ink-soft)]">
        {tagline}
      </p>

      <div
        className="mb-7 flex h-[420px] w-full items-end rounded-[24px] bg-cover bg-center p-8"
        style={{
          backgroundImage: `linear-gradient(to top, oklch(22% 0.02 50 / 0.55), transparent 50%), url(https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=80)`,
        }}
      >
        <div className="text-white">
          <div className="font-display text-2xl font-bold">{pkg.city}</div>
          <div className="text-sm opacity-90">
            {pkg.hotel.starRating}★ {pkg.hotel.name}
          </div>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-6">
        <div className="rounded-2xl bg-white px-6 py-[18px]">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
            Dates
          </div>
          <div className="font-mono text-[15px]">
            {formatDateRange(pkg.hotel.checkIn, pkg.hotel.checkOut)}
          </div>
        </div>
        <div className="rounded-2xl bg-white px-6 py-[18px]">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
            Route
          </div>
          <div className="font-mono text-[15px]">
            {origin} → {pkg.airportCode}
          </div>
        </div>
        <div className="rounded-2xl bg-white px-6 py-[18px]">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
            Stay
          </div>
          <div className="font-mono text-[15px]">{nights} nights</div>
        </div>
      </div>

      <div className="mb-10">
        <h3 className="mb-4 font-display text-xl font-bold">Itinerary</h3>
        <ol className="space-y-4 border-l border-[var(--color-line)] pl-5">
          {pkg.itinerary.map((item, idx) => (
            <li key={`${item.day}-${idx}`}>
              <div className="font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
                Day {item.day}
                {item.timeOfDay ? ` · ${item.timeOfDay}` : ""}
              </div>
              <div className="font-semibold">{item.title}</div>
              <div className="text-sm text-[var(--color-ink-soft)]">
                {item.description}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-[var(--color-line)] bg-white px-8 py-[18px]">
        <div>
          <div className="font-display text-[26px] font-bold">
            {formatMoney(pkg.totalCents, pkg.currency)}
          </div>
          <div className="text-xs text-[var(--color-ink-soft)]">
            flat total for {travelers} traveler(s) · flights + hotel included
          </div>
        </div>
        <Link
          href={`/checkout/${params.searchId}/${pkg.id}`}
          className="btn-primary !px-8 !py-4 !text-base"
        >
          Book this trip →
        </Link>
      </div>
    </div>
  );
}
