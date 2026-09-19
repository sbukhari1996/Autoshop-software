# Mastercraft RepairOS — Complete Implementation Handoff

This is the source-of-truth handoff for Claude or another engineering agent. It describes what exists now, why it exists, where it lives, how the workflows connect, and how to improve the application without losing the business behavior already implemented.

## 1. Project Goal

Build a local-first collision shop management system for:
- customer intake
- vehicle records
- insurance claims
- estimate creation
- repair authorization forms
- scheduling and inspections
- expenses and receipts
- job profitability tracking
- dashboard reporting

The system is intended to run locally first with Docker/PostgreSQL and later be promoted from `dev` to `prod`. It is a real operating tool for Mastercraft Auto Repair & Collision, not a demo dashboard.

Business identity:
- Product name: RepairOS by Mastercraft
- Shop: Mastercraft Auto Repair & Collision
- Address: 38-21 23rd Street, Long Island City, NY 11101
- Facility number: `7136099`
- EIN: `42-2914045`
- Website: `www.mastercraftauto.com`

Core principle: preserve the local-first workflow and data relationships while improving usability, visual quality, security, and tenant isolation.

---

## 2. Technology And Runtime

### Repository
- GitHub: `https://github.com/sbukhari1996/Autoshop-software`
- `dev`: active development branch
- `prod`: promoted production branch
- Current production promotion commit at the time of this handoff: `aadd3e6`

### Monorepo
- npm workspaces at the root
- `apps/api`: Express 4 + TypeScript + Prisma
- `apps/frontend`: React 18 + Vite + TypeScript
- PostgreSQL 16 Alpine through Docker Compose
- API default port: `4000`
- Frontend default port: `5173`
- Database host port: `5433`
- API uploads directory: local `uploads/`

### Important commands
```bash
npm install
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
npm run build
git diff --check
```

On this Mac, Node/npm may require:
```bash
export PATH="$HOME/.local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
```

