# Collision Shop Local Management App

A local-first collision repair shop management system built for small shops needing:

- customer and vehicle management
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
