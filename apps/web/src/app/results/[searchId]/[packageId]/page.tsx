"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DestinationPackage, FlightLeg } from "@mystery-trips/types";
import { trpc } from "@/lib/trpc";
import {
  SLOT_META,
  formatDateRange,
  formatDurationMinutes,
  formatFlightTime,
  formatMoney,
  nightsBetween,
} from "@/lib/format";

function FlightLegRow({ leg }: { leg: FlightLeg }) {
  return (
    <div className="space-y-1.5 text-[15px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="font-mono">
          {leg.origin} → {leg.destination}
        </div>
        <div className="font-mono text-xs text-[var(--color-ink-soft)]">
          {leg.airline} {leg.flightNumber} ·{" "}
          {formatDurationMinutes(leg.durationMinutes)}
        </div>
      </div>
      <div className="grid gap-1 text-[var(--color-ink-soft)] sm:grid-cols-2">
        <div>
          <span className="font-mono text-xs font-bold uppercase tracking-[0.03em]">
            Departs
          </span>{" "}
          {formatFlightTime(leg.departAt)}
        </div>
        <div>
          <span className="font-mono text-xs font-bold uppercase tracking-[0.03em]">
            Arrives
          </span>{" "}
          {formatFlightTime(leg.arriveAt)}
        </div>
      </div>
    </div>
  );
}

