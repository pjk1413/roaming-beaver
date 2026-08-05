# Deploy to Google Cloud Run (GitHub Actions)

This repo deploys `apps/web` to Cloud Run **only when you run the workflow manually**
(**Actions → Deploy to Cloud Run → Run workflow**). It does not deploy on push or merge.

Deploy updates the **container image** (and keeps the intended sizing flags:
`min-instances=0`, `cpu-boost`, concurrency 80). It does **not** set or overwrite
runtime environment variables or secrets — configure those on the Cloud Run
service (Console or `gcloud`), once.

---

## One-time setup (do this once)

### 1. Prerequisites

- A GCP project with billing enabled
- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) logged in (`gcloud auth login`)
- This GitHub repo (e.g. `your-org/travel_app`)
- A deploy service account key in GitHub secret `GCP_SA_KEY` (e.g. `deploy-google-cloud@…`)

### 2. Run the setup script (optional)

From the repo root:

```bash
chmod +x scripts/gcp-setup.sh
./scripts/gcp-setup.sh YOUR_GCP_PROJECT_ID us-central1
```

That enables APIs, creates Artifact Registry, and (if you use its defaults) a
deployer SA. If you already have a deploy SA and Artifact Registry, you can skip
this and just ensure the SA can push images and deploy Cloud Run.

### 3. Configure runtime env on Cloud Run

After the first successful image deploy (or on the service in Console), set the
variables the app needs — as plain env vars and/or Secret Manager references.
Typical names:

- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DUFFEL_API_KEY`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `RESEND_API_KEY`
- `OPENAI_API_KEY`
- `NODE_ENV=production`
- `ASSEMBLY_FEE_RATE` / `OPENAI_MODEL` (optional)

Later deploys leave these alone.

If you mount Secret Manager secrets, grant the Cloud Run runtime SA
(`PROJECT_NUMBER-compute@developer.gserviceaccount.com`)
`roles/secretmanager.secretAccessor`.

### 4. GitHub Actions secrets & variables

**Settings → Secrets and variables → Actions**

Used for **Docker build** (`NEXT_PUBLIC_*` are inlined at build time) and GCP auth — not for overwriting Cloud Run runtime config:

| Type | Name | Value |
|------|------|--------|
| Secret | `GCP_SA_KEY` | Full JSON key for the deploy service account |
| Secret | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (build-arg) |
| Secret | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (optional, build-arg) |
| Variable | `GCP_PROJECT_ID` | GCP project id (e.g. `kitchensinkworks`) |
| Variable | `GCP_REGION` | `us-central1` |
| Variable | `GCP_ARTIFACT_REPO` | `roaming-beaver` |
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
| Variable | `NEXT_PUBLIC_APP_URL` | set after first deploy (see below) |

### 5. First deploy

In GitHub: **Actions → Deploy to Cloud Run → Run workflow**.

After it succeeds:

1. Set runtime env/secrets on the Cloud Run service (step 3)
2. Set GitHub variable `NEXT_PUBLIC_APP_URL` to the service URL
3. In Supabase Auth → URL Configuration, add  
   `https://YOUR_CLOUD_RUN_URL/auth/callback`
4. Re-run the workflow so the Next.js **build** embeds the correct public URL

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
3. The Action builds the Docker image, pushes to Artifact Registry, updates the Cloud Run service image
4. Change runtime secrets/env in Cloud Run (or Secret Manager) whenever needed — no workflow change required. Changing baked-in `NEXT_PUBLIC_*` still needs a rebuild (update GitHub vars/secrets and re-run)

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
| `Permission denied` on Artifact Registry | Confirm deploy SA has `artifactregistry.admin` (or writer) |
| App missing env / DB errors | Set vars on the Cloud Run service; deploy does not manage them |
| Auth redirect to localhost | Set `NEXT_PUBLIC_APP_URL` GitHub variable and redeploy (rebuild) |
| Cold start feels slow | Expected with `min-instances=0`; cpu-boost is already on |
| Prisma / DB errors | Check `DATABASE_URL` on the service (use Supabase pooler or direct URI with SSL) |
