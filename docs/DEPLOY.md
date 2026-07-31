# Deploy to Google Cloud Run (GitHub Actions)

This repo deploys `apps/web` to Cloud Run on every push to `main`/`master`
(and via **Actions → Deploy to Cloud Run → Run workflow**).

Settings match the product architecture: **`min-instances=0`**, **`--cpu-boost`**,
**concurrency 80**.

---

## One-time setup (do this once)

### 1. Prerequisites

- A GCP project with billing enabled
- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) logged in (`gcloud auth login`)
- This GitHub repo (e.g. `your-org/travel_app`)

### 2. Run the setup script

From the repo root:

```bash
chmod +x scripts/gcp-setup.sh
./scripts/gcp-setup.sh YOUR_GCP_PROJECT_ID us-central1 your-org/travel_app
```

That enables APIs, creates Artifact Registry, a deployer service account,
Workload Identity Federation (keyless GitHub → GCP), and Secret Manager placeholders.

### 3. Put real values in Secret Manager

```bash
printf '%s' 'postgresql://USER:PASS@HOST:5432/postgres?sslmode=require' \
  | gcloud secrets versions add DATABASE_URL --data-file=-

printf '%s' 'your-supabase-service-role' \
  | gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=-

printf '%s' 'your-supabase-anon-key' \
  | gcloud secrets versions add NEXT_PUBLIC_SUPABASE_ANON_KEY --data-file=-

printf '%s' 'pk_live_or_test_...' \
  | gcloud secrets versions add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY --data-file=-

printf '%s' 'sk_...' | gcloud secrets versions add STRIPE_SECRET_KEY --data-file=-
printf '%s' 'whsec_...' | gcloud secrets versions add STRIPE_WEBHOOK_SECRET --data-file=-
printf '%s' 'duffel_...' | gcloud secrets versions add DUFFEL_API_KEY --data-file=-
printf '%s' 're_...' | gcloud secrets versions add RESEND_API_KEY --data-file=-
printf '%s' 'sk-...' | gcloud secrets versions add OPENAI_API_KEY --data-file=-
```

Use your **Supabase Postgres connection string** for `DATABASE_URL` in production.

### 4. GitHub Actions secrets & variables

**Settings → Secrets and variables → Actions**

| Type | Name | Value |
|------|------|--------|
| Secret | `GCP_PROJECT_ID` | GCP project id |
| Secret | `GCP_SERVICE_ACCOUNT` | `github-deploy@PROJECT.iam.gserviceaccount.com` |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER` | printed by setup script (`projects/…/providers/github-provider`) |
| Secret | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (also used as Docker build-arg) |
| Secret | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (optional) |
| Variable | `GCP_REGION` | `us-central1` |
| Variable | `GCP_ARTIFACT_REPO` | `mystery-trips` |
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
| Variable | `NEXT_PUBLIC_APP_URL` | set after first deploy (see below) |
| Variable | `ASSEMBLY_FEE_RATE` | `0.08` |
| Variable | `OPENAI_MODEL` | `gpt-4o-mini` |

### 5. First deploy

Push to `main`/`master`, or run the workflow manually.

After it succeeds, copy the Cloud Run URL from the job summary, then:

1. Set GitHub variable `NEXT_PUBLIC_APP_URL` to that URL (e.g. `https://mystery-trips-web-xxxxx-uc.a.run.app`)
2. In Supabase Auth → URL Configuration, add  
   `https://YOUR_CLOUD_RUN_URL/auth/callback`
3. Re-run the workflow so the Next.js build embeds the correct public URL

### 6. Database schema on prod

Against Supabase Postgres (once):

```bash
DATABASE_URL='postgresql://…' pnpm db:push
DATABASE_URL='postgresql://…' pnpm db:seed
```

---

## Ongoing process

1. Merge / push to `main` (or `master`)
2. GitHub Action builds the Docker image, pushes to Artifact Registry, deploys Cloud Run
3. Update Secret Manager when keys rotate — **no redeploy needed** for secret-only changes unless you also change `NEXT_PUBLIC_*` (those require a rebuild)

Manual deploy without GitHub:

```bash
./scripts/deploy-cloudrun.sh YOUR_GCP_PROJECT_ID us-central1
```

---

## How auth works (no JSON keys)

GitHub Actions uses **Workload Identity Federation**: the workflow requests an OIDC
token; GCP trusts GitHub for your repo only and mints short-lived credentials for
`github-deploy@…`. No long-lived service-account key in GitHub secrets.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Permission denied` on Artifact Registry | Re-run `gcp-setup.sh`; confirm SA has `artifactregistry.writer` |
| `secret not found` on deploy | Create/fill the secret names listed above |
| Auth redirect to localhost | Set `NEXT_PUBLIC_APP_URL` and redeploy |
| Cold start feels slow | Expected with `min-instances=0`; cpu-boost is already on |
| Prisma / DB errors | Check `DATABASE_URL` (use Supabase pooler or direct URI with SSL) |
