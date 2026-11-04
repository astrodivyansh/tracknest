# Deploying TrackNest on a Windows office machine

## Quick start: everything in Docker Desktop (no PostgreSQL install)

The main `docker-compose.yml` runs the whole stack, database included, and works as-is on Docker Desktop for Windows.

1. Install **Docker Desktop** (WSL 2 option) and **Git for Windows**, then in Git Bash:

   ```bash
   git clone https://github.com/astrodivyansh/tracknest.git tracknest-repo
   cd tracknest-repo/tracknest
   cp deploy/env.example .env.production
   notepad .env.production
   ```

2. Set `DOMAIN` and `APP_URL` (`localhost` / `https://localhost` to try it on this PC, or the machine's fixed office IP, e.g. `192.168.1.50` / `https://192.168.1.50`), and fill the three secrets with `openssl rand -hex 24`. Delete the `PG_MAJOR` line.
3. Start it:

   ```bash
   docker compose --env-file .env.production up -d --build
   docker compose --env-file .env.production ps    # app "healthy", migrate "exited (0)"
   ```

4. Open `https://localhost/signup` (or `https://<IP>/signup`), accept the certificate warning and create your organization.

For other office PCs, also do steps 1–3 of the preparation below (fixed IP, no sleep), step 7 (firewall) and step 9 (trust the certificate). The database lives in the Docker volume `tracknest_pgdata`; daily backups still land in `deploy\backups\`. Updating: `git pull` then the same `up -d --build` command.

The rest of this guide is the alternative setup where PostgreSQL is installed on Windows itself.

## Alternative: PostgreSQL installed on Windows

PostgreSQL runs on Windows itself. Everything else runs in Docker Desktop, via `docker-compose.windows.yml`:

| Service | What it does |
|---|---|
| `caddy` | HTTPS on the machine's office IP (its own certificate), forwards to the app |
| `app` | The Next.js server |
| `migrate` | Applies database migrations to the Windows PostgreSQL, then exits; runs on every start |
| `cron` | Calls the alert job every hour |
| `backup` | Daily database dump + uploaded files archive in `deploy\backups\`, kept 14 days |

HTTPS is required even inside the office: the sign-in cookie is HTTPS-only in production, and the label scanner needs HTTPS to use the camera.

## 1. Prepare the machine

1. Windows 10/11 Pro or Windows Server, 8 GB+ RAM.
2. Ask IT for a **fixed IP** (DHCP reservation), e.g. `192.168.1.50`. Check it with `ipconfig`.
3. **Settings → System → Power → Sleep: Never.**
4. Install **Git for Windows** (https://git-scm.com).
5. Install **Docker Desktop** with the WSL 2 option. In its Settings → General tick **Start Docker Desktop when you sign in**.

## 2. Install PostgreSQL on Windows

1. Download the Windows installer from https://www.postgresql.org/download/windows/ (EDB), version 17 or newer.
2. Run it with the defaults: port `5432`, set a password for the `postgres` superuser and keep it safe. Stack Builder at the end is not needed.
3. Make sure PostgreSQL is **not** reachable from the office network: in *Windows Defender Firewall → Advanced settings → Inbound Rules*, there must be no rule allowing port 5432. Docker reaches it from the same machine.

## 3. Download the code (Git Bash)

```bash
cd /c
git clone https://github.com/astrodivyansh/tracknest.git tracknest-repo
cd tracknest-repo/tracknest
```

## 4. Create the settings file

Create three secrets (run three times, copy each):

```bash
openssl rand -hex 24
```

```bash
cp deploy/env.example .env.production
notepad .env.production
```

```
DOMAIN=192.168.1.50
APP_URL=https://192.168.1.50
POSTGRES_PASSWORD=<secret 1>     # password of the "tracknest" database owner created in step 5
APP_DB_PASSWORD=<secret 2>
CRON_SECRET=<secret 3>
PG_MAJOR=17                      # the PostgreSQL version you installed (17, 18…)
SMTP_URL=
MAIL_FROM="TrackNest <alerts@yourcompany.com>"
BACKUP_KEEP_DAYS=14
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Leave Google sign-in empty: Google does not accept a bare IP as a redirect address.

## 5. Create the database

Open **SQL Shell (psql)** from the Start menu, press Enter through the prompts and log in with the `postgres` password. Then, with secret 1 in place of `SECRET1`:

```sql
CREATE ROLE tracknest LOGIN CREATEROLE PASSWORD 'SECRET1';
CREATE DATABASE tracknest OWNER tracknest;
\q
```

`tracknest` owns the tables. The migrations create a second role, `tracknest_app`, which the app logs in as. It is not the table owner, so row-level security keeps organizations apart.

## 6. Start TrackNest

```bash
docker compose -f docker-compose.windows.yml --env-file .env.production up -d --build
docker compose -f docker-compose.windows.yml --env-file .env.production ps
```

The first build takes 5–10 minutes. `app` should say **healthy** and `migrate` **exited (0)**.

If `migrate` failed, read its log:

```bash
docker compose -f docker-compose.windows.yml --env-file .env.production logs migrate
```

- `no pg_hba.conf entry for host "X"`: open `C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf` in Notepad (as Administrator), add at the end
  `host  tracknest  tracknest,tracknest_app  X/32  scram-sha-256` (with X from the message),
  then restart the **postgresql-x64-<version>** service in *Services* and run the `up` command again.
- `password authentication failed for user "tracknest"`: `POSTGRES_PASSWORD` doesn't match step 5.

## 7. Open the firewall (PowerShell as Administrator)

```powershell
New-NetFirewallRule -DisplayName "TrackNest HTTP/HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Profile Domain,Private
```

If the office network is marked **Public**, switch it to Private (Settings → Network → your connection).

## 8. First login

On any office PC open `https://192.168.1.50/signup`, accept the certificate warning (Advanced → Proceed) and create your organization. The first account is the owner; invite everyone else from **More → Team and invites**.

## 9. Trust the certificate on every device (recommended)

```bash
docker compose -f docker-compose.windows.yml --env-file .env.production cp caddy:/data/caddy/pki/authorities/local/root.crt ./tracknest-root.crt
```

- **Windows:** double-click → Install Certificate → Local Machine → *Trusted Root Certification Authorities* (IT can push it with Group Policy).
- **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
- **iPhone:** send the file, install the profile, then Settings → General → About → Certificate Trust Settings → turn it on.

## Updating

```bash
git pull
docker compose -f docker-compose.windows.yml --env-file .env.production up -d --build
```

## Backups

Every day `deploy\backups\` gets `db-<date>.dump` and `uploads-<date>.tar.gz`. Copy that folder to a network share or another disk regularly. A backup that exists only on this machine is lost with it.

### Restoring

```bash
docker compose -f docker-compose.windows.yml --env-file .env.production stop app cron backup
```

In **SQL Shell (psql)** as `postgres`:

```sql
DROP DATABASE IF EXISTS tracknest WITH (FORCE);
CREATE DATABASE tracknest OWNER tracknest;
```

In Git Bash:

```bash
"/c/Program Files/PostgreSQL/17/bin/pg_restore" -h localhost -U tracknest -d tracknest deploy/backups/db-YYYY-MM-DD-HHMM.dump

docker run --rm -v tracknest_uploads:/u -v "$PWD/deploy/backups:/b" alpine \
  sh -c "tar -xzf /b/uploads-YYYY-MM-DD-HHMM.tar.gz -C /u && chown -R 1000:1000 /u"

docker compose -f docker-compose.windows.yml --env-file .env.production up -d
```

## Notes

- After a reboot, PostgreSQL starts as a Windows service and the containers restart once Docker Desktop is running. Docker Desktop starts when a user signs in, so keep a user signed in or set up automatic sign-in.
- Docker Desktop is free for companies under 250 employees and US$10M revenue; above that it needs a paid licence.
- Keep `.env.production` private; it holds the database passwords.
