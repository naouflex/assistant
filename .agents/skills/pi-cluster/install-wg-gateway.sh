#!/usr/bin/env bash
# Run on the k3s control-plane node only. wg-atlas config and keys are never in git.
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "run as root (sudo bash $0)" >&2
  exit 1
fi

if ! command -v wg-quick >/dev/null; then
  echo "install wireguard-tools first" >&2
  exit 1
fi

if ! k3s kubectl get nodes -l node-role.kubernetes.io/control-plane --no-headers 2>/dev/null | grep -q .; then
  echo "no local control-plane node in kubectl; is this the k3s server?" >&2
  exit 1
fi

HOSTNAME="$(hostname)"
if ! k3s kubectl get node "$HOSTNAME" -o jsonpath='{.metadata.labels.node-role\.kubernetes\.io/control-plane}' 2>/dev/null | grep -q .; then
  echo "this host ($HOSTNAME) is not the control plane; install the failsafe on workers instead" >&2
  exit 1
fi

CONF=/etc/wireguard/wg-atlas.conf
if [[ ! -f "$CONF" ]]; then
  echo "missing $CONF — copy wg-atlas.conf and atlas.key from the maintainer, not from git" >&2
  exit 1
fi
if [[ ! -f /etc/wireguard/atlas.key ]]; then
  echo "missing /etc/wireguard/atlas.key" >&2
  exit 1
fi

FORWARD_UP='iptables -I FORWARD 1 -i wg-atlas -j ACCEPT; iptables -I FORWARD 2 -o wg-atlas -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT'
FORWARD_DOWN='iptables -D FORWARD -i wg-atlas -j ACCEPT; iptables -D FORWARD -o wg-atlas -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT'

if ! grep -q 'FORWARD 1 -i wg-atlas' "$CONF"; then
  if grep -q '^PostUp = ' "$CONF"; then
    sed -i "s|^PostUp = \\(.*\\)|PostUp = \\1; $FORWARD_UP|" "$CONF"
  else
    echo "PostUp = sysctl -qw net.ipv4.ip_forward=1; $FORWARD_UP" >>"$CONF"
  fi
fi
if ! grep -q 'FORWARD.*wg-atlas' "$CONF" || ! grep -q '^PostDown = ' "$CONF"; then
  if grep -q '^PostDown = ' "$CONF"; then
    sed -i "s|^PostDown = \\(.*\\)|PostDown = $FORWARD_DOWN; \\1|" "$CONF"
  else
    echo "PostDown = $FORWARD_DOWN" >>"$CONF"
  fi
fi

sysctl -qw net.ipv4.ip_forward=1
grep -q '^net.ipv4.ip_forward' /etc/sysctl.d/*.conf 2>/dev/null ||
  echo 'net.ipv4.ip_forward=1' >/etc/sysctl.d/99-atlas-wg.conf

systemctl enable wg-quick@wg-atlas
wg-quick down wg-atlas 2>/dev/null || true
systemctl restart wg-quick@wg-atlas

if ip link show wg-atlas >/dev/null 2>&1; then
  echo "wg-atlas=up control-plane=$HOSTNAME ip_forward=$(sysctl -n net.ipv4.ip_forward)"
else
  echo "wg-atlas failed to start; check journalctl -u wg-quick@wg-atlas" >&2
  exit 1
fi
