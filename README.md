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

On the Ubuntu VM, `deploy/autoshop-backup.timer` runs the protected copy of `scripts/backup-linux.sh` installed at `/opt/autoshop/backup/backup-linux.sh` daily at 2:00 AM New York time. It creates verified PostgreSQL custom-format dumps for the shop and Documenso databases, and a legacy DocuSeal database dump when that database is still running. It also archives the API uploads volume and Documenso's root-only environment, Compose file, and signing certificate. A metadata manifest and separate SHA-256 checksums are stored under `/opt/autoshop/backups/daily/`. The script copies the complete backup into a client-side encrypted rclone crypt remote on Google Drive and verifies the remote copy by downloading and comparing its contents. The transfer uses `rclone copy` and never deletes remote files. Protect local backups as credentials are included in the Documenso recovery archive.

Configure rclone on the VM as root:

```sh
sudo bash /opt/autoshop/app/scripts/setup-rclone-google.sh
sudo rclone --config /root/.config/rclone/rclone.conf config update gdrive config_is_local true
sudo rclone --config /root/.config/rclone/rclone.conf config reconnect gdrive:
```

Complete Google's authorization in the browser requested by rclone. On a headless VM, keep an SSH port-forward for local callback port 53682 while authorizing. The rclone config is root-only and used by the systemd service. The setup script saves the crypt recovery password and salt to `/root/.config/rclone/crypt-recovery.txt`; immediately copy both values to an offline password manager or storage independent of this VM and Drive. Without those values, Drive backups cannot be decrypted after a VM loss. Once authorization is complete, create the Drive backup folder with `sudo rclone --config /root/.config/rclone/rclone.conf mkdir gdrive-crypt:` and run `sudo systemctl start autoshop-backup.service` to verify upload and download comparison. The timer is enabled at 2:00 AM New York time. The backup script keeps 30 days of local backups, refuses to start when less than 1 GiB is free, and preserves the local backup if Drive is unavailable while marking the service run failed so the offsite-copy problem is visible. It leaves unrelated files untouched. Drive backups are retained until manually removed. Systemd records each run in the journal; check with `systemctl list-timers autoshop-backup.timer` and `journalctl -u autoshop-backup.service`.

The Google Drive copy protects against VM or host loss; the local copy remains a fast restore source. The Windows PowerShell task above is independent and does not control the Ubuntu timer.

### Documenso signing

Documenso v2.20.0 is the active signing provider. Its isolated Compose stack, database, and PDF-signing certificate are maintained under `/opt/documenso` on the shop VM. The shop application reaches it on the private Docker network at `http://documenso:3000`; new customer signing links use `https://shop-1.tail1d791.ts.net:8443`. Port 3003 remains bound to the VM's Tailscale IP for older signing links created before the public URL was changed; that compatibility address is tailnet-only. The shop remains on port 443. PostgreSQL is not published. Do not run `docker compose down -v`; that removes the Documenso database volume.

In a claim's **Authorization form**, **Send via Documenso** opens a recipient dialog for the claim customer or a different name and email. If the customer has no saved email, manual entry is required. The API creates a saved one-page Letter PDF directly from the claim, with five required initials fields, signature/date fields, and insurance/claim text fields. Documenso emails the request using the configured SMTP account. On status refresh after signing, the API retrieves the signed PDF and saves it to the claim and, if linked, the repair job documents. After a request is completed and its signed copy is saved, the same authorization can be sent again as a new signing envelope; prior signed copies remain in the document list. Pending or uncertain requests stay blocked to prevent duplicate emails. Claim and job documents can be opened, downloaded, or deleted from **Documents & job records**.

Configure these secrets outside source control in root-protected `/opt/autoshop/app/.env` on the VM, with restrictive permissions (`chmod 600`):

- `DOCUMENSO_API_TOKEN` (required): API token from the shop's Documenso account.
- `DOCUMENSO_API_URL` (optional): defaults to `http://documenso:3000/api/v2`.

Documenso's own SMTP password, database credentials, and signing keys remain in `/opt/documenso/.env`; never put them in this repository or chat. The API sends the token in Documenso's `Authorization` header. After updating the API token, recreate the API container so the setting takes effect.

The authenticated signing routes are:

- `POST /api/claims/:claimId/authorization.pdf` — creates a saved authorization PDF from a claim without a repair order.
- `POST /api/repair-authorizations/:authorizationId/send` — accepts `{ "recipientName": "...", "recipientEmail": "..." }` and returns the created signing status.
- `GET /api/repair-authorizations/:authorizationId/signing` — refreshes the status and imports a completed signed PDF.

DocuSeal has been removed from the active app and its containers, database volume, and stored files are purged from the VM after an encrypted backup. Historical DocuSeal IDs/statuses remain in their original shop-database columns as legacy records; the app will not send or poll them. Existing DocuSeal signing links no longer work after this cutover. The Documenso signing certificate is locally generated and supports PDF signatures without a public certificate-authority identity.

The Documenso stack source is `deploy/documenso-compose.yml`; it is installed as `/opt/documenso/compose.yml` on the VM. Secrets must be generated or entered directly on the VM and never committed.

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
