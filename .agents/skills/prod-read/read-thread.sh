#!/usr/bin/env bash
# Print a dev bot's latest main-thread messages (decrypted) and recent runs from prod. Read-only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOOK="$ROOT/../atlas-dev-handover/hook.mjs"
ZONE="${ATLAS_GCP_ZONE:-europe-west1-b}"
VM="${ATLAS_GCP_VM:-apps-prod}"
API="${ATLAS_API_CONTAINER:-atlas-prod-api-1}"
BOT="${ATLAS_BOT_NAME:-Atlas Dev}"
TAKE="${ATLAS_TAKE:-10}"

gcloud compute scp "$HOOK" "$ROOT/read-thread.mts" "$VM:/tmp/" --zone "$ZONE" >/dev/null

gcloud compute ssh "$VM" --zone "$ZONE" --command "
  C=$API
  docker cp /tmp/hook.mjs \$C:/app/apps/api/hook.mjs
  docker cp /tmp/read-thread.mts \$C:/app/apps/api/read-thread.mts
  docker exec -e ATLAS_BOT_NAME='$BOT' -e ATLAS_TAKE='$TAKE' -w /app/apps/api \$C \\
    node --no-warnings --experimental-transform-types --conditions=development \\
    --import ./hook.mjs read-thread.mts
  docker exec -u 0 \$C rm -f /app/apps/api/hook.mjs /app/apps/api/read-thread.mts
  rm -f /tmp/hook.mjs /tmp/read-thread.mts
"
