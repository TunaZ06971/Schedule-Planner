# Deployment Guide

This guide keeps production secrets and machine-specific values out of the repository. The public demo runs at <https://schedule.cks06971.com>, but the server address, SSH user, and real write token should stay outside git.

## Prerequisites

- A Linux server with Node.js 20+ and Caddy installed.
- DNS access for the public hostname.
- SSH access to the server.
- A long random write token, for example:

```bash
openssl rand -base64 24
```

## 1. DNS

Create an `A` or `CNAME` record for the hostname you want to serve.

```text
type    name        value
A       schedule    <server-public-ip>
```

Check that DNS resolves before continuing:

```bash
dig +short schedule.cks06971.com
```

The command should return the server address you configured.

## 2. Create The Service User

Run on the server:

```bash
sudo useradd --system --home /opt/schedule schedule || true
sudo mkdir -p /opt/schedule/data
sudo chown -R schedule:schedule /opt/schedule
```

## 3. Sync The Code

Run from your local checkout:

```bash
SERVER=deploy@example.com ./deploy/publish.sh
```

If the SSH account is already privileged, pass an empty sudo prefix:

```bash
SERVER=deploy@example.com REMOTE_SUDO= ./deploy/publish.sh
```

The publish script excludes `data/`, `.env*`, `node_modules/`, `.git/`, and scratch files, so server state and secrets are not overwritten by local files.

On the first sync, `schedule.service` may not exist yet; the script will skip the restart and health check.

## 4. Store Secrets Outside Git

Copy the example environment file and edit the real token on the server:

```bash
sudo cp /opt/schedule/deploy/schedule.env.example /etc/schedule.env
sudo nano /etc/schedule.env
sudo chmod 600 /etc/schedule.env
sudo chown root:root /etc/schedule.env
```

`WRITE_TOKEN` gates all write actions: marking tasks done, adding custom events, changing colors, and manual refreshes. The site can still expose public course deadlines without this token.

## 5. Install The systemd Unit

Run on the server after the first sync:

```bash
sudo cp /opt/schedule/deploy/schedule.service /etc/systemd/system/schedule.service
sudo systemctl daemon-reload
sudo systemctl enable --now schedule
sudo systemctl status schedule
```

The service listens on `127.0.0.1:8132`; Caddy is the public HTTPS entrypoint.

## 6. Configure Caddy

Copy the Caddy site file and reload Caddy:

```bash
sudo cp /opt/schedule/deploy/schedule.caddy /etc/caddy/sites/schedule.caddy
sudo systemctl reload caddy
```

If your server uses a different Caddy layout, copy the `schedule.cks06971.com { ... }` block from `deploy/schedule.caddy` into your main Caddyfile.

## 7. Verify

```bash
curl -sf https://schedule.cks06971.com/healthz
curl -s https://schedule.cks06971.com/api/data | head -c 200
```

Open <https://schedule.cks06971.com>, unlock with the write token, and try one write action such as checking off an assignment.

## Operations

```bash
sudo journalctl -u schedule -f
sudo systemctl restart schedule
sudo ls /opt/schedule/data/snapshots/
```

`data/state.json` contains personal state such as selected sections, completion marks, custom events, notes, private links, and color choices. Keep `data/` on the server and out of git.

## Refresh Frequency

Edit `REFRESH_MS` in `/etc/systemd/system/schedule.service`, then restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart schedule
```

Common values:

- Hourly: `3600000`
- Every 6 hours: `21600000`
- Daily: `86400000`

The server adds a small random delay before each scheduled scrape so it does not hit course websites exactly on the hour.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Site does not open | Firewall allows ports `80` and `443`; DNS points to the server. |
| `502` from Caddy | `sudo systemctl status schedule` and `sudo journalctl -u schedule -n 80`. |
| A course is stale | The course website may have changed. Run `npm run scrape` on the server and inspect logs. |
| Write actions reject the token | `/etc/schedule.env` has the intended `WRITE_TOKEN`; restart after edits. |
| Dates look one day off | `TZ=America/Los_Angeles` is still set in the systemd unit. |
