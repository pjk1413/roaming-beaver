# Mystery Trips

Surprise trip packages: budget getaway, beach escape, exotic adventure — one all-in price.

## Stack

pnpm + Turborepo · Next.js 15 · tRPC · Prisma · **Supabase Auth** · Stripe · Duffel · Resend · OpenAI · Cloud Run

**Database**: local Postgres in development; Supabase Postgres in production (`DATABASE_URL`).

**Auth**: Supabase Auth (email/password + OAuth providers such as Google/GitHub).

**Hosting**: Google Cloud Run (`min-instances=0`, cpu-boost). See `Dockerfile`, `scripts/gcp-setup.sh`, and **[docs/DEPLOY.md](docs/DEPLOY.md)** for GitHub Actions deploy.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Env
cp .env.example .env
cp .env apps/web/.env && cp .env packages/db/.env

# Required for auth: create a free Supabase project and set
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
# In Dashboard → Authentication → URL Configuration, add:
#   http://localhost:3000/auth/callback
# Enable Google/GitHub under Authentication → Providers as needed.

# Optional travel/payment keys — without them, mocks/fallbacks are used.

# 3. Local database (your own Postgres — set DATABASE_URL accordingly)
pnpm db:push
pnpm db:seed

# 4. Dev
pnpm --filter @mystery-trips/web dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production database

Point `DATABASE_URL` at your Supabase Postgres connection string
(Dashboard → Project Settings → Database). Run `pnpm db:push` or migrate against it.
Auth always uses the same Supabase project’s Auth API.

## Workspace

```
apps/web            Next.js UI + API routes
packages/api        tRPC router, matching engine, integrations
packages/db         Prisma schema + seed
packages/types      Shared Zod schemas
packages/config     Shared TS config
docs/               Product + architecture
```

## Checkout sequencing

1. Revalidate Duffel offers  
2. Charge via Stripe (full total incl. assembly fee)  
3. Book via Duffel Balance  
4. On booking failure → Stripe refund + order `FAILED`/`REFUNDED`  
5. On success → confirmation email + account history  

Assembly fee: `ASSEMBLY_FEE_RATE` (clamped 5–10%, default 8%).
