#!/usr/bin/env bash
# Post a handover markdown file to a dev bot's main thread in prod and enqueue the run.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: send-handover.sh HANDOVER.md" >&2
  echo "  ATLAS_BOT_NAME='Atlas Dev'  (default) or Strike Dev, etc." >&2
  exit 2
fi

HANDOVER="$(realpath "$1")"
[[ -s "$HANDOVER" ]] || { echo "missing or empty: $HANDOVER" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
ZONE="${ATLAS_GCP_ZONE:-europe-west1-b}"
VM="${ATLAS_GCP_VM:-apps-prod}"
API="${ATLAS_API_CONTAINER:-atlas-prod-api-1}"
BOT="${ATLAS_BOT_NAME:-Atlas Dev}"

gcloud compute scp \
  "$ROOT/hook.mjs" \
  "$ROOT/post-handover.mts" \
  "$HANDOVER" \
  "$VM:/tmp/handover.md" \
  --zone "$ZONE" >/dev/null

R=$(gcloud compute ssh "$VM" --zone "$ZONE" --command "
  set -e
  C=$API
  docker cp /tmp/hook.mjs \$C:/app/apps/api/hook.mjs
  docker cp /tmp/post-handover.mts \$C:/app/apps/api/post-handover.mts
  docker cp /tmp/handover.md \$C:/tmp/handover.md
  docker exec -e ATLAS_BOT_NAME='$BOT' -w /app/apps/api \$C \\
    node --experimental-transform-types --conditions=development \\
    --import ./hook.mjs post-handover.mts /tmp/handover.md 2>&1 | tee /tmp/post-handover.out
  docker exec -u 0 \$C rm -f /app/apps/api/hook.mjs /app/apps/api/post-handover.mts /tmp/handover.md
  rm -f /tmp/hook.mjs /tmp/post-handover.mts /tmp/handover.md
  grep '^RUN' /tmp/post-handover.out | cut -d' ' -f2
" 2>&1 | tail -1)

[[ -n "$R" ]] || { echo "post failed (no RUN id)" >&2; exit 1; }

gcloud compute ssh "$VM" --zone "$ZONE" --command \
  "docker exec atlas-prod-postgres-1 psql -U atlas -d atlas -Atc \"select graphile_worker.add_job('run.continue', json_build_object('runId','$R'), job_key => 'run:$R')\"" \
  >/dev/null

sleep 8
STATUS=$(gcloud compute ssh "$VM" --zone "$ZONE" --command \
  "docker exec atlas-prod-postgres-1 psql -U atlas -d atlas -Atc \"select status from runs where id='$R'\"" 2>&1 | tail -1)

echo "bot=$BOT run=$R status=$STATUS"
