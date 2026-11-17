# Financials handoff - November 17, 2026

## Scope and branch history

The user requested completing the interrupted `job-financials` work, printable weekly employee pay stubs based on a supplied spreadsheet template, and a quarterly packet combining bank transactions with internal bookkeeping. The user then authorized publishing the complete financials feature to `prod` and updating the running production application.

Existing financials commits inherited from the interrupted work:

- `3cf2c1d`: quarterly ledger filters and statement export.
- `3fb00a2`, `ce957ee`: employee tax fields, tax settings and payroll setup UI.
- `ad65edd`, `632ea8b`: payroll withholding engine, pay runs, W-2 summary and payroll UI.
- `56d7a91`: CPA quarterly CSV with rough tax estimates.

Completed in this session:

- `e3849ae`: CSV/selectable-text PDF bank parser, legacy reviewed bank import, weekly pay-statement PDF and transfer-aware bookkeeping.
- `9852b79`: redesigned one-page weekly pay stub with current/YTD earnings, each withholding, net pay, employer-paid taxes, employee details and masked SSN.
- The reconciliation commit containing this handoff supersedes the legacy direct bank-import save path with persistent bank evidence, explicit matching decisions, and a detailed quarterly PDF/CSV packet.

## User workflow

1. Open **Bookkeeping > Bank reconciliation** (the ledger's **Import bank statement** button opens the same tab).
2. Select quarter/year. Upload bank PDF/CSV, using a consistent account label and the actual statement start/end dates. Supply opening/closing balances to enable arithmetic checks, or enter them later.
3. Uploading persists parsed bank evidence only. It never writes income/expenses.
4. Review suggested matches against invoice payments, job payments, ledger entries, job expenses, payroll payments, rent receipts and paid recurring expenses.
5. Confirm an existing source, explicitly create a genuinely bank-only entry, or exclude with a reason. No automatic matching or automatic ledger creation occurs.
6. Download **Quarterly PDF packet** and **Transaction CSV**. Retain the original bank statements alongside the packet.

The separate existing **CPA packet** remains available from the ledger's Q1-Q4 filter. Its estimates are not a certified tax calculation.

## Implementation map

- `apps/api/src/bank-statement-import.ts`: Bank of America-style selectable-text PDF rows/check tables and generic CSV parser, category suggestions, deterministic transaction references. Scanned PDFs require OCR outside this tool.
- `apps/api/src/bank-reconciliation.ts`: canonical internal source adapter, conservative candidate discovery, invalidated-match detection, quarter/date rules, cash totals, account/statement coverage, balance differences, duplicate/timing warnings.
- `apps/api/src/routes/reconciliation.ts`: persistent upload, statement balance edits, explicit review decisions and packet/report endpoints. Mounted at `/api/finance/reconciliation`.
- `apps/api/src/reconciliation-packet.ts`: multipage PDF with highlighted exceptions and full supporting detail, formula-safe CSV.
- `apps/api/src/routes/finance.ts`: mounts reconciliation routes, retains legacy preview, rejects unsafe legacy direct bank-import saves with HTTP 409, and serves payroll PDFs/YTD.
- `apps/api/src/payroll-statement.ts`: one-page Letter employee pay stub. YTD sums stored paycheck cents for the selected employee from January 1 through the selected pay date, not later paychecks/current tax settings.
- `apps/frontend/src/BankReconciliation.tsx` and `bank-reconciliation.css`: upload, summary/highlights, editable statement balances, matching/create/exclude/reset review, internal-only and invoice context, packet downloads.
- `apps/frontend/src/BookkeepingView.tsx`: new reconciliation tab; removes old ledger-writing import modal; existing payroll and CPA export preserved.

## Persistence, safety and compatibility

Additive migration: `20261117140000_bank_reconciliation`.

- `bank_statements`: account/file identity, statement dates, optional opening/closing balances, parser warnings.
- `bank_transactions`: original parsed reference/date, bank description/amount/direction, reviewed classification, decision/note, review timestamp and unique matched internal-source key.
- `_BankStatementToBankTransaction`: many-to-many link lets overlapping statement uploads share identical parsed transactions within the same account label.
- Unique `(accountKey, fileHash)` reuses exact file/account uploads. Unique `(accountKey, sourceReference)` deduplicates identical parser rows across statements. Unique `matchedSource` prevents an internal record clearing two bank rows.
- Upload/review writes run in serializable database transactions. A concurrent conflict returns HTTP 409, rather than a partial or success-shaped result.
- Quarter packet reads use a repeatable-read transaction for a consistent snapshot.
- Exact amount in cents and cash direction are required for matching. Dates more than seven days apart require a note.
- Bank-only creation is explicit, source-keyed and cannot silently repeat; possible existing candidates require an explanation. Legacy imported bank rows must match existing ledger entries.
- Reset never silently deletes a created ledger entry. Delete that explicit ledger entry first if the reconciliation decision must change.
- Source edits/deletions that invalidate amount, classification or cash direction cause a conflict on the next report.
- Known job-expense-to-ledger provenance is collapsed; independently entered records across modules remain distinct. Cross-module same-amount/direction records within seven days are highlighted as possible internal duplicates, not silently deleted.
- Parsed evidence is saved in PostgreSQL. Original PDF/CSV bytes are not retained by this implementation.
- No historical records are rewritten or backfilled automatically. Existing bank imports remain ledger entries and can be linked during review.
- Old browser clients attempting `/finance/bank-import` writes now receive a clear 409 directing them to reconciliation; refresh tabs after deployment.

## Report contents and accounting boundaries

The PDF and CSV include:

- Quarter cash-basis summary for bank activity and combined internal sources.
- Highlighted missing coverage, unverified/mismatched statement balances, parser warnings, unresolved/conflicting rows, possible duplicate internal records and cross-quarter timing differences.
- Statement/account register and opening-to-closing arithmetic checks.
- Every quarter bank row, classification, source link and review note.
- Combined canonical internal bookkeeping detail and internal-only exceptions.
- Invoice register for invoices issued in the quarter; paid and balance fields are **current**, not historical quarter-end snapshots.
- Calculated payroll run register, separately identified from actual payroll payments.

Unpaid invoices and calculated payroll runs are not counted as cash income/expenses. Pending bank rows never enter bookkeeping earnings. Transfers stay out of income/expense totals; bank cash movement includes transfers and excluded rows. Internal net is not automatically taxable profit. Reports remain review packets, not certified reconciliations, audited statements or filed returns.

## Validation completed

- API regression suite: **42 passing tests**.
- Isolated PostgreSQL route test: `npm run test:reconciliation-db --workspace apps/api` passed, including repeated-file reuse, source linking, no ledger writes during upload/match, exact amount enforcement, one-to-one matching, duplicate-safe creation, exclusion notes, invalidated matches and PDF/CSV routes.
- All **61 committed migrations** applied successfully to a fresh temporary PostgreSQL 16 database, including the additive reconciliation migration.
- API TypeScript build, frontend TypeScript check and frontend production build passed. Vite retains its large-chunk advisory.
- PDF text tests verify full transaction support and numbered multipage output. Weekly pay-stub layout was visually rendered and checked.
- Browser exercised sign-in, Bookkeeping reconciliation tab, statement upload and an explicitly confirmed bank-only ledger creation against the isolated database. Fixed full-ISO transaction date values in date inputs after that check.
- Full schema drift comparison still reports pre-existing differences in unrelated tables/indexes/defaults; no drift was reported for the new bank tables. Do not use `db push` to remove unrelated indexes or alter those tables as part of this deployment.

DB route tests intentionally write fixtures and require `RECONCILIATION_TEST_DATABASE_URL` with a database name containing `reconciliation_test`. Never run those against production. The default API regression suite does not need a database.

## Production rollout and rollback

Production SSH: `root@192.168.12.156`; checkout: `/opt/autoshop/app`. Root Git commands need `git -c safe.directory=/opt/autoshop/app` (or equivalent environment config).

Before this rollout, production was clean at `808e89b` with 57 applied migrations. Remote `prod` also included `9c9b3d4`, which is preserved as an ancestor of the financials branch. The deployment includes the claim follow-up migration plus the employee tax settings, pay runs and reconciliation migrations.

Verified protected predeployment database backups:

- `/var/backups/autoshop/postgres/collision_shop-20261117-170035.sql.gz` (gzip integrity verified).
- `/var/backups/autoshop/postgres/collision_shop-pre-reconciliation-20261117-170036.dump` (PostgreSQL custom archive list verified).

Build the new API/frontend images, apply `prisma migrate deploy` with the newly built API image **before** switching the running application, then run `scripts/deploy.sh`. The script resets the server checkout to remote `prod`; first confirm no uncommitted server work. Existing application versions tolerate these additive tables/columns.

Verify after deployment: server commit equals remote `prod`, API health at `http://127.0.0.1:8080/api/health`, Compose service status, all migrations applied, authenticated reconciliation GET/PDF/CSV access, and static frontend entry point. Do not upload fixture statements or create test payroll/ledger records in production.

For code rollback, redeploy the previous production commit while retaining additive tables and all financial records. Explicitly created bank-only ledger entries remain real bookkeeping records; do not delete them as part of application rollback. Database restore is a separate destructive operation requiring deliberate authorization.

## Material limitations / next decisions

- One-to-one matching only. Fees, split/partial payments and grouped deposits require recording the actual underlying transaction appropriately or leaving it flagged; no automatic split allocation exists.
- Statement parser supports known selectable-text bank layouts and generic CSV; parser warnings/movement differences must be reviewed.
- Coverage checks apply to uploaded account labels only; the user must confirm every business account is supplied.
- Different descriptions/account labels can evade duplicate identity. Similar internal cross-module entries are flagged, not automatically collapsed. Current reviewed links are recalculated against current source data; there is no immutable historical quarter-close snapshot.
- Pay runs store a pay date and weekly amounts, not hours or separate work-period dates. Pay stubs disclose that the displayed period is the seven days ending on pay date. Employee addresses are not invented.
- The inherited tax engine/CPA export is an estimate based on configurable shop settings, not official payroll compliance certification.
- Do not commit unrelated local OKD documentation/script, `.agents/`, `.claude/`, or `skills-lock.json`; those predated this financial work.
