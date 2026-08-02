# Mystery Trips — Architecture

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **App**: Next.js 15 (App Router, `output: 'standalone'`) in `apps/web`
- **API**: tRPC in `packages/api`, mounted at `app/api/trpc/[trpc]/route.ts`
- **Streaming search**: `GET /api/search/[searchId]/stream` (NDJSON) + polling fallback
- **DB**: PostgreSQL + Prisma (`packages/db`)
  - **Dev**: local Postgres (`DATABASE_URL`)
  - **Prod**: Supabase Postgres (`DATABASE_URL` connection string)
- **Auth**: Supabase Auth (email/password + OAuth). App `User` rows use
  `auth.users.id` as primary key and are upserted on session.
  *(Prompt default was Better Auth; project uses Supabase per product decision.)*
- **Payments**: Stripe Payment Intents (customer charge)
- **Travel supply**:
  - **Flights**: Duffel Air (bookings funded via Duffel Balance)
  - **Hotels**: LiteAPI / Nuitée Connect (account card or credit on file)
- **Email**: Resend
- **Itineraries**: OpenAI Chat Completions API
  *(Prompt default was Claude; project uses OpenAI per product decision.)*
- **Hosting**: Google Cloud Run, `min-instances=0`, `--cpu-boost`, concurrency ≈ 80

## Auth flow

1. Browser uses `@supabase/ssr` client for sign-in / OAuth.
2. OAuth returns to `/auth/callback` which exchanges the code for a session.
3. Middleware refreshes the session cookie on each request.
4. tRPC context reads the user from request cookies and syncs `public.User`.

## Destinations & profiles

- Inventory is `Destination` rows with `profileStatus` (`DRAFT` →
  `PENDING_REVIEW` → `APPROVED` / `REJECTED`).
- Only **APPROVED** cities are usable as home origins *and* matching
  destinations (known-cities-only, both directions).
- Each destination has one or more `StayArea`s (named neighborhoods + lat/lng +
  blurb + nested `DestinationActivity` rows; capped by `MAX_STAY_AREAS`,
  default 5). Matching hotel-searches across those areas for affordability /
  variety; beach-walk checks use any StayArea within walk distance. There is
  no separate `beachLat` column.
- Profile pipeline: research (Wikivoyage/Wikipedia + multiple stay-area
  searches with corroboration) → OpenAI JSON (multiple stay areas +
  `vibeTags`) → Nominatim geocode each area → destination photo gallery
  (Wikipedia/Wikimedia Commons first; Unsplash fill when
  `UNSPLASH_ACCESS_KEY` is set; capped by `MAX_DESTINATION_IMAGES`) →
  `PENDING_REVIEW`. Neighborhood research uses **Tavily** web search when
  `TAVILY_API_KEY` is set (real SERP snippets); otherwise DuckDuckGo Instant
  Answer (often thin) plus Wikipedia/Wikivoyage. CLI:
  `pnpm profile-destination -- --airport AUS` or `--drafts`. Admin review at
  `/admin/destinations` (gated by `ADMIN_EMAILS`).
  Trip detail loads `DestinationImage` rows live by `destinationId` (hero +
  gallery with attribution).
- Matching slots read `vibeTags` (`BEACH`, `EXOTIC`, …); legacy `isBeach` /
  `isExoticShortlist` are kept in sync as mirrors.
- **Discovery Jobs** (Cloud Run Jobs, not Services — long-running):
  - `pnpm discover-destinations` — monthly: web/LLM candidates → airport
    dedup → OurAirports quality gate (`medium_airport`+) → Duffel access
    sample → viability gate → DRAFT + profile (capped by
    `MAX_NEW_DESTINATIONS_PER_RUN`; overflow → `DiscoveryWaitlist`).
  - `pnpm refresh-destination-profiles` — quarterly: re-profile APPROVED
    rows older than `PROFILE_REFRESH_AFTER_DAYS` into `PENDING_REVIEW`.
- Matching excludes destinations within `MIN_DESTINATION_DISTANCE_MILES`
  (default 250) of the origin airport using `Destination.airportLat/Lng`
  (falls back to the unfiltered slot pool if the filter empties it).
- Adding a city can still be manual (admin form). Automated *which cities*
  comes from the discover job above.

## Progressive search (§8.2)

1. `search.start` creates a `TripSearch` row immediately (`PENDING`).
2. Client navigates to results and opens `/api/search/:id/stream`.
3. Server runs all three slots in parallel. Each slot:
   - Quotes flights for candidates (concurrency pool)
   - Hotel-quotes only the cheapest-flight shortlist (~5)
   - Emits the single cheapest complete package as soon as ready
4. UI unlocks each card independently as packages stream in.
5. “Show 3 more” calls `search.reshuffle` — next city per slot, excluding
   destinations already shown (up to 2 reshuffles).
6. Itineraries are generated on the trip detail page (`search.ensureItinerary`),
   not during matching.
7. If streaming is buffered by a proxy, client falls back to `search.run` +
   `search.status` polling (~1s).

## Optimistic UI (§8.3)

- Search submit and checkout submit flip UI to a processing state immediately.
- Booking confirmation (“You’re going to …”) only renders after server-side
  supplier booking success — never optimistically.

## Lazy initialization (§8.1)

Prisma, flight/hotel suppliers, Stripe, OpenAI, and Resend clients are constructed
on first use (module-level singletons), not at import/boot. Cloud Run marks instances
ready when the HTTP port listens — keeping startup cheap under scale-to-zero.

## Packages

```
apps/web          UI + tRPC route + search stream + webhooks
packages/types    Shared Zod schemas
packages/db       Prisma schema, client, seed
packages/api      tRPC router, matching engine, integrations
packages/config   Shared tsconfig
```

## Checkout sequencing

1. Re-validate flight offer (Duffel) + hotel rate (LiteAPI prebook)
2. Charge customer via Stripe (full bundle total including assembly fee — one charge)
3. On payment success, book **hotel first** (LiteAPI), then **flight** (Duffel Balance)
4. If the flight fails after the hotel succeeded: cancel the hotel booking, refund
   Stripe, mark order `FAILED`/`REFUNDED`. If hotel cancel itself errors, log
   `CRITICAL OPS` — money may have moved with a stranded hotel booking.
5. On success: persist supplier IDs, email confirmation, show confirmation page

## Ops notes

- **Duffel Balance** must be pre-funded by the business (working capital), separate from
  Stripe revenue.
- **LiteAPI** production requires its own funding arrangement (card on file / credit) —
  confirm settlement model in LiteAPI’s payments docs before going live. Code only
  calls `createStayBooking`; LiteAPI settles supplier payment on their end.
- **DB connections under bursty scale-out**: currently direct Cloud Run → Postgres (no
  pooler). Fine at low traffic; revisit if concurrent instance count risks connection
  limits.
- Deploy: `./scripts/deploy-cloudrun.sh PROJECT_ID REGION` (see Dockerfile).
