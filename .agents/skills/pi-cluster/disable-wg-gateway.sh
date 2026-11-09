#!/usr/bin/env bash
# Run on worker nodes that previously hosted wg-atlas so prod routes only through the control plane.
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "run as root (sudo bash $0)" >&2
  exit 1
fi

systemctl disable --now wg-quick@wg-atlas 2>/dev/null || true
wg-quick down wg-atlas 2>/dev/null || true
echo "wg-atlas=disabled on $(hostname)"
