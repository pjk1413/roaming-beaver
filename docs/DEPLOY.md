# Deploy to Google Cloud Run (GitHub Actions)

This repo deploys `apps/web` to Cloud Run **only when you run the workflow manually**
(**Actions → Deploy to Cloud Run → Run workflow**). It does not deploy on push or merge.

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
./scripts/gcp-setup.sh YOUR_GCP_PROJECT_ID us-central1
```

That enables APIs, creates Artifact Registry, a deployer service account
(`github-deploy@…`), and Secret Manager placeholders.

Then create a JSON key and store it in GitHub:

```bash
gcloud iam service-accounts keys create ./gcp-sa-key.json \
  --iam-account=github-deploy@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com
# Paste the file contents into GitHub secret GCP_SA_KEY, then delete the local file
rm ./gcp-sa-key.json
```

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
| Secret | `GCP_SA_KEY` | Full JSON key for the deploy service account |
| Secret | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (also used as Docker build-arg) |
| Secret | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (optional) |
| Variable | `GCP_PROJECT_ID` | GCP project id (e.g. `roaming-beaver`) |
| Variable | `GCP_REGION` | `us-central1` |
| Variable | `GCP_ARTIFACT_REPO` | `roaming-beaver` |
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
| Variable | `NEXT_PUBLIC_APP_URL` | set after first deploy (see below) |
| Variable | `ASSEMBLY_FEE_RATE` | `0.08` |
| Variable | `OPENAI_MODEL` | `gpt-4o-mini` |

### 5. First deploy

In GitHub: **Actions → Deploy to Cloud Run → Run workflow**.

After it succeeds, copy the Cloud Run URL from the job summary, then:

1. Set GitHub variable `NEXT_PUBLIC_APP_URL` to that URL (e.g. `https://roaming-beaver-web-xxxxx-uc.a.run.app`)
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

1. Merge your changes to the branch you want to deploy from (usually `main`)
2. **Actions → Deploy to Cloud Run → Run workflow** (pick the branch)
3. The Action builds the Docker image, pushes to Artifact Registry, deploys Cloud Run
4. Update Secret Manager when keys rotate — **no redeploy needed** for secret-only changes unless you also change `NEXT_PUBLIC_*` (those require a rebuild)

Manual deploy without GitHub:

```bash
./scripts/deploy-cloudrun.sh YOUR_GCP_PROJECT_ID us-central1
```

---

## How auth works

GitHub Actions authenticates with a **service account JSON key** stored as the
`GCP_SA_KEY` repository secret. Create a key for your deploy SA in GCP
(IAM → Service accounts → Keys), paste the full JSON into that secret, and keep
it rotated. Prefer restricting the SA to Artifact Registry + Cloud Run deploy
roles only.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Repository "…" not found` on docker push | `GCP_PROJECT_ID` must be the **GCP project id** (e.g. `kitchensinkworks`), not the GitHub repo name. It must match the project in `GCP_SA_KEY`. |
| `Permission denied on secret` for `…-compute@…` | Grant Secret Accessor to the Cloud Run runtime SA (see below) |
| `Permission denied` on Artifact Registry | Re-run `gcp-setup.sh`; confirm SA has `artifactregistry.admin` |
| `secret not found` on deploy | Create/fill the secret names listed above |
| Auth redirect to localhost | Set `NEXT_PUBLIC_APP_URL` and redeploy |
| Cold start feels slow | Expected with `min-instances=0`; cpu-boost is already on |
| Prisma / DB errors | Check `DATABASE_URL` (use Supabase pooler or direct URI with SSL) |

Grant Cloud Run access to secrets (one-time, as project Owner/Editor):

```bash
gcloud projects add-iam-policy-binding kitchensinkworks \
  --member="serviceAccount:783693588605-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```
