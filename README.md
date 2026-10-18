# Collision Shop Local Management App

A local-first collision repair shop management system built for small shops needing:

- customer and vehicle management, including separate street, city, state, and ZIP address fields
- collision claim intake
- estimate creation
- repair authorization workflows
- job scheduling and inspections
- expense tracking and receipts
- report dashboard

## Local setup

Development login defaults to `admin@mastercraftautony.com` / `Mastercraft2026!`. Override `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` in `apps/api/.env`; do not use predictable defaults in production.

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start PostgreSQL with Docker:
   ```bash
   docker compose up -d db
   ```

3. Copy environment example:
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

4. Run Prisma generate and migrate:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

5. Start the app:
   ```bash
   npm run dev
   ```

### Windows Docker Desktop and backups

The Compose project is pinned to `autoshopsoftware`, so PostgreSQL and uploaded files remain in named Docker volumes when containers are restarted or rebuilt. Use `docker compose up -d --build` to start the app; do not use `docker compose down -v`, which removes the database and uploads volumes. The registered sign-in task starts Docker Desktop and runs `docker compose up -d --build`; the containers use `unless-stopped` restart policies as well.

On Windows, the app is available locally at http://localhost:5173. To share it privately over Tailscale, run `tailscale serve --bg 5173` once from PowerShell, then use the HTTPS URL printed by `tailscale serve status`. This exposes the app to tailnet devices without publishing the Docker port on the LAN or internet. `tailscale serve` configuration is retained by Tailscale across Docker restarts. To keep database and document backups on `E:\AutoshopBackups\Postgres`, run the following from PowerShell in the repository folder:

```powershell
.\scripts\register-windows-backup-task.ps1
```

The backup task creates a verified PostgreSQL archive and a separate uploaded-files archive daily at 2:00 AM. Backups are not automatically pruned. Docker Desktop must be running and the Windows user must be signed in when the task runs; missed runs start when available. Check `E:\AutoshopBackups\Postgres\backup.log` for backup runs and `startup.log` for app restarts.

To preview invoice PDF changes without replacing the current frontend/API, start the separate local test instance:

```powershell
docker compose -f docker-compose.invoice-test.yml up -d --build
```

Open http://localhost:5174 and sign in with an existing account. The test API uses the same database, authentication secret, and uploads volume as the main local instance; it does not run migrations or seed/update an admin account. Changes made to invoices, payments, customers, or uploaded documents in the test instance affect the shared data. Stop the test instance with `docker compose -f docker-compose.invoice-test.yml down` (do not add `-v`).
### Ubuntu production backups

On the Ubuntu VM, `deploy/autoshop-backup.timer` runs `scripts/backup-linux.sh` daily at 2:00 AM New York time. It creates a verified PostgreSQL custom-format dump, an archive of the API uploads volume, a metadata manifest, and a separate SHA-256 checksum list under `/opt/autoshop/backups/daily/`. It then copies that complete backup into a client-side encrypted rclone crypt remote on Google Drive and verifies the remote copy by downloading and comparing its contents. The transfer uses `rclone copy` and never deletes remote files.

Configure rclone on the VM as root:

```sh
sudo bash /opt/autoshop/app/scripts/setup-rclone-google.sh
sudo rclone --config /root/.config/rclone/rclone.conf config update gdrive config_is_local true
sudo rclone --config /root/.config/rclone/rclone.conf config reconnect gdrive:
```

Complete Google's authorization in the browser requested by rclone. On a headless VM, keep an SSH port-forward for local callback port 53682 while authorizing. The rclone config is root-only and used by the systemd service. The setup script saves the crypt recovery password and salt to `/root/.config/rclone/crypt-recovery.txt`; immediately copy both values to an offline password manager or storage independent of this VM and Drive. Without those values, Drive backups cannot be decrypted after a VM loss. Once authorization is complete, create the Drive backup folder with `sudo rclone --config /root/.config/rclone/rclone.conf mkdir gdrive-crypt:` and run `sudo systemctl start autoshop-backup.service` to verify upload and download comparison. The timer is enabled at 2:00 AM New York time. The backup script keeps 30 days of local backups, refuses to start when less than 1 GiB is free, and preserves the local backup if Drive is unavailable while marking the service run failed so the offsite-copy problem is visible. It leaves unrelated files untouched. Drive backups are retained until manually removed. Systemd records each run in the journal; check with `systemctl list-timers autoshop-backup.timer` and `journalctl -u autoshop-backup.service`.

The Google Drive copy protects against VM or host loss; the local copy remains a fast restore source. The Windows PowerShell task above is independent and does not control the Ubuntu timer.

### DocuSeal signing server

The isolated DocuSeal Compose stack is defined in `deploy/docuseal-compose.yml`. On the shop VM, create `/opt/docuseal/.env` as a root-only file containing randomly generated `DOCUSEAL_DATABASE_PASSWORD` and `DOCUSEAL_SECRET_KEY_BASE` values, then start it with:

```sh
cd /opt/autoshop/app
sudo docker compose --env-file /opt/docuseal/.env -p docuseal -f deploy/docuseal-compose.yml up -d
```

DocuSeal is pinned to version 3.3.2 and its PostgreSQL 16 database and application files use separate persistent Docker volumes. It is available at `https://shop-1.tail1d791.ts.net:8443`; the existing shop site remains on port 443. Tailscale Funnel forwards port 8443 to DocuSeal on loopback, and the DocuSeal app is also attached to the shop's private Docker network for server-to-server API access. PostgreSQL is not exposed.