Before restarting servers, inspect stale processes:
```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Never use `prisma migrate reset` on the working database. Use forward migrations only.

## 3. Current Application Features

### 3.1 Initial project skeleton
Created a basic monorepo-style structure with:
- root package configuration
- Docker Compose configuration for PostgreSQL
- backend app skeleton
- frontend app skeleton
- git setup and initial commit

Main project files:
- [README.md](README.md)
- [docker-compose.yml](docker-compose.yml)
- [package.json](package.json)
- [apps/api/package.json](apps/api/package.json)
- [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma)
- [apps/api/src/server.ts](apps/api/src/server.ts)
- [apps/frontend/package.json](apps/frontend/package.json)
- [apps/frontend/src/main.tsx](apps/frontend/src/main.tsx)
- [apps/frontend/src/styles.css](apps/frontend/src/styles.css)

### 3.2 API foundation
Created a basic Express API with:
- health endpoint at `/api/health`
- base API route at `/api`
- environment file example for the database connection
- Prisma schema defining the core business entities

### 3.3 Frontend foundation
Created a basic React + Vite dashboard shell with:
- sidebar navigation
- KPI cards
- upcoming inspections panel
- follow-up tasks panel

### 3.4 Custom Copilot agents
Created specialized project agents in [.github/agents](.github/agents):
- [.github/agents/collision-shop-architect.agent.md](.github/agents/collision-shop-architect.agent.md)
- [.github/agents/collision-shop-backend.agent.md](.github/agents/collision-shop-backend.agent.md)
- [.github/agents/collision-shop-frontend.agent.md](.github/agents/collision-shop-frontend.agent.md)
- [.github/agents/collision-shop-qa.agent.md](.github/agents/collision-shop-qa.agent.md)
- [.github/agents/collision-shop-devops.agent.md](.github/agents/collision-shop-devops.agent.md)

These were designed to support:
- system architecture
- backend/database work
- frontend UI work
- testing and QA
- local Docker/devops setup

---

## 4. Completed Business Workflows

### 4.1 Customer workflow
- Create customers with first name, last name, phone, email, and address.
- Browse customers in a searchable/list workspace.
- Open a customer file showing vehicles, claims, jobs, and history.
- Delete customers only when linked records do not make deletion unsafe.
- Existing customer records are the starting point for normal shop intake.

### 4.2 Vehicle workflow
- Create vehicles under an existing customer.
- Fields include year, make, model, trim, body class, VIN, license plate, plate state, and color.
- VIN lookup/decode fills vehicle fields from the public VIN service.
- Vehicle records can be edited from the vehicle registry.
- Vehicle deletion is blocked when jobs or claims are linked.

### 4.3 Claim intake workflow
- Create a claim from an existing customer or use manual vehicle details when needed.
- Link the claim to a customer, vehicle, and optionally a repair order.
- Claim fields include claim number, customer contact/policy data, primary carrier, address, driver's license, vehicle fields, at-fault party/vehicle/insurance fields, incident/police/witness fields, adjuster data, status, notes, photo folder link, and submitted date.
- Documentation checklist supports damage photos, plate photos, at-fault DL photos, insurance card photos, police report, witness statement, estimate attachment, and ready-to-submit.
- Claims are grouped into customer files instead of a flat disconnected table.
- Claim workspace tabs: Claim intake and Documents & job records.
- Claims count in navigation is live, not hardcoded.

### 4.4 Repair job workflow
- Create repair orders linked to customer, vehicle, and optional claim.
- Repair order number is unique and visible throughout the application.
- Statuses: `new`, `inspection`, `authorized`, `in_progress`, `ready`, `completed`, `cancelled`.
- Any valid status can be selected directly; the old strict sequential transition rule was intentionally removed for shop flexibility.
- Every status change creates job status history.
- Job operations include expenses, invoice generation, and status updates.

### 4.5 Inspection and upcoming schedule
- Schedule an inspection with customer, claim, repair job, date/time, inspector, inspector phone, insurance representative, status, and notes.
- Existing schedule rows are clickable and open an edit form.
- New events use POST; existing events use PATCH.
- Schedule entries show inspector phone so staff can call directly.
- Upcoming schedule data appears on Dashboard and in Notifications.

### 4.6 Estimates
- Estimate builder supports saved estimates for existing repair jobs.
- Walk-in estimate mode supports print/download but does not save/book without a real customer/job.
- Estimate line items support description, section, operation, part number, quantity, unit price, labor hours, and paint hours.
- Estimate totals and tax are calculated.
- Estimate PDF endpoint produces a structured letter-size PDF.
- Estimate register shows status, work order, customer, line-item count, totals, and deletion where safe.

### 4.7 Repair authorization form
- On-screen authorization preview mirrors the supplied Mastercraft paper form.
- Includes exact visible header, contact information, Facility Number `7136099`, EIN `42-2914045`, field order, underlines, section titles, legal wording, indentation, initial lines, signature table, signed-address fields, and final statement.
- Scheduled adjuster visit is intentionally excluded from the paper.
- Print controls are hidden during printing.
- Download PDF generates the full form through the backend PDFKit renderer, not the old placeholder summary.
- Downloaded PDF and on-screen form must remain synchronized if the form changes.

### 4.8 Documents
- Documents attach to exactly one claim or job.
- Document types include accident photos, license photos, insurance card, police report, estimate, repair authorization, invoice, parts invoice, receipt, and other.
- Claim file shows uploaded documents, invoices/payments, estimates, expenses, status history, and authorizations together.
- Multiple files can be selected in the Documents workspace, up to 20 per request.
- Jobs and claims are passed into the Documents view so the target selector is populated.
- `Open` fetches through the authenticated API and opens the file blob.
- `Download` fetches through the authenticated API and downloads with the original filename.
- API stores files in the local uploads directory and validates paths before serving.

### 4.9 Invoices and payments
- Create invoices for customers/jobs/claims.
- Invoice lines, subtotal, tax, total, balance due, status, issue date, due date, and notes.
- Record invoice payments with method, amount, date, and notes.
- Generate/download structured invoice PDF.
- Job invoice generation creates an invoice from repair data.
- Invoice payment and expense activity feeds finance views.

### 4.10 Bookkeeping ledger
- General finance entries support income and expenses.
- Fields include description, category, amount, date, payment method, notes, claim, and job.
- Categories cover parts, labor, payroll, rent, utilities, insurance, marketing, and other.
- Payment methods include cash, debit card, credit card, check, ACH, and other (Zelle is preserved in notes/Other where needed).
- Imported historical records use `sourceReference` values to prevent duplicate imports.
- Synced payroll/rental/job expenses are protected from unsafe duplicate deletion.

### 4.11 Bank balance
- Dedicated BankAccount model stores the opening balance separately from income.
- Formula:
	`Current balance = Starting balance + all income - all expenses`
- Current reconciled local value: starting balance `$2,700.03`, current business balance `$5,832.07` based on September ledger.
- GET/PATCH `/api/finance/bank-balance` endpoints.
- Starting balance must be zero or greater.

### 4.12 Historical finance views
- Current month selector.
- Rolling 3, 6, 9, and 12 month views.
- `/api/finance/range?months=N` returns combined income, expenses, and net.
- UI displays month-by-month income, expenses, and net for rolling views.
- Standard month summary remains separate and stable.

### 4.13 Employees and payroll
- Separate Bookkeeping tab: Employees & payroll.
- Employee fields: name, role, phone, email, weekly rate/target, start date, active state, notes.
- Record full or partial payroll payments.
- Track expected-to-date, paid-to-date, and balance due.
- Payroll payment creates a linked expense entry under Payroll & Wages.
- Payroll payment deletion removes its linked finance entry transactionally.
- A worker can be paid less than the weekly target without corrupting the expected balance.

### 4.14 Shop rentals
- Separate Bookkeeping tab: Shop rentals.
- Intended for mechanical-space renters during day and night shifts.
- Rental tenant fields: name, phone, email, space, shift, rent amount, rent frequency, start date, active state, notes.
- Rent frequencies: daily, weekly, monthly.
- Record two payment types: rent and shared expense contribution.
- Track expected rent, rent collected, rent due, shared expenses collected, and total collected.
- Rental payments create linked income entries under Rental Income.
- Rental payment deletion removes its linked finance entry transactionally.

### 4.15 Dashboard and reporting
- Dashboard metrics: active jobs, scheduled inspections, customers, net revenue.
- Recent work orders and upcoming schedule.
- Reports include jobs by status, estimate totals, document counts, revenue, expenses, and operational facts.
- Notifications drawer surfaces upcoming inspections, claims needing attention, and ready/completed job updates.
- Notification items route to the relevant workspace and dismiss persistently per organization in local storage.

## 5. Authentication And Organizations

### Local authentication
- PBKDF2-SHA256 password hashing with 120,000 iterations.
- HMAC-signed local tokens.
- Default development account:
	- Email: `admin@mastercraftautony.com`
	- Password: `Mastercraft2026!`
- Default seed is disabled in production unless explicitly enabled.
- Local-first login is intentional: the app tries local login before Neon for existing local accounts, then falls through to Neon for external users.

### Neon Auth / Better Auth
- Configured through `NEON_AUTH_URL` and optional `NEON_AUTH_JWKS_URL`.
- Google and email/password Neon endpoints are called with `credentials: include`.
- Google flow uses Better Auth `/sign-in/social` and redirects to the frontend root.
- Callback detection checks `neon_auth_session_verifier` on every app load.
- Backend `/api/auth/neon-callback` validates a Neon session through `/get-session` before creating/linking a local user.
- Invalid Neon tokens are rejected with `401`.
- Do not trust browser-supplied user data as an authentication fallback.
- Neon Console local trusted origin: `http://localhost:5173`.
- Neon Google and email/password providers must be enabled in Neon Console.
- Current limitation: Neon package integration was investigated; use the actual installed Neon SDK contract before replacing the working REST bridge. Do not assume the archived Flask guide exactly matches current Managed Better Auth behavior.

