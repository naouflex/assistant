#!/usr/bin/env bash
# Publish Atlas on the shared apps-prod VM behind rechat-caddy.
#
#   infra/compose/deploy-apps-prod.sh upload
#   infra/compose/deploy-apps-prod.sh env
#   infra/compose/deploy-apps-prod.sh caddy
#   infra/compose/deploy-apps-prod.sh update
#   infra/compose/deploy-apps-prod.sh verify
#
# Does not print secret values. Never uploads the local .env.
set -euo pipefail

INSTANCE="${INSTANCE:-apps-prod}"
ZONE="${ZONE:-europe-west1-b}"
REMOTE_DIR="${REMOTE_DIR:-atlas}"
HOST="${ATLAS_HOST:-atlas.naoufel.io}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ssh_vm() {
  gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="$1"
}

cmd_upload() {
  local tmp
  tmp="$(mktemp)"
  tar -C "$ROOT" \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude data \
    --exclude 'apps/desktop/dist' \
    --exclude 'apps/desktop/out' \
    --exclude 'apps/mobile/android' \
    --exclude 'apps/mobile/ios' \
    --exclude 'apps/mobile/.expo' \
    --exclude '*.log' \
    -czf "$tmp" .
  gcloud compute scp --zone="$ZONE" "$tmp" "${INSTANCE}:/tmp/atlas-src.tgz"
  rm -f "$tmp"
  ssh_vm "mkdir -p ~/${REMOTE_DIR} && tar -C ~/${REMOTE_DIR} -xzf /tmp/atlas-src.tgz && rm -f /tmp/atlas-src.tgz"
  echo "uploaded to ~/${REMOTE_DIR}"
}

cmd_env() {
  local allow
  allow="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"
  ssh_vm "$(cat <<EOF
set -euo pipefail
cd "\$HOME/${REMOTE_DIR}"
if [[ -f .env ]]; then
  echo "remote .env already exists; left unchanged"
  exit 0
fi
secret() { openssl rand -base64 36 | tr -d '/+=' | head -c 48; }
umask 077
cat > .env <<ENV
NODE_ENV=production
ATLAS_HOST=${HOST}
BETTER_AUTH_URL=https://${HOST}
WEB_ORIGIN=https://${HOST}
API_URL=https://${HOST}
ATLAS_DEPLOY_DIR=\${HOME}/${REMOTE_DIR}
ATLAS_IMAGE_TAG=local
POSTGRES_USER=atlas
POSTGRES_DB=atlas
POSTGRES_PASSWORD=\$(secret)
POSTGRES_APP_PASSWORD=\$(secret)
BETTER_AUTH_SECRET=\$(secret)
ENCRYPTION_KEY=\$(secret)
SCREEN_PROXY_SECRET=\$(secret)
SIGNUPS_ENABLED=true
SIGNUP_ALLOWLIST=${allow}
SANDBOX_PROVIDER=e2b
TRUSTED_PROXIES=caddy
ATLAS_API_MEMORY_LIMIT=3g
ATLAS_WORKER_MEMORY_LIMIT=3g
AUTH_PASSWORD_ENABLED=true
ENV
chmod 600 .env
echo "wrote remote .env (secrets not shown)"
EOF
)"
}

cmd_caddy() {
  ssh_vm "$(cat <<EOF
set -euo pipefail
file="\$HOME/rechat/caddy/Caddyfile"
if grep -q '^${HOST} {' "\$file"; then
  echo "caddy site already present"
else
  cp -a "\$file" "\${file}.bak-atlas-\$(date +%Y%m%d%H%M%S)"
  cat >> "\$file" <<'SITE'

${HOST} {
    # Compressing text/event-stream buffers live thread events until the next one arrives.
    encode {
        zstd
        gzip
        match {
            header Content-Type text/html*
            header Content-Type text/css*
            header Content-Type text/plain*
            header Content-Type text/javascript*
            header Content-Type application/javascript*
            header Content-Type application/json*
            header Content-Type image/svg+xml*
            header Content-Type application/wasm*
        }
    }
    handle /health {
        reverse_proxy atlas-api:3100
    }
    handle /api/* {
        reverse_proxy atlas-api:3100
    }
    handle /rpc/* {
        reverse_proxy atlas-api:3100
    }
    handle {
        reverse_proxy atlas-web:5173
    }
}
SITE
  echo "appended ${HOST} site"
fi
docker exec rechat-caddy-1 caddy reload --config /etc/caddy/Caddyfile
echo "caddy reloaded"
EOF
)"
}

cmd_update() {
  # Runs detached on the VM so the rollout finishes even if this caller dies mid-way
  # (a bot's shell is killed when the worker it runs in is recreated).
  ssh_vm "$(cat <<EOF
set -euo pipefail
cd "\$HOME/${REMOTE_DIR}"
if ! flock -n .deploy-update.lock true; then
  echo "another deploy is running; follow it with: tail -f ~/${REMOTE_DIR}/.deploy-update.log" >&2
  exit 75
fi
rm -f .deploy-update.status
: > .deploy-update.log
setsid nohup bash infra/compose/apps-prod-update.sh > .deploy-update.log 2>&1 < /dev/null &
pid=\$!
tail -n +1 -f --pid="\$pid" .deploy-update.log
exit "\$(cat .deploy-update.status 2>/dev/null || echo 1)"
EOF
)"
}

cmd_verify() {
  curl --fail --silent --show-error "https://${HOST}/health"
  echo
}

case "${1:-}" in
  upload) cmd_upload ;;
  env) cmd_env ;;
  caddy) cmd_caddy ;;
  update) cmd_update ;;
  verify) cmd_verify ;;
  *)
    echo "usage: $0 upload|env|caddy|update|verify" >&2
    exit 2
    ;;
esac
