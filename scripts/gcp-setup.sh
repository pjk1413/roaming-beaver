#!/usr/bin/env bash
# One-time Google Cloud setup for GitHub Actions → Cloud Run.
#
# Usage:
#   ./scripts/gcp-setup.sh YOUR_GCP_PROJECT_ID [REGION] [GITHUB_ORG_OR_USER/REPO]
#
# Example:
#   ./scripts/gcp-setup.sh mystery-trips-prod us-central1 myuser/travel_app
#
# Prerequisites: gcloud CLI authenticated with Owner/Editor on the project.
set -euo pipefail

PROJECT_ID="${1:?Usage: $0 PROJECT_ID [REGION] [GITHUB_REPO]}"
REGION="${2:-us-central1}"
GITHUB_REPO="${3:-}"
SERVICE="mystery-trips-web"
REPO_NAME="mystery-trips"
SA_NAME="github-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"

echo "==> Enabling APIs on ${PROJECT_ID}…"
gcloud config set project "${PROJECT_ID}"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com

echo "==> Artifact Registry repo (${REPO_NAME})…"
if ! gcloud artifacts repositories describe "${REPO_NAME}" --location="${REGION}" &>/dev/null; then
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Mystery Trips / Roaming Beaver images"
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

echo "==> Workload Identity Federation pool…"
if ! gcloud iam workload-identity-pools describe "${POOL_NAME}" --location=global &>/dev/null; then
  gcloud iam workload-identity-pools create "${POOL_NAME}" \
    --location=global \
    --display-name="GitHub Actions"
fi

POOL_ID="$(gcloud iam workload-identity-pools describe "${POOL_NAME}" \
  --location=global --format='value(name)')"

if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" \
  --location=global --workload-identity-pool="${POOL_NAME}" &>/dev/null; then
  if [[ -z "${GITHUB_REPO}" ]]; then
    echo "ERROR: first-time provider create needs GITHUB_REPO (org/repo)." >&2
    echo "Re-run: $0 ${PROJECT_ID} ${REGION} your-org/travel_app" >&2
    exit 1
  fi
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
    --location=global \
    --workload-identity-pool="${POOL_NAME}" \
    --display-name="GitHub" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
fi

PROVIDER_ID="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" \
  --location=global --workload-identity-pool="${POOL_NAME}" --format='value(name)')"

if [[ -n "${GITHUB_REPO}" ]]; then
  gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
    --quiet >/dev/null
fi

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

cat <<EOF

============================================================
GCP setup complete. Configure GitHub next.

Repo → Settings → Secrets and variables → Actions

Secrets:
  GCP_PROJECT_ID                  = ${PROJECT_ID}
  GCP_SERVICE_ACCOUNT             = ${SA_EMAIL}
  GCP_WORKLOAD_IDENTITY_PROVIDER  = ${PROVIDER_ID}
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
