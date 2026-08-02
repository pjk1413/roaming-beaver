"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  fetchAirportByCode,
  formatAirport,
  formatAirportDetail,
  searchAirportsClient,
  type Airport,
} from "@/lib/airports";

type Props = {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  required?: boolean;
};

export function AirportAutocomplete({
  value,
  onChange,
  placeholder = "City or code — e.g. AUS, Chicago",
  required,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [results, setResults] = useState<Airport[]>([]);
  const [selected, setSelected] = useState<Airport | null>(null);
  const [loading, setLoading] = useState(false);

  // Resolve committed IATA → label
  useEffect(() => {
    if (!value) {
      setSelected(null);
      if (!open) setQuery("");
      return;
    }
    if (selected?.code === value) {
      setQuery(formatAirport(selected));
      return;
    }
    let cancelled = false;
    void fetchAirportByCode(value).then((hit) => {
      if (cancelled || !hit) return;
      setSelected(hit);
      setQuery(formatAirport(hit));
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Debounced remote search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // Don't search while showing the committed label
    if (selected && q === formatAirport(selected)) {
      setResults([]);
      return;
    }
    if (q.length < 1) {
      setResults([]);
      return;
    }

    const ac = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      void searchAirportsClient(q, ac.signal)
        .then((airports) => {
          setResults(airports);
          setHighlight(0);
        })
        .catch(() => {
          /* aborted */
        })
        .finally(() => setLoading(false));
    }, 180);

    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, open, selected]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        if (selected) setQuery(formatAirport(selected));
        else {
          setQuery("");
          onChange("");
        }
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [selected, onChange]);

  function pick(airport: Airport) {
    setSelected(airport);
    onChange(airport.code);
    setQuery(formatAirport(airport));
    setOpen(false);
    setResults([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      if (query.trim()) setOpen(true);
      return;
    }
    if (!open || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[highlight];
      if (hit) pick(hit);
    } else if (e.key === "Escape") {
      setOpen(false);
      if (selected) setQuery(formatAirport(selected));
    }
  }

  const showEmpty =
    open &&
    !loading &&
    query.trim().length >= 2 &&
    results.length === 0 &&
    !(selected && query === formatAirport(selected));

  return (
    <div ref={rootRef} className="relative">
      <input
        className="field-input"
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          if (selected && next !== formatAirport(selected)) {
            setSelected(null);
            onChange("");
          }
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && results[highlight]
            ? `${listId}-${results[highlight]!.code}`
            : undefined
        }
        required={required}
      />

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-[var(--color-line-strong)] bg-white py-1.5 text-left shadow-[0_12px_32px_oklch(22%_0.02_50_/_0.12)]"
        >
          {results.map((airport, i) => {
            const active = i === highlight;
            return (
              <li key={airport.code} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${airport.code}`}
                  role="option"
                  aria-selected={active}
                  className={`flex w-full items-baseline gap-3 px-3.5 py-2.5 text-left transition ${
                    active
                      ? "bg-[var(--color-cream)]"
                      : "hover:bg-[var(--color-foam)]"
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(airport)}
                >
                  <span className="w-10 shrink-0 font-mono text-sm font-bold text-[var(--color-accent)]">
                    {airport.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[15px] font-semibold leading-tight">
                      {airport.city}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--color-ink-soft)]">
                      {formatAirportDetail(airport)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && loading && results.length === 0 && query.trim().length >= 1 && (
        <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-[var(--color-line-strong)] bg-white px-3.5 py-3 text-left text-sm text-[var(--color-ink-soft)] shadow-[0_12px_32px_oklch(22%_0.02_50_/_0.12)]">
          Searching airports…
        </div>
      )}

      {showEmpty && (
        <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-[var(--color-line-strong)] bg-white px-3.5 py-3 text-left text-sm text-[var(--color-ink-soft)] shadow-[0_12px_32px_oklch(22%_0.02_50_/_0.12)]">
          No match for “{query.trim()}”. Origins are limited to approved cities.
        </div>
      )}
    </div>
  );
}
