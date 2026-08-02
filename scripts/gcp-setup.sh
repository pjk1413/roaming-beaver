#!/usr/bin/env bash
# One-time Google Cloud setup for GitHub Actions → Cloud Run.
#
# Usage:
#   ./scripts/gcp-setup.sh YOUR_GCP_PROJECT_ID [REGION] [GITHUB_ORG_OR_USER/REPO]
#
# Example:
#   ./scripts/gcp-setup.sh roaming-beaver-prod us-central1 pjk1413/travel_app
#
# Prerequisites: gcloud CLI authenticated with Owner/Editor on the project.
set -euo pipefail

PROJECT_ID="${1:?Usage: $0 PROJECT_ID [REGION] [GITHUB_REPO]}"
REGION="${2:-us-central1}"
GITHUB_REPO="${3:-}"
SERVICE="roaming-beaver-web"
REPO_NAME="roaming-beaver"
SA_NAME="github-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Enabling APIs on ${PROJECT_ID}…"
gcloud config set project "${PROJECT_ID}"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com

echo "==> Artifact Registry repo (${REPO_NAME})…"
if ! gcloud artifacts repositories describe "${REPO_NAME}" --location="${REGION}" &>/dev/null; then
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Roaming Beaver images"
fi

echo "==> Deployer service account…"
if ! gcloud iam service-accounts describe "${SA_EMAIL}" &>/dev/null; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="GitHub Actions Cloud Run deploy"
fi

for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor
do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

echo "==> Creating Secret Manager secrets (empty placeholders — set values next)…"
SECRETS=(
  DATABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  DUFFEL_API_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  RESEND_API_KEY
  OPENAI_API_KEY
)
for S in "${SECRETS[@]}"; do
  if ! gcloud secrets describe "${S}" &>/dev/null; then
    echo -n "REPLACE_ME" | gcloud secrets create "${S}" --data-file=-
  fi
  gcloud secrets add-iam-policy-binding "${S}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null || true
done

# Cloud Run runtime SA also needs secret access (default compute SA)
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for S in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "${S}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null || true
done

KEY_HINT="gcloud iam service-accounts keys create ./gcp-sa-key.json --iam-account=${SA_EMAIL}"

cat <<EOF

============================================================
GCP setup complete. Configure GitHub next.

Create a service account key (once), then store it in GitHub:
  ${KEY_HINT}
  # paste the JSON into GitHub secret GCP_SA_KEY, then delete the local file

Repo → Settings → Secrets and variables → Actions

Secrets:
  GCP_PROJECT_ID                  = ${PROJECT_ID}
  GCP_SA_KEY                      = (full JSON from the key file above)
  NEXT_PUBLIC_SUPABASE_ANON_KEY   = (from Supabase)
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = (from Stripe, optional)

Variables:
  GCP_REGION                      = ${REGION}
  GCP_ARTIFACT_REPO               = ${REPO_NAME}
  NEXT_PUBLIC_SUPABASE_URL        = https://xxxx.supabase.co
  NEXT_PUBLIC_APP_URL             = (Cloud Run URL after first deploy)
  ASSEMBLY_FEE_RATE               = 0.08
  OPENAI_MODEL                    = gpt-4o-mini

Fill Secret Manager values (example):
  printf '%s' 'postgresql://...' | gcloud secrets versions add DATABASE_URL --data-file=-
  printf '%s' 'sk_live_...' | gcloud secrets versions add STRIPE_SECRET_KEY --data-file=-
  # …same for DUFFEL_API_KEY, OPENAI_API_KEY, RESEND_API_KEY, etc.

Then run the workflow manually: Actions → Deploy to Cloud Run → Run workflow.
Docs: docs/DEPLOY.md
============================================================
EOF