### Organization flow
- Users can belong to multiple organizations through memberships.
- Roles: owner, admin, manager, technician, parts_clerk, viewer.
- Users without an active organization see organization setup/selection.
- Organization creation and selection return a token containing organization context.
- Major remaining security task: add organizationId/scoping to all legacy business records and queries. Membership existence alone is not tenant isolation.

## 6. File Ownership Map

### Frontend
- `apps/frontend/src/main.tsx`: main React app, landing/auth, navigation, dashboard, customers, claims, jobs, inspections, documents, notifications, profile/logout, authorization preview.
- `apps/frontend/src/styles.css`: global design system, RepairOS-inspired styles, print layouts, dashboard cards, finance/payroll/rental styles.
- `apps/frontend/src/EstimateBuilder.tsx`: estimate creation, VIN/walk-in behavior, estimate preview/download.
- `apps/frontend/src/InvoiceView.tsx`: invoice list, creation, payments, invoice PDF.
- `apps/frontend/src/BookkeepingView.tsx`: ledger, bank balance, historical views, payroll, rentals, recurring costs.

### Backend
- `apps/api/src/server.ts`: Express bootstrap, middleware, route registration, default admin setup.
- `apps/api/src/auth.ts`: hashing, local tokens, Neon JWT/session verification, mutation protection, roles.
- `apps/api/src/seed.ts`: Mastercraft organization and default admin seed.
- `apps/api/src/routes/auth.ts`: local auth, Neon handoff, session, organization selection.
- `apps/api/src/routes/customers.ts`: customer CRUD.
- `apps/api/src/routes/workflows.ts`: dashboard, VIN, vehicles, claims, jobs, estimates, documents list, reports, inspections.
- `apps/api/src/routes/operations.ts`: job expenses, job status, authorization PDF, file upload/download.
- `apps/api/src/routes/invoices.ts`: invoices, payments, invoice PDF.
- `apps/api/src/routes/finance.ts`: ledger, recurring expenses, bank balance, historical range, payroll, rentals.
- `apps/api/prisma/schema.prisma`: complete data model.
- `apps/api/prisma/migrations/`: additive migration history; never reset production data.

