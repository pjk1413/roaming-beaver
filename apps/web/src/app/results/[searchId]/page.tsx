"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DestinationPackage, DestinationSlot } from "@mystery-trips/types";
import { trpc } from "@/lib/trpc";
import { SLOT_META, formatMoney, nightsBetween } from "@/lib/format";
import { FlapText } from "@/components/flap-text";

const SLOTS: DestinationSlot[] = [
  "BUDGET_GETAWAY",
  "BEACH_ESCAPE",
  "EXOTIC_ADVENTURE",
];

const MAX_RESHUFFLES = 2;

type SlotState =
  | { status: "loading" }
  | { status: "ready"; pkg: DestinationPackage }
  | { status: "error"; message: string };

function isMockPackage(pkg: DestinationPackage): boolean {
  return (
    pkg.flight.duffelOfferId.startsWith("off_mock_") ||
    pkg.hotel.duffelRateId.startsWith("rate_mock_")
  );
}

function isLiveFlightsMockHotels(pkg: DestinationPackage): boolean {
  return (
    !pkg.flight.duffelOfferId.startsWith("off_mock_") &&
    pkg.hotel.duffelRateId.startsWith("rate_mock_")
  );
}

export default function ResultsPage() {
  const params = useParams<{ searchId: string }>();
  const runSearch = trpc.search.run.useMutation();
  const reshuffle = trpc.search.reshuffle.useMutation();
  const utils = trpc.useUtils();

  const [slots, setSlots] = useState<Record<DestinationSlot, SlotState>>({
    BUDGET_GETAWAY: { status: "loading" },
    BEACH_ESCAPE: { status: "loading" },
    EXOTIC_ADVENTURE: { status: "loading" },
  });
  const [done, setDone] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [reshufflesUsed, setReshufflesUsed] = useState(0);
  const [origin, setOrigin] = useState("HOME");
  const [travelers, setTravelers] = useState(2);
  const [fatal, setFatal] = useState<string | null>(null);
  const [mockTravel, setMockTravel] = useState(false);
  const [partialMock, setPartialMock] = useState(false);

  const applyPackageRef = useRef((pkg: DestinationPackage) => {
    setSlots((prev) => ({
      ...prev,
      [pkg.slot]: { status: "ready", pkg },
    }));
    if (isMockPackage(pkg)) setMockTravel(true);
    if (isLiveFlightsMockHotels(pkg)) setPartialMock(true);
  });
  const applyErrorRef = useRef((slot: DestinationSlot, message: string) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { status: "error", message },
    }));
  });

  useEffect(() => {
    const stored = sessionStorage.getItem("rb_origin");
    if (stored) setOrigin(stored.slice(0, 3).toUpperCase());
    const t = sessionStorage.getItem("rb_travelers");
    if (t) setTravelers(Number(t) || 2);
  }, []);

  // Kick matcher once, then poll status every 2s — no NDJSON stream reconnect loop.
  useEffect(() => {
    let cancelled = false;
    const searchId = params.searchId;
    const seen = new Set<string>();

    async function tick() {
      const status = await utils.search.status.fetch({ searchId });
      if (!status || cancelled) return false;

      for (const pkg of status.packages) {
        if (seen.has(pkg.id)) continue;
        seen.add(pkg.id);
        applyPackageRef.current(pkg);
      }
      for (const [slot, message] of Object.entries(status.slotErrors)) {
        applyErrorRef.current(slot as DestinationSlot, message);
      }

      if (status.status === "COMPLETE" || status.status === "FAILED") {
        setDone(true);
        if (status.packages.length === 0) {
          setFatal("No packages found for these dates.");
        }
        return true;
      }
      return false;
    }

    async function run() {
      try {
        await runSearch.mutateAsync({ searchId });
      } catch {
        /* already running / raced */
      }
      if (cancelled) return;

      if (await tick()) return;

      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled) return;
        try {
          if (await tick()) return;
        } catch (err) {
          console.warn("[results] status poll failed:", err);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per searchId
  }, [params.searchId]);

  const canReshuffle =
    done && reshufflesUsed < MAX_RESHUFFLES && !reshuffle.isPending;

  async function onReshuffle() {
    if (!canReshuffle) return;
    setOpened({});
    try {
      const result = await reshuffle.mutateAsync({
        searchId: params.searchId,
      });
      setReshufflesUsed(result.reshufflesUsed);
      for (const pkg of result.packages) {
        applyPackageRef.current(pkg);
      }
      setDone(true);
    } catch (err) {
      setDone(true);
      setFatal(
        err instanceof Error ? err.message : "Could not find more trips.",
      );
    }
  }

  if (fatal) {
    return (
      <div className="mx-auto max-w-lg px-8 py-20 text-center">
        <p className="mb-4">{fatal}</p>
        <Link href="/search" className="btn-primary inline-block">
          Start over
        </Link>
      </div>
    );
  }

  const readyCount = SLOTS.filter((s) => slots[s].status === "ready").length;

  return (
    <div className="mx-auto max-w-[1100px] px-8 pb-[100px] pt-12 text-center animate-fade-up">
      {mockTravel && (
        <div className="mb-6 rounded-xl border border-[var(--color-line-strong)] bg-white px-4 py-3 text-left text-sm text-[var(--color-ink-soft)]">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.04em] text-[var(--color-accent)]">
            {partialMock ? "Partial mock data" : "Mock travel data"}
          </span>
          <span className="mt-1 block">
            {partialMock ? (
              <>
                Hotels (and cars, if needed) are simulated — Duffel Stays isn’t
                enabled on this API key. Flights are live. Contact Duffel sales
                to enable Stays for real hotel rates.
              </>
            ) : (
              <>
                No real Duffel key — prices and flights are simulated. Set{" "}
                <code className="font-mono text-[12px]">DUFFEL_API_KEY</code> in{" "}
                <code className="font-mono text-[12px]">apps/web/.env</code> for
                live offers.
              </>
            )}
          </span>
        </div>
      )}
      <div className="mb-2.5 font-mono text-[13px] font-bold text-[var(--color-accent)]">
        FROM {origin}
      </div>
      <h2 className="mb-3 font-display text-[34px] font-bold tracking-[-0.02em]">
        {done && readyCount === 3
          ? reshufflesUsed > 0
            ? "Three more options, ready to open."
            : "Three trips, matched and ready."
          : "Matching your trips…"}
      </h2>
      <p className="mb-12 text-base text-[var(--color-ink-soft)]">
        {done
          ? "Tap an envelope to see what’s inside."
          : "Cards appear as each package locks in — no waiting on the slowest."}
      </p>

      <div className="grid gap-7 md:grid-cols-3">
        {SLOTS.map((slot, i) => {
          const state = slots[slot];
          if (state.status === "loading") {
            return <SkeletonCard key={slot} slot={slot} />;
          }
          if (state.status === "error") {
            return (
              <ErrorCard key={slot} slot={slot} message={state.message} />
            );
          }
          return (
            <EnvelopeCard
              key={state.pkg.id}
              pkg={state.pkg}
              searchId={params.searchId}
              origin={origin}
              travelers={travelers}
              delay={`${i * 0.15}s`}
              opened={!!opened[state.pkg.id]}
              onOpen={() =>
                setOpened((prev) => ({ ...prev, [state.pkg.id]: true }))
              }
            />
          );
        })}
      </div>

      <div className="mt-9">
        {canReshuffle ? (
          <button
            type="button"
            onClick={onReshuffle}
            disabled={reshuffle.isPending}
            className="btn-secondary"
          >
            {reshuffle.isPending
              ? "Finding 3 more…"
              : `Not feeling these? Show 3 more (${MAX_RESHUFFLES - reshufflesUsed} left)`}
          </button>
        ) : done && reshufflesUsed >= MAX_RESHUFFLES ? (
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            That’s all the options for these dates — pick your favorite above.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonCard({ slot }: { slot: DestinationSlot }) {
  const meta = SLOT_META[slot];
  return (
    <div className="min-h-[340px]">
      <div
        className="flex h-full min-h-[340px] flex-col items-center justify-center gap-3.5 rounded-[24px] opacity-90"
        style={{ background: meta.hue }}
      >
        <div className="h-16 w-16 animate-pulse rounded-full border-[2.5px] border-white/50" />
        <div className="font-display text-[19px] font-bold text-white">
          {meta.label}
        </div>
        <div className="flex gap-2">
          <div className="dot-bounce h-2.5 w-2.5 rounded-full bg-white" />
          <div
            className="dot-bounce h-2.5 w-2.5 rounded-full bg-white"
            style={{ animationDelay: "0.15s" }}
          />
          <div
            className="dot-bounce h-2.5 w-2.5 rounded-full bg-white"
            style={{ animationDelay: "0.3s" }}
          />
        </div>
        <div className="text-[13px] font-semibold text-white/85">Searching…</div>
      </div>
    </div>
  );
}

function ErrorCard({
  slot,
  message,
}: {
  slot: DestinationSlot;
  message: string;
}) {
  const meta = SLOT_META[slot];
  return (
    <div className="min-h-[340px]">
      <div className="flex h-full min-h-[340px] flex-col justify-center rounded-[24px] bg-white px-6 py-[30px] text-left shadow-[0_12px_32px_oklch(22%_0.02_50_/_0.1)]">
        <div
          className="mb-2.5 font-mono text-xs font-bold uppercase tracking-[0.04em]"
          style={{ color: meta.hue }}
        >
          {meta.label}
        </div>
        <h3 className="mb-2 font-display text-xl font-bold">Unavailable</h3>
        <p className="text-sm text-[var(--color-ink-soft)]">{message}</p>
      </div>
    </div>
  );
}

function EnvelopeCard({
  pkg,
  searchId,
  origin,
  travelers,
  delay,
  opened,
  onOpen,
}: {
  pkg: DestinationPackage;
  searchId: string;
  origin: string;
  travelers: number;
  delay: string;
  opened: boolean;
  onOpen: () => void;
}) {
  const meta = SLOT_META[pkg.slot];
  const nights = nightsBetween(pkg.hotel.checkIn, pkg.hotel.checkOut);
  const perPersonCents = Math.round(pkg.totalCents / Math.max(1, travelers));

  if (!opened) {
    return (
      <div className="min-h-[340px]">
        <button
          type="button"
          onClick={onOpen}
          className="animate-drift flex h-full min-h-[340px] w-full flex-col items-center justify-center gap-3.5 rounded-[24px] shadow-[0_12px_32px_oklch(22%_0.02_50_/_0.15)] transition hover:scale-[1.03]"
          style={{ background: meta.hue }}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-[2.5px] border-white font-display text-[26px] font-bold text-white">
            {meta.badge}
          </div>
          <div className="font-display text-[19px] font-bold text-white">
            {meta.label}
          </div>
          <div className="text-[13px] font-semibold text-white/85">
            Tap to reveal
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[340px]">
      <div
        className="animate-flip-reveal flex h-full flex-col rounded-[24px] bg-white px-6 py-[30px] text-left shadow-[0_12px_32px_oklch(22%_0.02_50_/_0.1)]"
        style={{ animationDelay: delay }}
      >
        <div
          className="mb-2.5 font-mono text-xs font-bold uppercase tracking-[0.04em]"
          style={{ color: meta.hue }}
        >
          {meta.label}
        </div>
        <FlapText text={pkg.city} className="mb-1" />
        <div className="mb-[18px] text-sm text-[var(--color-ink-soft)]">
          {pkg.country} · {nights} nights
        </div>
        <div className="mb-[18px] font-mono text-xs text-[var(--color-ink-soft)]">
          {origin} → {pkg.airportCode}
        </div>
        <div className="mb-1 font-display text-[32px] font-bold">
          {formatMoney(perPersonCents, pkg.currency)}
        </div>
        <div className="mb-6 text-[13px] text-[var(--color-ink-soft)]">
          per person, all-in flat price
        </div>
        <Link
          href={`/results/${searchId}/${pkg.id}`}
          className="mt-auto block rounded-full px-3.5 py-3.5 text-center font-display text-[15px] font-semibold text-white"
          style={{ background: meta.hue }}
        >
          View trip →
        </Link>
      </div>
    </div>
  );
}
