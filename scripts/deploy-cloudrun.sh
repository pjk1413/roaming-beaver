#!/usr/bin/env bash
# Manual deploy (without GitHub Actions). Prefer the Actions workflow for prod.
#
# Usage:
#   ./scripts/deploy-cloudrun.sh PROJECT_ID [REGION]
set -euo pipefail

PROJECT_ID="${1:?project id required}"
REGION="${2:-us-central1}"
SERVICE="roaming-beaver-web"
REPO="roaming-beaver"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

gcloud config set project "${PROJECT_ID}"
gcloud services enable artifactregistry.googleapis.com --quiet
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

if ! gcloud artifacts repositories describe "${REPO}" --location="${REGION}" &>/dev/null; then
  echo "Creating Artifact Registry repo ${REPO} in ${REGION}…"
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Roaming Beaver images"
fi

echo "Building ${IMAGE}:manual…"
docker build \
  --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
  --build-arg "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" \
  -t "${IMAGE}:manual" \
  .

docker push "${IMAGE}:manual"

echo "Deploying ${SERVICE} (min-instances=0, cpu-boost, concurrency=80)…"
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --image "${IMAGE}:manual" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --concurrency 80 \
  --cpu 1 \
  --memory 1Gi \
  --min-instances 0 \
  --max-instances 20 \
  --cpu-boost \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,DUFFEL_API_KEY=DUFFEL_API_KEY:latest,STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest,STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest,RESEND_API_KEY=RESEND_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY:latest,NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:latest"

echo "Done. Service URL:"
gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)'
