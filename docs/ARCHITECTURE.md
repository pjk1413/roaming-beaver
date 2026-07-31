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
- **Travel supply**: Duffel Flights / Stays / Cars; bookings funded via Duffel Balance
- **Email**: Resend
- **Itineraries**: OpenAI Chat Completions API
  *(Prompt default was Claude; project uses OpenAI per product decision.)*
- **Hosting**: Google Cloud Run, `min-instances=0`, `--cpu-boost`, concurrency ≈ 80

## Auth flow

1. Browser uses `@supabase/ssr` client for sign-in / OAuth.
2. OAuth returns to `/auth/callback` which exchanges the code for a session.
3. Middleware refreshes the session cookie on each request.
4. tRPC context reads the user from request cookies and syncs `public.User`.

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
- Booking confirmation (“You’re going to …”) only renders after server-side Duffel
  booking success — never optimistically.

## Lazy initialization (§8.1)

Prisma, Duffel supplier, Stripe, OpenAI, and Resend clients are constructed on first
use (module-level singletons), not at import/boot. Cloud Run marks instances ready when
the HTTP port listens — keeping startup cheap under scale-to-zero.

## Packages

```
apps/web          UI + tRPC route + search stream + webhooks
packages/types    Shared Zod schemas
packages/db       Prisma schema, client, seed
packages/api      tRPC router, matching engine, integrations
packages/config   Shared tsconfig
```

## Checkout sequencing

1. Re-validate Duffel offers
2. Charge customer via Stripe (full bundle total including assembly fee)
3. On payment success, book via Duffel Balance (flight → stay → car)
4. On any Duffel failure after Stripe success: refund + mark order `FAILED`/`REFUNDED`
5. On success: persist supplier IDs, email confirmation, show confirmation page

## Ops notes

- **Duffel Balance** must be pre-funded by the business (working capital), separate from
  Stripe revenue.
- **DB connections under bursty scale-out**: currently direct Cloud Run → Postgres (no
  pooler). Fine at low traffic; revisit if concurrent instance count risks connection
  limits.
- Deploy: `./scripts/deploy-cloudrun.sh PROJECT_ID REGION` (see Dockerfile).