## 7. Database Model Summary

Preserved auth/tenant models:
- User
- Organization
- OrganizationMembership

Operational models:
- Customer
- Vehicle
- Claim
- Job
- Inspection
- Estimate
- EstimateLineItem
- JobExpense
- JobStatusHistory
- FinanceEntry
- BankAccount
- Invoice
- InvoiceLineItem
- Payment
- RecurringExpense
- RepairAuthorization
- ClaimDocument
- JobDocument
- Employee
- PayrollPayment
- RentalTenant
- RentalPayment

Primary relationship:
`Customer -> Vehicle -> Claim -> Job -> Inspection/Estimate/Documents/Expenses -> Invoice/Payment`

Finance relationships:
`Employee -> PayrollPayment -> FinanceEntry expense`

`RentalTenant -> RentalPayment -> FinanceEntry income`

`BankAccount + FinanceEntry + JobExpense -> current bank balance`

## 8. Data Imported So Far

The local development database was cleaned while preserving users, organizations, memberships, schema, and migrations. Then legacy records were imported:
- 6 customers
- 5 vehicles
- 6 claims
- 6 repair orders
- Claim IDs: `CLM-0001` through `CLM-0006`
- Repair orders: `RO-001`, `RO-002`, `RO-003`, `RO-004`, `RO-1005`, `RO-1006`

September 2026 bookkeeping import:
- 12 income entries totaling `$33,246.00`
- 45 expense entries totaling `$30,113.96`
- 57 total September ledger records
- Starting balance reconciled to `$2,700.03`
- Current business bank balance reconciled to `$5,832.07`

July and August bookkeeping data was supplied for future import but was not imported at the time of this handoff.

Do not delete or re-import these records without explicit user approval.

## 9. UI And Design Direction

The visual direction adapts the referenced MIT-licensed RepairOS repository:
- Precision Industrial / operations-console feel.
- RepairOS logo graphic from the reference repository.
- DM Sans body type, Source Sans 3 headings, JetBrains Mono for money/IDs.
- Steel blue, signal orange, success green, warm warning, info teal, and restrained lavender accents.
- Light workspace with layered warm/cool background lighting and a subtle grid texture.
- Compact white surfaces, readable tables, soft borders, deliberate shadows, status pills, and responsive layouts.
- Auth screen: centered card, logo, Google button, divider, sign-in/create-account tabs, forgot password, email/password fields.
- Account controls: top-right and sidebar profile menus with logout.

Do not collapse the UI back into generic dark dashboard styling. Keep the existing light RepairOS language and improve it with restraint.

## 10. API Endpoint Inventory

Auth:
- POST `/api/auth/register`
- POST `/api/auth/login`
- POST `/api/auth/neon-callback`
- GET `/api/auth/session`
- POST `/api/auth/organizations`
- POST `/api/auth/organizations/:organizationId/select`

Core operations:
- GET/POST/PATCH/DELETE customers, vehicles, claims, jobs, inspections, estimates as implemented in route files.
- GET `/api/dashboard`
- GET `/api/reports`
- GET `/api/documents`
- POST `/api/documents/upload`
- GET `/api/documents/:documentId/download`
- PATCH `/api/jobs/:jobId/status`
- POST `/api/jobs/:jobId/authorization.pdf`

