"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  MIN_TRIP_NIGHTS,
  calendarNights,
  minDepartDate,
  minReturnDate,
} from "@mystery-trips/types";
import { trpc } from "@/lib/trpc";
import { AirportAutocomplete } from "@/components/airport-autocomplete";

export default function SearchPage() {
  const router = useRouter();
  const startSearch = trpc.search.start.useMutation();
  const [homeAirport, setHomeAirport] = useState("");
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [flexible, setFlexible] = useState(false);
  const [travelers, setTravelers] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const earliestDepart = useMemo(() => minDepartDate(), []);
  const earliestReturn = departDate
    ? minReturnDate(departDate)
    : minReturnDate(earliestDepart);

  function onDepartChange(next: string) {
    setDepartDate(next);
    if (next) {
      const minRet = minReturnDate(next);
      setReturnDate((prev) => (!prev || prev < minRet ? minRet : prev));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!homeAirport.trim() || homeAirport.trim().length !== 3) {
      setError("Pick a home airport from the suggestions.");
      return;
    }
    if (!departDate) {
      setError("Pick a departure date.");
      return;
    }
    if (departDate < earliestDepart) {
      setError("Departure must be tomorrow or later.");
      return;
    }
    if (!returnDate) {
      setError("Pick a return date.");
      return;
    }
    if (calendarNights(departDate, returnDate) < MIN_TRIP_NIGHTS) {
      setError(
        `Trips need at least ${MIN_TRIP_NIGHTS} nights — pick a later return.`,
      );
      return;
    }

    setError(null);
    // Optimistic UI: transition immediately (§8.3)
    setSubmitting(true);

    const payload = {
      homeAirport: homeAirport.trim().toUpperCase(),
      departDate,
      returnDate,
      travelers,
    };

    sessionStorage.setItem("rb_origin", payload.homeAirport);
    sessionStorage.setItem("rb_last_search", JSON.stringify(payload));
    sessionStorage.setItem("rb_travelers", String(travelers));
    void flexible;

    try {
      const { searchId } = await startSearch.mutateAsync(payload);
      router.push(`/results/${searchId}`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Search failed");
    }
  }

  if (submitting) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-10 py-10 text-center animate-fade-in">
        <div className="mb-8 flex gap-3.5">
          <div className="dot-bounce h-[18px] w-[18px] rounded-full bg-[var(--color-hue-cheap)]" />
          <div
            className="dot-bounce h-[18px] w-[18px] rounded-full bg-[var(--color-hue-beach)]"
            style={{ animationDelay: "0.15s" }}
          />
          <div
            className="dot-bounce h-[18px] w-[18px] rounded-full bg-[var(--color-hue-exotic)]"
            style={{ animationDelay: "0.3s" }}
          />
        </div>
        <h2 className="mb-2.5 font-display text-[26px] font-bold">
          Matching you to three trips…
        </h2>
        <p className="m-0 text-[15px] text-[var(--color-ink-soft)]">
          Checking real flights and hotels for your dates, locking in a flat
          price.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[560px] px-8 pb-20 pt-12 animate-fade-up">
      <div className="mb-2.5 font-mono text-[13px] font-bold text-[var(--color-accent)]">
        GET STARTED
      </div>
      <h2 className="mb-8 font-display text-4xl font-bold tracking-[-0.02em]">
        A few details, then we go quiet and get to work.
      </h2>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div>
          <label className="field-label">Home airport</label>
          <AirportAutocomplete
            value={homeAirport}
            onChange={setHomeAirport}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Depart</label>
            <input
              type="date"
              className="field-input text-[15px]"
              value={departDate}
              min={earliestDepart}
              onChange={(e) => onDepartChange(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label">Return</label>
            <input
              type="date"
              className="field-input text-[15px]"
              value={returnDate}
              min={earliestReturn}
              onChange={(e) => setReturnDate(e.target.value)}
              required
            />
            <p className="mt-1.5 text-[12px] text-[var(--color-ink-soft)]">
              Minimum {MIN_TRIP_NIGHTS} nights
            </p>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={flexible}
            onChange={() => setFlexible((v) => !v)}
            className="h-[18px] w-[18px] accent-[var(--color-accent)]"
          />
          I&apos;m flexible ± 3 days if it unlocks a better trip
        </label>

        <div>
          <label className="field-label">Travelers</label>
          <div className="flex w-fit items-center gap-[18px] rounded-xl border-[1.5px] border-[var(--color-line-strong)] bg-white px-4 py-2">
            <button
              type="button"
              onClick={() => setTravelers((n) => Math.max(1, n - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[oklch(22%_0.02_50_/_0.2)] bg-white text-lg leading-none"
            >
              −
            </button>
            <span className="min-w-5 text-center font-mono text-lg font-bold">
              {travelers}
            </span>
            <button
              type="button"
              onClick={() => setTravelers((n) => Math.min(6, n + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[oklch(22%_0.02_50_/_0.2)] bg-white text-lg leading-none"
            >
              +
            </button>
          </div>
        </div>

        {error && (
          <div className="text-sm font-semibold text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary mt-2" disabled={startSearch.isPending}>
          Reveal my 3 trips →
        </button>
      </form>
    </div>
  );
}