function HotelMap({
  lat,
  lng,
  name,
}: {
  lat: number;
  lng: number;
  name: string;
}) {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  if (!hasCoords) return null;

  const delta = 0.012;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lng}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}@${lat},${lng}`)}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-line)]">
      <iframe
        title={`Map of ${name}`}
        src={embedSrc}
        className="h-[280px] w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="border-t border-[var(--color-line)] bg-white px-4 py-2.5 text-right">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-accent)]"
        >
          Open in Maps →
        </a>
      </div>
    </div>
  );
}

export default function TripDetailPage() {
  const params = useParams<{ searchId: string; packageId: string }>();
  const { data, isLoading } = trpc.search.get.useQuery({
    searchId: params.searchId,
  });
  const ensureItinerary = trpc.search.ensureItinerary.useMutation();
  const [origin, setOrigin] = useState("HOME");
  const [travelers, setTravelers] = useState(2);
  const [pkg, setPkg] = useState<DestinationPackage | null>(null);
  const itineraryRequested = useRef(false);

  useEffect(() => {
    const o = sessionStorage.getItem("rb_origin");
    const t = sessionStorage.getItem("rb_travelers");
    if (o) setOrigin(o.slice(0, 3).toUpperCase());
    if (t) setTravelers(Number(t) || 2);
  }, []);

  const fromQuery = useMemo(
    () => data?.packages.find((p) => p.id === params.packageId) ?? null,
    [data, params.packageId],
  );

  useEffect(() => {
    if (fromQuery) setPkg(fromQuery);
  }, [fromQuery]);

  // Generate itinerary lazily once (kept off the search hot path)
  useEffect(() => {
    if (!fromQuery || fromQuery.itinerary.length > 0) return;
    if (itineraryRequested.current) return;
    itineraryRequested.current = true;
    void ensureItinerary
      .mutateAsync({ packageId: fromQuery.id })
      .then((updated) => setPkg(updated))
      .catch(() => {
        /* keep empty itinerary */
      });
  }, [fromQuery, ensureItinerary]);

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
  const itineraryLoading =
    pkg.itinerary.length === 0 &&
    (ensureItinerary.isPending || !ensureItinerary.isError);
  const outboundStops = Math.max(0, pkg.flight.outbound.length - 1);
  const inboundStops = Math.max(0, pkg.flight.inbound.length - 1);

  const images = pkg.images ?? [];
  const hero =
    images.find((i) => i.kind === "hero") ?? images[0] ?? null;
  const gallery = images.filter((i) => i.url !== hero?.url);
  const heroUrl =
    hero?.url ??
    "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=80";
  const attributions = [
    ...new Set(
      images
        .map((i) => i.attribution)
        .filter((a): a is string => Boolean(a?.trim())),
    ),
  ];

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
        className="mb-3 flex h-[420px] w-full items-end rounded-[24px] bg-cover bg-center p-8"
        style={{
          backgroundImage: `linear-gradient(to top, oklch(22% 0.02 50 / 0.55), transparent 50%), url(${heroUrl})`,
        }}
      >
        <div className="text-white">
          <div className="font-display text-2xl font-bold">{pkg.city}</div>
          <div className="text-sm opacity-90">
            {pkg.hotel.starRating}★ {pkg.hotel.name}
          </div>
        </div>
      </div>
      {hero?.attribution ? (
        <p className="mb-4 font-mono text-[10px] text-[var(--color-ink-soft)]">
          {hero.sourcePageUrl ? (
            <a
              href={hero.sourcePageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--color-line)] underline-offset-2 hover:text-[var(--color-accent)]"
            >
              {hero.attribution}
            </a>
          ) : (
            hero.attribution
          )}
        </p>
      ) : (
        <div className="mb-4" />
      )}

      {gallery.length > 0 ? (
        <section className="mb-8">
          <h3 className="mb-3 font-display text-xl font-bold">Highlights</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.slice(0, 6).map((img) => (
              <figure key={img.url} className="overflow-hidden rounded-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbUrl || img.url}
                  alt={img.caption || `${pkg.city} highlight`}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
                {img.caption ? (
                  <figcaption className="mt-1 truncate px-0.5 font-mono text-[10px] text-[var(--color-ink-soft)]">
                    {img.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
          {attributions.length > 0 ? (
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-[var(--color-ink-soft)]">
              Photos: {attributions.join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}

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

      <section className="mb-10">
        <h3 className="mb-4 font-display text-xl font-bold">Your hotel</h3>
        <div className="mb-4">
          <div className="font-semibold text-lg">
            {pkg.hotel.starRating}★ {pkg.hotel.name}
          </div>
          {pkg.hotel.address ? (
            <p className="mt-1 text-[15px] text-[var(--color-ink-soft)]">
              {pkg.hotel.address}
            </p>
          ) : null}
          {pkg.hotel.distanceToBeachMeters != null ? (
            <p className="mt-1 font-mono text-xs text-[var(--color-ink-soft)]">
              ~{Math.round(pkg.hotel.distanceToBeachMeters / 80)} min walk to the
              beach
            </p>
          ) : null}
        </div>
        <HotelMap
          lat={pkg.hotel.lat}
          lng={pkg.hotel.lng}
          name={pkg.hotel.name}
        />
      </section>

      <section className="mb-10">
        <h3 className="mb-4 font-display text-xl font-bold">Flights</h3>
        <div className="space-y-5">
          <div>
            <div className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
              Outbound
              {outboundStops === 0
                ? " · direct"
                : ` · ${outboundStops} stop${outboundStops === 1 ? "" : "s"}`}
            </div>
            <div className="space-y-3">
              {pkg.flight.outbound.map((leg, i) => (
                <FlightLegRow key={`out-${i}-${leg.flightNumber}`} leg={leg} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-ink-soft)]">
              Return
              {inboundStops === 0
                ? " · direct"
                : ` · ${inboundStops} stop${inboundStops === 1 ? "" : "s"}`}
            </div>
            <div className="space-y-3">
              {pkg.flight.inbound.map((leg, i) => (
                <FlightLegRow key={`in-${i}-${leg.flightNumber}`} leg={leg} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="mb-10">
        <h3 className="mb-4 font-display text-xl font-bold">Itinerary</h3>
        {itineraryLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Drafting your day-by-day plan…
          </p>
        ) : pkg.itinerary.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Itinerary unavailable — you can still book the flights and hotel.
          </p>
        ) : (
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
        )}
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
