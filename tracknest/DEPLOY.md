# Deploying TrackNest

One small Linux server runs everything with Docker Compose:

| Service | What it does |
|---|---|
| `caddy` | HTTPS (certificates issued and renewed automatically), forwards to the app |
| `app` | The Next.js server (not reachable from outside except through Caddy) |
| `db` | PostgreSQL 16 |
| `migrate` | Applies database migrations, then exits; runs on every start |
| `cron` | Calls the alert job every hour |
| `backup` | Daily database dump + uploaded files archive in `deploy/backups/`, kept 14 days |

## What you need

- A VPS with 2 GB RAM and 25+ GB disk, Ubuntu 24.04. For India-based users: DigitalOcean (Bangalore) or AWS Lightsail (Mumbai), about US$5–12/month. Hetzner is cheaper but hosted in Europe/Singapore.
- A domain or subdomain, e.g. `assets.yourcompany.com`, with an **A record** pointing to the server's IP.
- An SMTP account for email, e.g. Amazon SES (Mumbai region), Brevo or Zoho. Set up SPF/DKIM for your sending domain as the provider describes, or alerts will land in spam.

## First install

```bash
# On the server, as a user with sudo
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

git clone <your repository URL> tracknest && cd tracknest
cp deploy/env.example .env.production
nano .env.production        # fill in DOMAIN, APP_URL, the three secrets, SMTP
docker compose --env-file .env.production up -d --build
```

Open `https://YOUR_DOMAIN/signup` and create your organization. The first account is the owner; invite everyone else from **More → Team and invites**.

Check it is healthy:

```bash
docker compose --env-file .env.production ps        # app should say "healthy", migrate "exited (0)"
curl https://YOUR_DOMAIN/api/health                 # {"ok":true}
```

Point a free uptime monitor (UptimeRobot, Better Stack) at `https://YOUR_DOMAIN/api/health`.

## Sign in with Google (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a project, set up the **OAuth consent screen** (External, app name "TrackNest", your support email), then **Create credentials → OAuth client ID → Web application**.
2. Add the authorized redirect URI `https://YOUR_DOMAIN/auth/google/callback` (it must match `APP_URL` exactly).
3. Put the client ID and secret in `.env.production` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then `docker compose --env-file .env.production up -d`.

The sign-in and invite pages then show a Google button. Google only signs in people who already have an account with the same email, or who were invited at that email; it never creates organizations on its own.

## Updating

```bash
git pull
docker compose --env-file .env.production up -d --build
```

Migrations run automatically before the new app version starts. History tables are append-only, so no migration ever rewrites custody history.

## Backups

Every day the `backup` service writes `deploy/backups/db-<date>.dump` and `uploads-<date>.tar.gz` and deletes files older than `BACKUP_KEEP_DAYS`.

These are on the same server, which doesn't protect against losing the server. Copy them off it daily, e.g. to Cloudflare R2 (10 GB free) with [rclone](https://rclone.org/s3/#cloudflare-r2):

```bash
# after `rclone config` creates a remote called r2
crontab -e
30 3 * * * rclone copy ~/tracknest/deploy/backups r2:tracknest-backups --max-age 48h
```

### Restoring

On the same or a new server, with `.env.production` in place:

```bash
docker compose --env-file .env.production down
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production exec db psql -U tracknest -d postgres \
  -c "DROP DATABASE IF EXISTS tracknest WITH (FORCE)" -c "CREATE DATABASE tracknest OWNER tracknest"
docker compose --env-file .env.production exec db psql -U tracknest -d postgres \
  -c "DO \$\$ BEGIN CREATE ROLE tracknest_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$"
docker compose --env-file .env.production exec -T db pg_restore -U tracknest -d tracknest < deploy/backups/db-YYYY-MM-DD-HHMM.dump

# uploaded photos and documents
docker run --rm -v tracknest_uploads:/u -v "$PWD/deploy/backups:/b" alpine \
  sh -c "tar -xzf /b/uploads-YYYY-MM-DD-HHMM.tar.gz -C /u && chown -R 1000:1000 /u"

docker compose --env-file .env.production up -d --build
```

Practise this once on a spare server before you need it.

## Trying the stack on your own machine

Set `DOMAIN=localhost` and `APP_URL=https://localhost` in `.env.production`. Caddy then uses its own local certificate, which your browser won't trust until you run `docker compose exec caddy caddy trust` or accept the warning.

## Security notes

- The app connects as `tracknest_app`, which is not the table owner, so PostgreSQL row-level security separates organizations even if a query forgets to.
- Only Caddy is exposed (ports 80 and 443). Postgres and the app have no published ports.
- Caddy discards any `X-Forwarded-For` sent by clients, so sign-in rate limiting sees real IPs. Don't put another proxy in front without configuring `trusted_proxies`.
- Keep `.env.production` readable only by you: `chmod 600 .env.production`.