Funnel makes the DocuSeal web app, including its login page, reachable from the public internet. DocuSeal still requires authentication for administration; use a unique strong password and enable two-factor authentication. Only send signing links to intended customers.

The DocuSeal email settings use Gmail SMTP (`smtp.gmail.com`, port `587`, STARTTLS) and the shop Gmail sender. The account owner has entered the SMTP details; use DocuSeal's test-email action if delivery has not yet been verified. Do not put the App Password in this repository or send it in chat.

The DocuSeal API key is stored in the shop VM's protected `/opt/autoshop/app/.env` as `DOCUSEAL_API_KEY`. Do not display it or copy it into repository files. The app submits its saved repair-authorization PDF directly to DocuSeal; no template or `DOCUSEAL_TEMPLATE_ID` is required.

In a claim's **Authorization form**, **Send via DocuSeal** opens a dialog to choose the customer recipient on the claim or enter a different name and email. If the customer has no saved email, the dialog selects manual entry and requires an email before sending. The app creates or reuses a saved one-page Letter authorization PDF directly from the claim, so a repair order is not required; it includes the customer's structured address and the existing shop signing address, then submits it with five required initials fields, required signature/date fields, and required insurance/claim text fields already placed. DocuSeal sends the signing email through its configured SMTP account. After signing, the PDF is saved in the claim's documents and, when the claim is linked to a repair order, separately in the repair job's documents.

DocuSeal's public application URL is configured as `https://shop-1.tail1d791.ts.net:8443`. The API server reaches DocuSeal on the private Docker network. Configure these API-server environment variables outside source control:

- `DOCUSEAL_API_KEY` (required): DocuSeal API key.
- `DOCUSEAL_WEBHOOK_SECRET` (required for completion sync): the HMAC secret generated in DocuSeal's webhook settings.
- `DOCUSEAL_BASE_URL` (optional): DocuSeal API base URL, defaulting to `http://docuseal:3000/api` for the API container's internal network connection.

Keep both secrets in the root/shop-protected `/opt/autoshop/app/.env` with restrictive permissions (`chmod 600`) and out of source control. Recreate the API container after updating them so they take effect:

```sh
cd /opt/autoshop/app
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build api
```

The configured DocuSeal webhook listens only for `submission.completed` and posts to `http://collision-shop-api:4000/api/webhooks/docuseal` over the shared private Docker network. Set `DOCUSEAL_WEBHOOK_SECRET` to the webhook's HMAC signing secret. The API verifies `X-Docuseal-Signature` against the raw request body and rejects timestamps outside five minutes. On completion it downloads the signed PDFs and adds them to the associated claim and job documents as `repair_authorization`.

The PDF prefill uses the linked customer's name, structured street/city/state/ZIP and phone; the linked claim number, insurance and incident date; and linked vehicle details with claim vehicle details as fallback. The signer name and email are confirmed in the send dialog. Signing fields are positioned from the generated PDF layout: initials at each of the five authorization sections, text fields in Direction of Payment, and signature/date in the signature row. For full-size printing from DocuSeal, download the signed PDF rather than printing the signing webpage, which includes the signing controls and may scale the document.

The authenticated API routes are:

- `POST /api/claims/:claimId/authorization.pdf` — creates a saved authorization PDF from a claim without requiring a linked repair order.
- `POST /api/repair-authorizations/:authorizationId/send` — accepts `{ "recipientName": "...", "recipientEmail": "..." }`, sends the saved PDF to the specified recipient and returns `201` with `{ authorizationId, jobId, claimId, submissionId, signerEmail, status, completedAt }`.
- `GET /api/repair-authorizations/:authorizationId/signing` — return that status object (with `status: "not_sent"` before sending).

### Dockhand Docker management

Dockhand is installed as an isolated Compose project at `/opt/dockhand` on the shop VM, using the pinned image `fnsys/dockhand:v1.0.54`. Its UI is available to tailnet devices at `https://shop-1.tail1d791.ts.net:10000`. The container port is bound to loopback; Tailscale Serve provides HTTPS on port 10000. Do not add this listener to Funnel or expose it through the public shop site.

Dockhand mounts `/var/run/docker.sock` so it can manage containers. This effectively grants VM-level administrative control. Authentication is enabled and the initial local administrator account has been created. Keep its credentials unique and private, change the initial password after first login, and only access it from trusted tailnet devices. All configured users have full access in this deployment.

The stack uses the persistent Docker volume `dockhand_dockhand_data`. To inspect or restart Dockhand on the VM:

```sh
cd /opt/dockhand
docker compose ps
docker compose restart
```
### Authentication and organizations

Sign in and account registration use the app's local email/password authentication at `/api/auth/login` and `/api/auth/register`. Passwords are hashed by the API and authenticated users receive an app-managed token. Authenticated users can inspect their current context with `GET /api/auth/session`, create an organization with `POST /api/auth/organizations`, and switch organizations with `POST /api/auth/organizations/:organizationId/select`. Write requests require an authenticated membership.

## Apps

- API: http://localhost:4000
- Frontend: http://localhost:5173

## Stack

- PostgreSQL
- Docker Compose
- Express + TypeScript backend
- React + Vite frontend
- Prisma ORM

## Notes

The initial Prisma migration is committed under `apps/api/prisma/migrations`. `npm run db:migrate` applies committed migrations reproducibly; use `npm run db:migrate:dev --workspace apps/api -- --name change_name` only when creating a new migration.

If PostgreSQL was previously started with another user or an old Docker volume, recreate the local volume once with `docker compose down -v` followed by `docker compose up -d db`. This removes only the local database volume and resolves P1010 credentials mismatches.
