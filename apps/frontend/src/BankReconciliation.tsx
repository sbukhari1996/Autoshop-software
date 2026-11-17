import React from "react";
import "./bank-reconciliation.css";

type BankEntryType = "income" | "expense" | "transfer_in" | "transfer_out";
type InternalRecord = {
  key: string;
  kind: string;
  id: string;
  date: string;
  description: string;
  type: string;
  amount: number;
  category: string | null;
  sourceReference?: string | null;
};
type ReconciliationTransaction = {
  id: string;
  entryDate: string | null;
  description: string;
  amount: number;
  direction: "in" | "out";
  type: BankEntryType;
  category: string | null;
  status: string;
  matchedSource: string | null;
  reviewNote: string | null;
  accountKey: string;
  state: "matched" | "unmatched" | "conflicting" | "excluded";
  reason: string;
  candidates: InternalRecord[];
};
type ReconciliationReport = {
  year: number;
  quarter: number;
  from: string;
  to: string;
  highlights: string[];
  totals: {
    bankIn: number;
    bankOut: number;
    internalIncome: number;
    internalExpenses: number;
    internalNet: number;
    bankNet: number;
    unresolved: number;
    matched: number;
    excluded: number;
    unbanked: number;
  };
  statements: Array<{
    id: string;
    accountName: string;
    fileName: string;
    periodStart: string;
    periodEnd: string;
    openingBalance: number | null;
    closingBalance: number | null;
    transactionCount: number;
    balanceDifference: number | null;
    warnings: string[];
  }>;
  transactions: ReconciliationTransaction[];
  internalRecords: InternalRecord[];
  unbanked: InternalRecord[];
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    total: number;
    amountPaid: number;
    balanceDue: number;
    issueDate: string;
  }>;
};
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const categories = [
  "Parts", "Shop income", "Owner transfer", "Bank fees", "Labor", "Payroll",
  "Payroll & Wages", "Rent", "Rent / Lease", "Phone & Internet", "Utilities",
  "Insurance", "Taxes", "Meals", "Vehicle expense", "Marketing", "Other",
];
const currency = (amount: number) =>
  `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateInputValue = (value: string | null | undefined) => value ? value.slice(0, 10) : "";
const displayDate = (date: string | null | undefined) => {
  if (!date) return "Date missing";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString();
};
const quarterDates = (year: number, quarter: number) => ({
  start: `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`,
  end: new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10),
});
const amountCents = (amount: number) => Math.round(Math.abs(amount) * 100);
const recordDirection = (record: InternalRecord): "in" | "out" | null => {
  const type = record.type.toLocaleLowerCase().replace(/[\s-]+/g, "_");
  const value = `${record.type} ${record.kind}`.toLocaleLowerCase().replace(/[\s-]+/g, "_");
  if (type === "expense" || type.includes("transfer_out") || type.includes("outflow") || value.includes("expense")) return "out";
  if (type === "income" || type.includes("transfer_in") || type.includes("inflow")) return "in";
  if (value.includes("income") || value.includes("payment") || value.includes("invoice")) return "in";
  return null;
};
const dateGapDays = (left: string | null | undefined, right: string | null | undefined) => {
  if (!left || !right) return null;
  const a = Date.parse(`${left.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${right.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 86_400_000 : null;
};
const reportUrl = (year: number, quarter: number) =>
  `/finance/reconciliation?year=${encodeURIComponent(year)}&quarter=${encodeURIComponent(quarter)}`;

function calculateCoverage(report: ReconciliationReport) {
  const ranges = report.statements
    .map((statement) => ({
      start: statement.periodStart > report.from ? statement.periodStart : report.from,
      end: statement.periodEnd < report.to ? statement.periodEnd : report.to,
    }))
    .filter((range) => range.start <= range.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  const gaps: Array<{ start: string; end: string }> = [];
  let next = report.from;
  for (const range of ranges) {
    if (range.start > next) {
      const gapEnd = new Date(`${range.start}T00:00:00Z`);
      gapEnd.setUTCDate(gapEnd.getUTCDate() - 1);
      gaps.push({ start: next, end: gapEnd.toISOString().slice(0, 10) });
    }
    if (range.end >= next) {
      const dayAfterEnd = new Date(`${range.end}T00:00:00Z`);
      dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
      next = dayAfterEnd.toISOString().slice(0, 10);
    }
    if (next > report.to) break;
  }
  if (next <= report.to) gaps.push({ start: next, end: report.to });
  return gaps;
}

export function BankReconciliation({
  request,
  onChanged,
  year: initialYear,
  quarter: initialQuarter,
}: {
  request: Request;
  onChanged: () => void | Promise<void>;
  year: string;
  quarter: string;
}) {
  const currentDate = new Date();
  const currentQuarter = Math.floor(currentDate.getMonth() / 3) + 1;
  const initialQ = /^q[1-4]$/i.test(initialQuarter) ? Number(initialQuarter.slice(1)) : currentQuarter;
  const initialY = /^\d{4}$/.test(initialYear) ? Number(initialYear) : currentDate.getFullYear();
  const [year, setYear] = React.useState(initialY);
  const [quarter, setQuarter] = React.useState(initialQ);
  const initialDates = quarterDates(initialY, initialQ);
  const [periodStart, setPeriodStart] = React.useState(initialDates.start);
  const [periodEnd, setPeriodEnd] = React.useState(initialDates.end);
  const [accountName, setAccountName] = React.useState("");
  const [statementFile, setStatementFile] = React.useState<File | null>(null);
  const [openingBalance, setOpeningBalance] = React.useState("");
  const [closingBalance, setClosingBalance] = React.useState("");
  const [report, setReport] = React.useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [activeAction, setActiveAction] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState<"pdf" | "csv" | null>(null);
  const [balanceSavingId, setBalanceSavingId] = React.useState<string | null>(null);
  const [balanceDrafts, setBalanceDrafts] = React.useState<Record<string, { openingBalance: string; closingBalance: string }>>({});
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [drafts, setDrafts] = React.useState<Record<string, {
    targetKey: string;
    search: string;
    type: BankEntryType;
    category: string;
    note: string;
    entryDate: string;
  }>>({});
  const requestRef = React.useRef(request);
  const onChangedRef = React.useRef(onChanged);
  const loadSequence = React.useRef(0);
  React.useEffect(() => { requestRef.current = request; }, [request]);
  React.useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const loadReport = React.useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await requestRef.current<ReconciliationReport>(reportUrl(year, quarter));
      if (sequence === loadSequence.current) {
        setReport(next);
        setDrafts({});
        setBalanceDrafts(Object.fromEntries(next.statements.map((statement) => [statement.id, {
          openingBalance: statement.openingBalance === null ? "" : String(statement.openingBalance),
          closingBalance: statement.closingBalance === null ? "" : String(statement.closingBalance),
        }])));
      }
    } catch (loadError) {
      if (sequence === loadSequence.current) {
        setReport(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load bank reconciliation");
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [year, quarter]);

  React.useEffect(() => { void loadReport(); }, [loadReport]);
  React.useEffect(() => {
    const dates = quarterDates(year, quarter);
    setPeriodStart(dates.start);
    setPeriodEnd(dates.end);
  }, [year, quarter]);

  const updateDraft = (transaction: ReconciliationTransaction, patch: Partial<{
    targetKey: string;
    search: string;
    type: BankEntryType;
    category: string;
    note: string;
    entryDate: string;
  }>) => {
    setDrafts((current) => {
      const existing = current[transaction.id] || {
        targetKey: "",
        search: "",
        type: transaction.direction === "in" ? "income" : "expense",
        category: transaction.category || "",
        note: "",
        entryDate: dateInputValue(transaction.entryDate),
      };
      return { ...current, [transaction.id]: { ...existing, ...patch } };
    });
  };
  const getDraft = (transaction: ReconciliationTransaction) => drafts[transaction.id] || {
    targetKey: "",
    search: "",
    type: transaction.direction === "in" ? "income" as const : "expense" as const,
    category: transaction.category || "",
    note: "",
    entryDate: dateInputValue(transaction.entryDate),
  };
  const records = report?.internalRecords || [];
  const downloadPacket = async (format: "pdf" | "csv") => {
    setError("");
    setMessage("");
    setDownloading(format);
    const query = `year=${encodeURIComponent(year)}&quarter=${encodeURIComponent(quarter)}&format=${format}`;
    try {
      const token = localStorage.getItem("repairos_token");
      const response = await fetch(`${API_URL}/finance/reconciliation/packet?${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Unable to download ${format.toUpperCase()} packet (HTTP ${response.status})`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `reconciliation-${year}-Q${quarter}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : `Unable to download ${format.toUpperCase()} packet`);
    } finally {
      setDownloading(null);
    }
  };
  const uploadStatement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!statementFile) {
      setError("Choose a bank statement PDF or CSV before uploading.");
      return;
    }
    if (periodStart > periodEnd) {
      setError("Statement period start must be on or before its end date.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", statementFile);
      form.append("accountName", accountName.trim());
      form.append("periodStart", periodStart);
      form.append("periodEnd", periodEnd);
      if (openingBalance.trim()) form.append("openingBalance", openingBalance.trim());
      if (closingBalance.trim()) form.append("closingBalance", closingBalance.trim());
      await requestRef.current<{ id: string; reused: boolean }>("/finance/reconciliation/statements", {
        method: "POST",
        body: form,
      });
      await loadReport();
      await onChangedRef.current();
      setMessage("Statement saved for review. No ledger entries were created.");
      setStatementFile(null);
      const fileInput = document.getElementById("reconciliation-statement-file") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to save bank statement");
    } finally {
      setUploading(false);
    }
  };
  const saveStatementBalances = async (
    event: React.FormEvent<HTMLFormElement>,
    statementId: string,
  ) => {
    event.preventDefault();
    const values = balanceDrafts[statementId];
    if (!values) return;
    const parseBalance = (value: string): number | null => value.trim() === "" ? null : Number(value);
    const openingBalance = parseBalance(values.openingBalance);
    const closingBalance = parseBalance(values.closingBalance);
    if ((openingBalance !== null && !Number.isFinite(openingBalance)) || (closingBalance !== null && !Number.isFinite(closingBalance))) {
      setError("Enter a valid opening and closing balance, or leave either field blank.");
      return;
    }
    setError("");
    setMessage("");
    setBalanceSavingId(statementId);
    try {
      await requestRef.current(`/finance/reconciliation/statements/${encodeURIComponent(statementId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingBalance, closingBalance }),
      });
      await loadReport();
      setMessage("Statement balances saved. Balance checks and warnings have been refreshed.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update statement balances");
    } finally {
      setBalanceSavingId(null);
    }
  };

  const review = async (
    transaction: ReconciliationTransaction,
    action: "match" | "create" | "exclude" | "reset",
  ) => {
    const draft = getDraft(transaction);
    const target = records.find((record) => record.key === draft.targetKey);
    const note = draft.note.trim();
    if (action === "match") {
      if (!target) {
        setError("Choose an existing invoice, job payment, expense, or other ledger record to match.");
        return;
      }
      if (amountCents(target.amount) !== amountCents(transaction.amount) || recordDirection(target) !== transaction.direction) {
        setError("A match must have the exact same amount and cash direction as the bank row.");
        return;
      }
      const gap = dateGapDays(transaction.entryDate, target.date);
      if (gap !== null && gap > 7 && !note) {
        setError("Add a review note when the bank date and ledger date differ by more than 7 days.");
        return;
      }
    }
    if (action === "create") {
      if (transaction.state === "conflicting" && !note) {
        setError("Explain why this bank-only entry should be created despite its conflicting candidate.");
        return;
      }
      if (!draft.entryDate || !draft.category) {
        setError("Choose an entry date and category before creating a ledger entry.");
        return;
      }
      const confirmed = window.confirm(
        `Create a new ${draft.type.replace("_", " ")} ledger entry for ${currency(transaction.amount)}?\n\nThis adds an entry to the ledger. First verify it is not already recorded under another description.`,
      );
      if (!confirmed) return;
    }
    if (action === "exclude" && !note) {
      setError("Add a note explaining why this bank transaction is excluded from reconciliation.");
      return;
    }
    setError("");
    setMessage("");
    setActiveAction(transaction.id);
    try {
      const body: Record<string, string> = { action };
      if (action === "match") {
        body.targetKey = draft.targetKey;
        if (note) body.note = note;
      } else if (action === "create") {
        body.type = draft.type;
        body.category = draft.category;
        body.note = note;
        body.entryDate = dateInputValue(draft.entryDate);
      } else if (action === "exclude") {
        body.note = note;
      } else if (note) {
        body.note = note;
      }
      await requestRef.current(`/finance/reconciliation/transactions/${encodeURIComponent(transaction.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadReport();
      await onChangedRef.current();
      setMessage(`Review action saved for “${transaction.description}”.`);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Unable to save reconciliation review");
    } finally {
      setActiveAction(null);
    }
  };

  const reportGaps = report ? calculateCoverage(report) : [];
  const incomplete = Boolean(report && (report.totals.unresolved > 0 || report.totals.unbanked > 0 || reportGaps.length > 0));
  const pendingCount = report?.transactions.filter((transaction) => transaction.state === "unmatched").length || 0;
  const conflictCount = report?.transactions.filter((transaction) => transaction.state === "conflicting").length || 0;
  const years = [...new Set([year, ...Array.from({ length: 11 }, (_, index) => currentDate.getFullYear() + 1 - index)])]
    .sort((a, b) => b - a);

  return (
    <section className="bank-reconciliation" aria-labelledby="reconciliation-heading">
      <header className="recon-header">
        <div>
          <p className="eyebrow">Bank activity review</p>
          <h2 id="reconciliation-heading">Bank reconciliation</h2>
          <p>Compare imported statement rows with invoices, job payments, expenses, and other ledger activity. Nothing is matched or booked automatically.</p>
        </div>
        <div className={`recon-status ${incomplete || !report ? "needs-review" : "review-complete"}`} role="status">
          {loading ? "Loading review…" : !report ? "Report unavailable" : incomplete ? "Review not complete" : "Review complete"}
        </div>
      </header>

      <div className="recon-toolbar">
        <label>
          Year
          <select aria-label="Reconciliation year" value={year} disabled={loading || uploading || Boolean(activeAction)} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          Quarter
          <select aria-label="Reconciliation quarter" value={quarter} disabled={loading || uploading || Boolean(activeAction)} onChange={(event) => setQuarter(Number(event.target.value))}>
            {[1, 2, 3, 4].map((option) => <option key={option} value={option}>Q{option}</option>)}
          </select>
        </label>
        <span className="recon-period">{report ? `${displayDate(report.from)} – ${displayDate(report.to)}` : `Q${quarter} ${year}`}</span>
        <div className="recon-download-actions">
          <button type="button" className="secondary-button" disabled={loading || Boolean(downloading)} onClick={() => void downloadPacket("pdf")}>{downloading === "pdf" ? "Downloading PDF…" : "Quarterly PDF packet"}</button>
          <button type="button" className="secondary-button" disabled={loading || Boolean(downloading)} onClick={() => void downloadPacket("csv")}>{downloading === "csv" ? "Downloading CSV…" : "Transaction CSV"}</button>
        </div>
      </div>

      {error && <div className="recon-alert recon-error" role="alert">{error}</div>}
      {message && <div className="recon-alert recon-success" role="status">{message}</div>}

      <form className="surface recon-upload" onSubmit={(event) => void uploadStatement(event)}>
        <div className="surface-heading">
          <div>
            <p className="eyebrow">Add statement</p>
            <h3>Upload bank PDF or CSV</h3>
            <p className="muted">Use the same account name on every import for a consistent review trail. Uploading stores statement rows only; it does not write to the ledger.</p>
          </div>
        </div>
        <div className="recon-upload-fields">
          <label>Account name<input required value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="e.g. Main checking" /></label>
          <label>Statement file<input id="reconciliation-statement-file" required type="file" accept=".pdf,.csv,application/pdf,text/csv" onChange={(event) => setStatementFile(event.currentTarget.files?.[0] || null)} /></label>
          <label>Period starts<input required type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
          <label>Period ends<input required type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
          <label>Opening balance <span className="optional-label">optional</span><input type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} placeholder="Not verified if omitted" /></label>
          <label>Closing balance <span className="optional-label">optional</span><input type="number" step="0.01" value={closingBalance} onChange={(event) => setClosingBalance(event.target.value)} placeholder="Not verified if omitted" /></label>
        </div>
        <div className="recon-upload-footer">
          <small>Opening and closing balances are optional and are not independently verified.</small>
          <button type="submit" className="orange-button" disabled={uploading || loading || Boolean(activeAction)}>{uploading ? "Saving statement…" : "Save statement for review"}</button>
        </div>
      </form>

      {report && <>
        <section className="recon-metrics" aria-label="Quarter reconciliation totals">
          <Metric label="Bank in" value={currency(report.totals.bankIn)} />
          <Metric label="Bank out" value={currency(report.totals.bankOut)} />
          <Metric label="Internal income" value={currency(report.totals.internalIncome)} />
          <Metric label="Internal expenses" value={currency(report.totals.internalExpenses)} />
          <Metric label="Bank net" value={currency(report.totals.bankNet)} />
          <Metric label="Internal net" value={currency(report.totals.internalNet)} />
          <Metric label="Unresolved" value={String(report.totals.unresolved)} warning={report.totals.unresolved > 0} />
          <Metric label="Internal-only items" value={String(report.totals.unbanked)} warning={report.totals.unbanked > 0} />
        </section>

        <section className="surface recon-highlights">
          <div className="surface-heading"><div><p className="eyebrow">Quarterly highlights</p><h3>{incomplete ? "Items still need attention" : "Review summary"}</h3></div></div>
          {report.highlights.length > 0 ? <ul>{report.highlights.map((highlight, index) => <li key={`${index}-${highlight}`}>{highlight}</li>)}</ul> : <p className="muted">No additional highlights returned for this quarter.</p>}
          <p className="recon-review-counts"><strong>{report.totals.matched}</strong> matched · <strong>{pendingCount}</strong> pending · <strong>{conflictCount}</strong> conflicts · <strong>{report.totals.excluded}</strong> excluded</p>
          {reportGaps.length > 0 && <p className="recon-warning"><strong>Missing statement coverage:</strong> {reportGaps.map((gap) => `${displayDate(gap.start)}–${displayDate(gap.end)}`).join(", ")}</p>}
          {!report.statements.length && <p className="recon-warning">No bank statements cover this quarter. Reconciliation is not complete.</p>}
          <p className="recon-disclaimer">{incomplete ? "This packet is a working review, not a finalized reconciliation." : "All listed rows have a review disposition. This report is not tax certification."} Excluded rows remain included in bank cash totals.</p>
        </section>

        <section className="surface recon-statements">
          <div className="surface-heading"><div><p className="eyebrow">Imported files</p><h3>Statement coverage and balances</h3></div><span className="muted">{report.statements.length} statement{report.statements.length === 1 ? "" : "s"}</span></div>
          {report.statements.length ? <div className="recon-table-scroll">
            <table className="recon-table">
              <caption className="visually-hidden">Uploaded bank statements, editable opening and closing balances, coverage, and balance warnings</caption>
              <thead><tr><th>Account / file</th><th>Coverage</th><th>Rows</th><th colSpan={2}>Balances</th><th>Difference</th><th>Warnings / action</th></tr></thead>
              <tbody>{report.statements.map((statement) => <tr key={statement.id}>
                <td data-label="Account / file"><strong>{statement.accountName}</strong><span>{statement.fileName}</span></td>
                <td data-label="Coverage">{displayDate(statement.periodStart)} – {displayDate(statement.periodEnd)}</td>
                <td data-label="Rows">{statement.transactionCount}</td>
                <td data-label="Balances" colSpan={2}>
                  <form className="recon-balance-form" onSubmit={(event) => void saveStatementBalances(event, statement.id)}>
                    <label>Opening balance
                      <input
                        type="number"
                        step="0.01"
                        value={balanceDrafts[statement.id]?.openingBalance ?? (statement.openingBalance === null ? "" : String(statement.openingBalance))}
                        onChange={(event) => setBalanceDrafts((current) => ({ ...current, [statement.id]: {
                          openingBalance: event.target.value,
                          closingBalance: current[statement.id]?.closingBalance ?? (statement.closingBalance === null ? "" : String(statement.closingBalance)),
                        } }))}
                        aria-label={`Opening balance for ${statement.accountName}, ${statement.fileName}`}
                        placeholder="Not provided"
                      />
                    </label>
                    <label>Closing balance
                      <input
                        type="number"
                        step="0.01"
                        value={balanceDrafts[statement.id]?.closingBalance ?? (statement.closingBalance === null ? "" : String(statement.closingBalance))}
                        onChange={(event) => setBalanceDrafts((current) => ({ ...current, [statement.id]: {
                          openingBalance: current[statement.id]?.openingBalance ?? (statement.openingBalance === null ? "" : String(statement.openingBalance)),
                          closingBalance: event.target.value,
                        } }))}
                        aria-label={`Closing balance for ${statement.accountName}, ${statement.fileName}`}
                        placeholder="Not provided"
                      />
                    </label>
                    <button type="submit" className="secondary-button" disabled={loading || uploading || Boolean(activeAction) || balanceSavingId !== null}>
                      {balanceSavingId === statement.id ? "Checking…" : "Save balances & rerun checks"}
                    </button>
                  </form>
                </td>
                <td data-label="Difference">{statement.balanceDifference === null ? <span className="recon-warning">Not verified</span> : <span className={Math.abs(statement.balanceDifference) > 0.005 ? "recon-warning" : ""}>{currency(statement.balanceDifference)}{Math.abs(statement.balanceDifference) > 0.005 ? " · check" : ""}</span>}</td>
                <td data-label="Warnings / action">{statement.warnings.length ? statement.warnings.join("; ") : "—"}{statement.openingBalance === null || statement.closingBalance === null ? <span className="recon-warning"> Enter missing balances above to rerun checks.</span> : null}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="recon-empty">No statements uploaded for this reporting period.</p>}
        </section>

        <section className="surface recon-transactions">
          <div className="surface-heading"><div><p className="eyebrow">Human review required</p><h3>Bank transactions</h3><p className="muted">Rows with missing dates remain available here. Match an existing record, create a bank-only ledger entry after confirmation, exclude with a note, or reset a saved match.</p></div><span className="muted">{report.transactions.length} row{report.transactions.length === 1 ? "" : "s"}</span></div>
          {report.transactions.length ? <div className="recon-transaction-list">
            {report.transactions.map((transaction) => {
              const draft = getDraft(transaction);
              const selectedRecord = records.find((record) => record.key === draft.targetKey);
              const query = draft.search.trim().toLocaleLowerCase();
              const searchedRecords = query ? records.filter((record) =>
                [record.description, record.kind, record.id, record.key, record.sourceReference, record.type]
                  .some((value) => value?.toLocaleLowerCase().includes(query)),
              ) : [];
              const optionRecords = [...new Map([...transaction.candidates, ...searchedRecords].map((record) => [record.key, record])).values()];
              const gap = selectedRecord ? dateGapDays(transaction.entryDate, selectedRecord.date) : null;
              const requiresDateNote = gap !== null && gap > 7;
              const createAction = transaction.state === "unmatched" || transaction.state === "conflicting";
              return <article className={`recon-transaction-card state-${transaction.state}`} key={transaction.id}>
                <div className="recon-transaction-main">
                  <div className="recon-transaction-title">
                    <span className={`recon-badge ${transaction.state}`}>{transaction.state === "conflicting" ? "conflicting · suggested match unresolved" : transaction.state}</span>
                    <strong>{transaction.description || "Bank row without description"}</strong>
                  </div>
                  <div className="recon-transaction-facts">
                    <span><b>Date:</b> {displayDate(transaction.entryDate)}</span>
                    <span><b>Direction:</b> {transaction.direction === "in" ? "Money in" : "Money out"}</span>
                    <span><b>Amount:</b> <strong>{currency(transaction.amount)}</strong></span>
                    {transaction.category && <span><b>Category:</b> {transaction.category}</span>}
                    <span><b>Account:</b> {transaction.accountKey}</span>
                  </div>
                  <p className="recon-reason">{transaction.reason || "No additional review note from the parser."}</p>
                  {transaction.matchedSource && <p className="recon-match-info"><strong>Matched source:</strong> {transaction.matchedSource}</p>}
                  {transaction.reviewNote && <p className="recon-match-info"><strong>Saved review note:</strong> {transaction.reviewNote}</p>}
                  {transaction.candidates.length > 0 && <div className="recon-candidates">
                    <strong>Possible ledger records ({transaction.candidates.length})</strong>
                    <ul>{transaction.candidates.map((candidate) => <li key={candidate.key}>
                      <b>{candidate.description}</b> · {candidate.kind} · {displayDate(candidate.date)} · {currency(candidate.amount)} · ID {candidate.id}
                    </li>)}</ul>
                  </div>}
                </div>
                <div className="recon-review-form">
                  {(transaction.state === "unmatched" || transaction.state === "conflicting") && <>
                    <label>Search ledger records<input type="search" value={draft.search} onChange={(event) => updateDraft(transaction, { search: event.target.value })} placeholder="Invoice, job, payment, expense, ID…" aria-label={`Search records for ${transaction.description}`} /></label>
                    <label>Choose an existing record
                      <select value={draft.targetKey} onChange={(event) => updateDraft(transaction, { targetKey: event.target.value })} aria-label={`Match target for ${transaction.description}`}>
                        <option value="">Select a record — no changes yet</option>
                        {optionRecords.map((record) => {
                          const valid = amountCents(record.amount) === amountCents(transaction.amount) && recordDirection(record) === transaction.direction;
                          return <option key={record.key} value={record.key} disabled={!valid}>
                            {record.description} · {record.kind} · {displayDate(record.date)} · {currency(record.amount)} · {record.id}{valid ? "" : " (amount/direction differs)"}
                          </option>;
                        })}
                        {query && optionRecords.length === 0 && <option disabled>No records found</option>}
                      </select>
                    </label>
                    {selectedRecord && <p className="recon-selection-note">
                      Selected: <strong>{selectedRecord.description}</strong> · {selectedRecord.kind} · {displayDate(selectedRecord.date)} · {currency(selectedRecord.amount)} · ID {selectedRecord.id}
                      {requiresDateNote && <span className="recon-warning"> Date differs by more than 7 days; add a note.</span>}
                    </p>}
                    {createAction && <div className="recon-create-fields">
                      <strong>Create bank-only ledger entry</strong>
                      <p>Only use this if you confirm it is not already represented in the ledger.</p>
                      <label>Entry date<input required type="date" value={draft.entryDate} onChange={(event) => updateDraft(transaction, { entryDate: event.target.value })} /></label>
                      <label>Ledger type<select value={draft.type} onChange={(event) => updateDraft(transaction, { type: event.target.value as BankEntryType })}>
                        {(transaction.direction === "in" ? [["income", "Income"], ["transfer_in", "Transfer in"]] : [["expense", "Expense"], ["transfer_out", "Transfer out"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select></label>
                      <label>Category<select required value={draft.category} onChange={(event) => updateDraft(transaction, { category: event.target.value })}>
                        <option value="">Choose category</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select></label>
                    </div>}
                    <label>Review note{transaction.state === "conflicting" || requiresDateNote ? <span className="optional-label">required</span> : <span className="optional-label">optional</span>}
                      <textarea value={draft.note} onChange={(event) => updateDraft(transaction, { note: event.target.value })} rows={2} placeholder={transaction.state === "conflicting" ? "Explain how you resolved the candidate conflict" : "Add context for this decision"} />
                    </label>
                    <div className="recon-row-actions">
                      <button type="button" className="secondary-button" disabled={loading || uploading || Boolean(activeAction) || !selectedRecord || amountCents(selectedRecord.amount) !== amountCents(transaction.amount) || recordDirection(selectedRecord) !== transaction.direction || (requiresDateNote && !draft.note.trim())} onClick={() => void review(transaction, "match")}>
                        {activeAction === transaction.id ? "Saving…" : "Match selected"}
                      </button>
                      {createAction && <button type="button" className="secondary-button" disabled={loading || uploading || Boolean(activeAction) || !draft.entryDate || !draft.category || (transaction.state === "conflicting" && !draft.note.trim())} onClick={() => void review(transaction, "create")}>Create ledger entry…</button>}
                      <button type="button" className="text-button" disabled={loading || uploading || Boolean(activeAction) || !draft.note.trim()} onClick={() => void review(transaction, "exclude")}>Exclude with note</button>
                    </div>
                  </>}
                  {(transaction.state === "matched" || transaction.state === "excluded") && <div className="recon-row-actions">
                    <button type="button" className="secondary-button" disabled={loading || uploading || Boolean(activeAction)} onClick={() => void review(transaction, "reset")}>{activeAction === transaction.id ? "Saving…" : transaction.state === "matched" ? "Reset match" : "Reset exclusion"}</button>
                    {transaction.state === "matched" && <span className="recon-reset-help">To review this as a bank-only entry, reset the match first. The server may reject reset if this review created a ledger entry; its error will appear above.</span>}
                    {transaction.state === "excluded" && transaction.reviewNote && <span className="recon-reset-help">Exclusion note: {transaction.reviewNote}</span>}
                  </div>}
                </div>
              </article>;
            })}
          </div> : <p className="recon-empty">No bank transactions found within this quarter. Rows outside the quarter are not shown here.</p>}
        </section>

        <section className="surface recon-unbanked">
          <div className="surface-heading"><div><p className="eyebrow">Ledger coverage</p><h3>Unbanked internal records</h3><p className="muted">Existing income or expenses in the ledger that have no matching statement row.</p></div><strong>{report.unbanked.length}</strong></div>
          {report.unbanked.length ? <div className="recon-table-scroll">
            <table className="recon-table">
              <caption className="visually-hidden">Internal ledger records not represented by bank transactions</caption>
              <thead><tr><th>Record</th><th>Source / ID</th><th>Date</th><th>Type</th><th>Amount</th><th>Category</th></tr></thead>
              <tbody>{report.unbanked.map((record) => <tr key={record.key}>
                <td data-label="Record"><strong>{record.description}</strong></td><td data-label="Source / ID">{record.kind} · {record.id}</td>
                <td data-label="Date">{displayDate(record.date)}</td><td data-label="Type">{record.type}</td><td data-label="Amount">{currency(record.amount)}</td><td data-label="Category">{record.category || "—"}</td>
              </tr>)}</tbody>
            </table>
            </div> : <p className="recon-empty">No unbanked internal records are reported for this quarter.</p>}
        </section>

        <section className="surface recon-invoices">
            <div className="surface-heading"><div><p className="eyebrow">Invoice context</p><h3>Quarter invoice balances</h3><p className="muted">Use invoice status and paid balance when reviewing incoming bank rows and job payments.</p></div><strong>{report.invoices.length}</strong></div>
            {report.invoices.length ? <div className="recon-table-scroll">
              <table className="recon-table">
                <caption className="visually-hidden">Invoices and their payment balances for reconciliation context</caption>
                <thead><tr><th>Invoice</th><th>Status</th><th>Issued</th><th>Total</th><th>Paid</th><th>Balance due</th></tr></thead>
                <tbody>{report.invoices.map((invoice) => <tr key={invoice.id}>
                  <td data-label="Invoice"><strong>{invoice.invoiceNumber}</strong><span>ID {invoice.id}</span></td>
                  <td data-label="Status">{invoice.status}</td><td data-label="Issued">{displayDate(invoice.issueDate)}</td>
                  <td data-label="Total">{currency(invoice.total)}</td><td data-label="Paid">{currency(invoice.amountPaid)}</td><td data-label="Balance due">{currency(invoice.balanceDue)}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="recon-empty">No invoices returned for this reporting period.</p>}
        </section>
      </>}
    </section>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className={`recon-metric ${warning ? "warning" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}
