#!/bin/bash
set -e
cd "$(dirname "$0")"
command -v iw >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y -qq iw >/dev/null
install -m 755 pi-netwatch /usr/local/sbin/pi-netwatch

cat > /etc/systemd/system/pi-netwatch.service <<'EOF'
[Unit]
Description=Recover lost network

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pi-netwatch
EOF
cat > /etc/systemd/system/pi-netwatch.timer <<'EOF'
[Unit]
Description=Check network every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/wifi-powersave-off.service <<'EOF'
[Unit]
Description=Disable Wi-Fi power saving
After=network-pre.target

[Service]
Type=oneshot
ExecStartPre=/bin/sh -c 'for i in $(seq 30); do [ -e /sys/class/net/wlan0 ] \&\& exit 0; sleep 1; done'
ExecStart=/usr/sbin/iw dev wlan0 set power_save off

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/watchdog.conf <<'EOF'
[Manager]
RuntimeWatchdogSec=15s
RebootWatchdogSec=2min
EOF

rm -rf /etc/systemd/system/sys-subsystem-net-devices-wlan0.device.wants
systemctl daemon-reload
systemctl daemon-reexec
systemctl enable --now pi-netwatch.timer wifi-powersave-off.service
echo "$(hostname): powersave=$(iw dev wlan0 get power_save | awk '{print $3}') watchdog=$(systemctl show -p RuntimeWatchdogUSec --value) timer=$(systemctl is-active pi-netwatch.timer)"