Finance:
- GET/POST/PATCH/DELETE `/api/finance/entries`
- GET/POST/PATCH/DELETE `/api/finance/recurring`
- GET/PATCH `/api/finance/bank-balance`
- GET `/api/finance/summary`
- GET `/api/finance/range?months=3|6|9|12`
- GET/POST/PATCH/DELETE `/api/finance/employees...`
- GET `/api/finance/payroll`
- GET/POST/PATCH/DELETE `/api/finance/rentals...`
- GET `/api/finance/rentals/summary`

Invoices:
- GET/POST/PATCH/DELETE `/api/invoices`
- POST `/api/invoices/from-job/:jobId`
- POST `/api/invoices/:id/pdf`
- GET `/api/invoices/:id/pdf/download`
- GET/POST `/api/invoices/:id/payments`

## 11. Safe Production Workflow

Development:
1. Checkout `dev`.
2. Start Docker database and local API/frontend.
3. Run migrations only when schema changes.
4. Test the affected workflow in the browser and through the API.
5. Run `npm run build` and `git diff --check`.

Promotion:
1. Review `git diff` and `git status`.
2. Ensure `.env`, `.env.local`, uploads, tokens, and secrets are ignored.
3. Commit the tested code on `dev`.
4. Merge or cherry-pick the approved commit to `prod`.
5. Push `prod`.
6. Run migrations in the production database before starting the new application version.

Database cleanup for a fresh local workspace:
- Delete operational rows only.
- Preserve users, organizations, memberships, migrations, and schema.
- Reset BankAccount opening balance intentionally.
- Never run destructive cleanup against production.

## 12. Known Gaps And Risks

1. Full tenant isolation is incomplete because many legacy business models do not yet carry organizationId.
2. Neon browser SDK integration is still a hand-written REST bridge; current Google callback behavior depends on Better Auth session response/token availability.
3. Default admin credentials are suitable only for local development and must be changed before production.
4. No formal automated test runner exists; validation is currently build, API smoke tests, browser checks, and database checks.
5. Multiple stale dev servers can cause EADDRINUSE or stale-code confusion.
6. Existing legacy route code contains some compact one-line handlers; preserve behavior while refactoring cautiously.
7. Historical imported data contains source typos and ambiguous/missing fields. Preserve original meaning and document normalization.
8. Uploaded files are local filesystem state and require persistent production storage/backups.
9. Browser warnings about duplicate `createRoot` can come from multiple development tabs/HMR and should be investigated separately from business failures.

## 13. Recommended Claude Improvement Plan

### Phase 1: Stabilize
- Run the full build and API health check.
- Add a formal test suite for auth, CRUD, status transitions, documents, finance calculations, payroll, and rental payments.
- Add structured error logging and a visible toast system.
- Refactor compact route handlers only where tests protect behavior.

### Phase 2: Finish authentication
- Install/use the official `@neondatabase/auth` or current Neon SPA SDK contract only after verifying its actual exports.
- Use a shared auth client/session hook where supported.
- Support Neon email verification and password reset states.
- Support OAuth verifier callback without requiring a token field that Managed Better Auth intentionally omits.
- Keep local admin fallback for local development.

### Phase 3: Tenant safety
- Add organizationId to every operational model or enforce an equivalent ownership boundary.
- Scope every GET, POST, PATCH, DELETE, and download route by active membership.
- Add role permission checks for owner/admin/manager/technician/parts_clerk/viewer.
- Add tenant-isolation regression tests.

### Phase 4: Shop usability
- Add global customer/job/claim search with debounce.
- Add toast notifications for successful saves/uploads/payments.
- Add keyboard shortcuts: Cmd/Ctrl+K search, Escape close.
- Add mobile off-canvas navigation.
- Add employee/renter edit and archive flows.
- Add bulk document metadata and upload retry feedback.

### Phase 5: Reporting
- Add true month-by-month chart data from the API instead of only client aggregation.
- Add revenue by source: repairs, rentals, other income.
- Add expenses by category, paid-from account, and deductible status.
- Add payroll and rental obligations to cash forecasting.
- Add overdue invoices, unpaid payroll, unpaid renter balances, and bank reconciliation variance.

