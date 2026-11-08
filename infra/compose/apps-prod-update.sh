#!/usr/bin/env bash
# Build the image and roll the stack on the apps-prod VM. deploy-apps-prod.sh starts this
# detached, because recreating the worker kills any bot shell that ran the deploy, and an
# interrupted `compose up` leaves containers created but never started.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

exec 9>.deploy-update.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 75; }
trap 'echo $? > .deploy-update.status' EXIT

sha="$(git rev-parse HEAD 2>/dev/null || echo local)"
export GIT_SHA="$sha"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-atlas-prod}"
export RAKAZO_IMAGE="${RAKAZO_IMAGE:-ghcr.io/naouflex/assistant/app}"
export RAKAZO_IMAGE_TAG="${RAKAZO_IMAGE_TAG:-local}"
# One image shared by api, worker, web, and migrate. Building all four
# compose services at once exports the same layers in parallel and stalls.
docker build -f infra/compose/Dockerfile --build-arg "GIT_SHA=${sha}" \
  -t "${RAKAZO_IMAGE}:${RAKAZO_IMAGE_TAG}" .
docker compose --env-file .env \
  -f infra/compose/docker-compose.prod.yml \
  -f infra/compose/docker-compose.prod.web-edge.yml \
  up -d --wait --pull never --no-build
echo "stack up"
