---
name: pi-cluster
description: >-
  Operate the Raspberry Pi nodes of the self-hosted computer cluster: find why
  a node went down, install the auto-recovery failsafe, and prepare a new node
  so it joins on first boot. Use when a Pi or cluster node is down, NotReady,
  or unreachable, when adding or flashing a node, or when runs time out because
  a computer is offline.
---

# Pi cluster

Node names, addresses, and credentials live on the maintainer's machine, never in this repo. Ask for them if they are not in your context.

## A node went down

Read the previous boot before rebooting anything else:

```bash
sudo journalctl -b -1 --no-pager | tail -40           # last minutes before it stopped
sudo journalctl -b -1 -k | grep -i -e brcmf -e oom -e voltage
```

- `brcmf ... status -110` then `DHCP lease lost`: the Wi-Fi firmware hung and the node lost the network while still running. The failsafe below recovers this.
- No log lines at all near the end: a hard freeze or power loss; the hardware watchdog covers freezes.

If the down node is the cluster's control plane, every run on the cluster fails until it is back.

## Failsafe (install on every node)

`install-failsafe.sh` sets up, idempotently:

- **Network watchdog** (`pi-netwatch`, every minute): after 3 failed checks it resets the Wi-Fi driver; after 8 it reboots, never within 15 minutes of boot, so a dead router cannot cause a reboot loop.
- **Wi-Fi power saving off**, the usual trigger of the firmware hang.
- **Hardware watchdog** through systemd: a frozen system reboots within about 15 seconds.

```bash
scp -r .agents/skills/pi-cluster <node>:/tmp/pi-cluster
ssh <node> 'sudo bash /tmp/pi-cluster/install-failsafe.sh'
```

Done when it prints `powersave=off watchdog=15s timer=active` for that node. Recovery actions are logged under `journalctl -t pi-netwatch`.

## A new node (it must work on first boot)

Before handing the boot media over, mount it and check every item. The node cannot be fixed remotely if one is missing:

- [ ] Network config with the Wi-Fi network and `optional: false` (or Ethernet), and a fresh cloud-init `instance_id` so the config is applied.
- [ ] User with the maintainer's SSH public key.
- [ ] Hostname set, unique in the cluster.
- [ ] Mesh VPN auth key and the k3s agent env (server URL, token, node name) present.
- [ ] First-boot unit that installs this failsafe.

Secrets (Wi-Fi key, join token, VPN key, device tokens) go only onto the media, never into the repo or a handover.

Done when the node shows `Ready` in `kubectl get nodes` and answers SSH.