### Phase 6: Production hardening
- Move uploads to durable object storage or a backed-up persistent volume.
- Replace default credentials and enforce strong production secrets.
- Add backups and restore drills.
- Add audit logs for destructive actions and financial changes.
- Add deployment health checks and migration gating.

## 14. Agent Instructions

When continuing this project:
- Read this handoff and the relevant owning file before editing.
- Start from the smallest local behavior anchor.
- Do not reset the database or discard user data.
- Do not commit or push unless explicitly requested.
- Keep local `.env` files and secrets out of Git.
- Preserve existing Mastercraft wording and supplied legal form text.
- Prefer existing APIs and patterns over new abstractions.
- Validate after every substantive edit.
- For auth/security, never trust client-provided identity fields without server verification.
- For financial data, use transactions and keep linked ledger records synchronized.
- For PDFs, validate both on-screen preview and downloaded output.
- For UI, check desktop and mobile layouts and avoid overlapping text.

## 15. Current Starting Point

At the latest handoff:
- `dev` is the working branch.
- `prod` contains the last explicitly promoted application snapshot; later local changes must be promoted separately.
- Local operational data has been populated with six legacy claims and the September bookkeeping import. July/August bookkeeping data remains pending import.
- Default local admin login works.
- The app runs at `http://localhost:5173` with API at `http://localhost:4000`.
- The next highest-value engineering work is tenant isolation, formal tests, and completing the official Neon Auth SPA integration without breaking local login.

### collision-shop-architect
Handles:
- product requirements
- feature planning
- domain design
- architecture decisions
- modular breakdown of the collision shop system

### collision-shop-backend
Handles:
- Prisma schema design
- database tables and relationships
- CRUD API routes
- validation and business rules
- local database and migration work

### collision-shop-frontend
Handles:
- dashboard design
- customer and job screens
- estimate and claim forms
- reports and scheduling UI
- usability for shop staff

### collision-shop-qa
Handles:
- regression testing
- API validation
- database integrity checks
- business workflow verification

### collision-shop-devops
Handles:
- Docker setup
- local environment config
- database startup
- persistent storage and environment management

---

## Environment issues encountered

We hit several environment setup blockers while trying to get the project running locally:
- WSL was not installed
- Ubuntu was not installed
- Node.js and npm were not available in the Windows environment
- Docker was not installed yet
- Windows required admin-level enabling of WSL features and Docker installation

These were resolved partially and the repo was pushed to GitHub, but the project still needs a fresh local environment setup on a machine where Docker and Node are running correctly.

---

## Current repository status

The repo is live on GitHub here:
https://github.com/sbukhari1996/Autoshop-software

The project is currently in the initial skeleton stage, not yet in a full functional app state.

---

## What still needs to be done

### 1. Local environment setup on MacBook
Run the following commands on the MacBook:

```bash
git clone https://github.com/sbukhari1996/Autoshop-software.git
cd Autoshop-software
npm install
cp apps/api/.env.example apps/api/.env
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
```

### 2. Full backend implementation
Add:
- customer CRUD
- vehicle CRUD
- claim creation and tracking
- estimate generation and line items
- repair job lifecycle
- expense and receipt tracking
- documents and file associations

### 3. Frontend implementation
Build actual screens for:
- dashboard overview
- customer list/detail
- claim intake
- estimate forms
- active jobs board
- inspections and scheduling
- receipts and documents
- reporting panels

### 4. Database refinement
The initial Prisma schema is a solid starting point, but it still needs:
- stronger validation rules
- status enums
- more complete relationships
- reporting queries
- audit/history tracking
- user role logic

### 5. Testing and QA
Add:
- regression tests
- API checks
- business logic verification
- UI smoke checks
- database integrity tests

### 6. Future product features
The next bigger features to aim for are:
- insurance claim workflow automation
- PDF generation and print forms
- signed repair authorization flow
- total loss handling
- payment tracking
- invoicing
- dashboard analytics

---

## Recommended next milestone

The next phase should be:
1. get the app running locally on the MacBook
2. verify the API and frontend boot correctly
3. build the customer and claim CRUD flow
4. add estimate and repair job management
5. then implement expenses, reports, and dashboard summaries

---

## Best handoff note

We have the skeleton, the GitHub repo, and the custom agent system ready. The project is not yet complete, but the architecture and project direction are now in place, and this repo can be used as the continuation point for the next development cycle.

Continue from the GitHub repo and the latest project state in this file, then move into the actual business workflow implementation.
