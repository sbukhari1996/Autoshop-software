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

### Authentication and organizations

Local email/password login remains available at `/api/auth/register` and `/api/auth/login`. Authenticated users can inspect their current context with `GET /api/auth/session`, create an organization with `POST /api/auth/organizations`, and switch organizations with `POST /api/auth/organizations/:organizationId/select`. Write requests require an authenticated membership.

Neon Auth JWT verification is optional. Set `NEON_AUTH_URL` or `NEON_AUTH_JWKS_URL` in `apps/api/.env`; local HMAC tokens continue to work for development. Google OAuth is only exposed as configuration/status and explicit `501` responses until `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are configured and the callback flow is implemented.

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
