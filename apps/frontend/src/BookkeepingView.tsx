import React from "react";

type JobOption = { id: string; jobNumber: string };
type ClaimOption = {
  id: string;
  claimNumber: string | null;
  customer: { firstName: string; lastName: string };
};
type FinanceEntry = {
  id: string;
  type: "income" | "expense";
  description: string;
  category: string | null;
  amount: number;
  paymentMethod: string | null;
  entryDate: string;
  notes: string | null;
  sourceReference?: string | null;
  job?: { jobNumber: string } | null;
  claim?: { claimNumber: string | null } | null;
};
type RecurringExpense = {
  id: string;
  name: string;
  amount: number;
  category: string | null;
  frequency: "weekly" | "monthly" | "yearly";
  startDate: string;
  active: boolean;
};
type FinanceSummary = {
  income: number;
  generalExpenses: number;
  jobExpenses: number;
  expenses: number;
  net: number;
};
type BankBalance = {
  startingBalance: number;
  income: number;
  expenses: number;
  currentBalance: number;
};
type FinanceData = {
  entries: FinanceEntry[];
  recurring: RecurringExpense[];
  summary: FinanceSummary;
};
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;

const paymentMethods = [
  ["cash", "Cash"],
  ["debit_card", "Debit card"],
  ["credit_card", "Credit card"],
  ["check", "Check"],
  ["ach", "ACH"],
  ["other", "Other"],
];
const categories = [
  "Parts",
  "Labor",
  "Payroll",
  "Rent",
  "Utilities",
  "Insurance",
  "Marketing",
  "Other",
];
const currency = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateValue = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const emptyEntry = {
  type: "income",
  description: "",
  category: "",
  amount: "",
  entryDate: new Date().toISOString().slice(0, 10),
  paymentMethod: "cash",
  jobId: "",
  claimId: "",
  notes: "",
};
const emptyRecurring = {
  name: "",
  amount: "",
  category: "Rent",
  frequency: "monthly",
  startDate: new Date().toISOString().slice(0, 10),
  active: true,
};

export function BookkeepingView({
  data,
  jobs,
  claims,
  request,
  onChanged,
}: {
  data: FinanceData | null;
  jobs: JobOption[];
  claims: ClaimOption[];
  request: Request;
  onChanged: () => void;
}) {
  const [period, setPeriod] = React.useState("month");
  const [summary, setSummary] = React.useState<FinanceSummary | null>(
    data?.summary || null,
  );
  const [bankBalance, setBankBalance] = React.useState<BankBalance | null>(null);
  const [startingBalance, setStartingBalance] = React.useState("");
  const [forecastIncome, setForecastIncome] = React.useState({
    current: 0,
    prior: 0,
  });
  const [entryOpen, setEntryOpen] = React.useState(false);
  const [recurringOpen, setRecurringOpen] = React.useState(false);
  const [entry, setEntry] = React.useState(emptyEntry);
  const [recurring, setRecurring] = React.useState(emptyRecurring);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const entries = data?.entries || [];
  const recurringItems = data?.recurring || [];
  React.useEffect(() => {
    setSummary(data?.summary || null);
  }, [data]);
  React.useEffect(() => {
    void request<BankBalance>("/finance/bank-balance")
      .then((balance) => {
        setBankBalance(balance);
        setStartingBalance(String(balance.startingBalance));
      })
      .catch(() => undefined);
  }, [request]);
  React.useEffect(() => {
    void request<FinanceSummary>(`/finance/summary?period=${period}`)
      .then(setSummary)
      .catch(() => undefined);
  }, [period, request]);
  React.useEffect(() => {
    const now = new Date();
    const prior = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
      .toISOString()
      .slice(0, 10);
    void Promise.all([
      request<FinanceSummary>("/finance/summary?period=year"),
      request<FinanceSummary>(`/finance/summary?period=year&date=${prior}`),
    ])
      .then(([current, previous]) =>
        setForecastIncome({ current: current.income, prior: previous.income }),
      )
      .catch(() => undefined);
  }, [request]);
  async function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("/finance/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...entry,
          amount: Number(entry.amount),
          jobId: entry.jobId || undefined,
          claimId: entry.claimId || undefined,
          category: entry.category || undefined,
          notes: entry.notes || undefined,
        }),
      });
      setEntry(emptyEntry);
      setEntryOpen(false);
      onChanged();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save entry",
      );
    } finally {
      setSaving(false);
    }
  }
  async function saveStartingBalance(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const balance = await request<BankBalance>("/finance/bank-balance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingBalance: Number(startingBalance) }),
      });
      setBankBalance(balance);
      setStartingBalance(String(balance.startingBalance));
      onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save starting balance");
    } finally {
      setSaving(false);
    }
  }
  async function saveRecurring(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("/finance/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...recurring,
          amount: Number(recurring.amount),
          category: recurring.category || undefined,
        }),
      });
      setRecurring(emptyRecurring);
      setRecurringOpen(false);
      onChanged();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save recurring expense",
      );
    } finally {
      setSaving(false);
    }
  }
  async function toggleRecurring(item: RecurringExpense) {
    try {
      await request(`/finance/recurring/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      onChanged();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update recurring expense",
      );
    }
  }
  const totals = summary || {
    income: 0,
    generalExpenses: 0,
    jobExpenses: 0,
    expenses: 0,
    net: 0,
  };
  const annualRecurring = recurringItems
    .filter((item) => item.active)
    .reduce(
      (total, item) =>
        total +
        item.amount *
          (item.frequency === "weekly"
            ? 52
            : item.frequency === "monthly"
              ? 12
              : 1),
      0,
    );
  const priorYear = forecastIncome.prior;
  const maxBar = Math.max(totals.income, totals.expenses, 1);
  return (
    <div className="bookkeeping-workspace">
      {error && <div className="error-banner">{error}</div>}
      <section className="finance-toolbar">
        <div>
          <p className="eyebrow">Financial control</p>
          <h2>Bookkeeping overview</h2>
          <p className="subheading">
            Track shop cash flow, operating costs, and recurring commitments.
          </p>
        </div>
        <div className="finance-actions">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            aria-label="Summary period"
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
          </select>
          <button className="orange-button" onClick={() => setEntryOpen(true)}>
            New entry
          </button>
        </div>
      </section>
      <section className="surface bank-balance-panel">
        <div>
          <p className="eyebrow">Cash position</p>
          <h2>Bank balance</h2>
          <p className="subheading">Set the opening balance once. New income and expenses update the current balance automatically.</p>
        </div>
        <div className="bank-balance-current">
          <span>Current balance</span>
          <strong>{currency(bankBalance?.currentBalance || 0)}</strong>
          <small>{currency(bankBalance?.income || 0)} income · {currency(bankBalance?.expenses || 0)} expenses</small>
        </div>
        <form className="bank-balance-form" onSubmit={saveStartingBalance}>
          <label>Starting balance<input required min="0" step="0.01" type="number" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} /></label>
          <button className="orange-button" disabled={saving}>{saving ? "Saving..." : "Save balance"}</button>
        </form>
      </section>
      <section className="metric-grid finance-metrics">
        <Metric
          label="Income"
          value={currency(totals.income)}
          note={`Current ${period}`}
          tone="green"
        />
        <Metric
          label="Job expenses"
          value={currency(totals.jobExpenses)}
          note="Parts, labor, and job costs"
          tone="blue"
        />
        <Metric
          label="General expenses"
          value={currency(totals.generalExpenses)}
          note="Operating expenses"
          tone="orange"
        />
        <Metric
          label="Net"
          value={currency(totals.net)}
          note={`${currency(totals.expenses)} total expenses`}
          tone={totals.net >= 0 ? "green" : "orange"}
        />
      </section>
      <div className="dashboard-grid finance-grid">
        <section className="surface">
          <div className="surface-heading">
            <div>
              <h2>Ledger</h2>
              <p>Income and expense activity</p>
            </div>
            <button className="text-button" onClick={() => setEntryOpen(true)}>
              Add entry <span>+</span>
            </button>
          </div>
          <div className="finance-table-wrap">
            <table className="data-table finance-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Method</th>
                  <th>Claim / job</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((item) => (
                  <tr key={item.id}>
                    <td>{dateValue(item.entryDate)}</td>
                    <td>
                      <strong>{item.description}</strong>
                      {item.notes && (
                        <small className="table-subtext">{item.notes}</small>
                      )}
                    </td>
                    <td>{item.category || "Uncategorized"}</td>
                    <td>{item.paymentMethod?.replace("_", " ") || "-"}</td>
                    <td>
                      {item.claim?.claimNumber
                        ? `Claim ${item.claim.claimNumber}`
                        : item.job?.jobNumber || "General"}
                    </td>
                    <td
                      className={
                        item.type === "income"
                          ? "finance-income"
                          : "finance-expense"
                      }
                    >
                      <span>{item.type === "income" ? "+" : "-"}{currency(item.amount)}</span>
                      {item.sourceReference ? <small className="table-subtext">Synced source · deletion disabled</small> : <button type="button" className="danger-button compact-danger" onClick={async () => { if (!window.confirm(`Delete ledger entry "${item.description}"?`)) return; setError(""); try { await request(`/finance/entries/${item.id}`, { method: "DELETE" }); await onChanged(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete ledger entry"); } }}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!entries.length && (
            <div className="empty-state">
              No bookkeeping entries for this workspace yet.
            </div>
          )}
        </section>
        <section className="surface finance-chart">
          <div className="surface-heading">
            <div>
              <h2>Income vs expenses</h2>
              <p>{period === "year" ? "Year to date" : `Current ${period}`}</p>
            </div>
          </div>
          <div className="bar-chart">
            <div className="bar-group">
              <div
                className="bar income-bar"
                style={{
                  height: `${Math.max(8, (totals.income / maxBar) * 100)}%`,
                }}
              />
              <span>Income</span>
              <strong>{currency(totals.income)}</strong>
            </div>
            <div className="bar-group">
              <div
                className="bar expense-bar"
                style={{
                  height: `${Math.max(8, (totals.expenses / maxBar) * 100)}%`,
                }}
              />
              <span>Expenses</span>
              <strong>{currency(totals.expenses)}</strong>
            </div>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-income" /> Income
            </span>
            <span>
              <i className="legend-expense" /> Expenses
            </span>
          </div>
        </section>
      </div>
      <section className="surface recurring-panel">
        <div className="surface-heading">
          <div>
            <h2>Recurring expenses</h2>
            <p>Fixed commitments used in the annual forecast</p>
          </div>
          <button
            className="orange-button"
            onClick={() => setRecurringOpen(true)}
          >
            Add recurring
          </button>
        </div>
        <div className="recurring-list">
          {recurringItems.map((item) => (
            <div className="recurring-row" key={item.id}>
              <div className="recurring-name">
                <span className={item.active ? "active-dot" : "inactive-dot"} />
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.category || "General"} · Starts{" "}
                    {dateValue(item.startDate)}
                  </small>
                </div>
              </div>
              <span className="frequency-pill">{item.frequency}</span>
              <strong>
                {currency(item.amount)}
                <small>
                  per{" "}
                  {item.frequency === "yearly"
                    ? "year"
                    : item.frequency === "monthly"
                      ? "month"
                      : "week"}
                </small>
              </strong>
              <button
                className="toggle-button"
                onClick={() => void toggleRecurring(item)}
              >
                {item.active ? "Active" : "Paused"}
              </button>
              <button type="button" className="danger-button compact-danger" onClick={async () => { if (!window.confirm(`Delete recurring expense "${item.name}"?`)) return; setError(""); try { await request(`/finance/recurring/${item.id}`, { method: "DELETE" }); await onChanged(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete recurring expense"); } }}>Delete</button>
            </div>
          ))}
        </div>
        {!recurringItems.length && (
          <div className="empty-state">
            Add rent, utilities, insurance, or other fixed costs.
          </div>
        )}
      </section>
      <section className="forecast-grid">
        <div className="surface">
          <div className="surface-heading">
            <div>
              <h2>Annual forecast</h2>
              <p>Current year compared with the prior year</p>
            </div>
          </div>
          <div className="forecast-bars">
            <ForecastBar
              label="Current year income"
              value={forecastIncome.current}
              max={Math.max(
                priorYear,
                forecastIncome.current,
                annualRecurring,
                1,
              )}
              tone="income"
            />
            <ForecastBar
              label="Prior year income"
              value={priorYear}
              max={Math.max(
                priorYear,
                forecastIncome.current,
                annualRecurring,
                1,
              )}
              tone="prior"
            />
            <ForecastBar
              label="Projected recurring expenses"
              value={annualRecurring}
              max={Math.max(
                priorYear,
                forecastIncome.current,
                annualRecurring,
                1,
              )}
              tone="expense"
            />
          </div>
        </div>
        <div className="surface forecast-callout">
          <p className="eyebrow">Planning signal</p>
          <strong>{currency(annualRecurring)}</strong>
          <p>
            Projected recurring expenses per year across{" "}
            {recurringItems.filter((item) => item.active).length} active
            commitments.
          </p>
        </div>
      </section>
      {entryOpen && (
        <div className="modal-backdrop">
          <form className="modal finance-modal" onSubmit={saveEntry}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Ledger entry</p>
                <h2>Record transaction</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setEntryOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="finance-form-grid">
              <label>
                Type
                <select
                  value={entry.type}
                  onChange={(event) =>
                    setEntry({
                      ...entry,
                      type: event.target.value as "income" | "expense",
                    })
                  }
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </label>
              <label>
                Amount
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={entry.amount}
                  onChange={(event) =>
                    setEntry({ ...entry, amount: event.target.value })
                  }
                />
              </label>
              <label>
                Linked claim
                <select
                  value={entry.claimId}
                  onChange={(event) =>
                    setEntry({ ...entry, claimId: event.target.value })
                  }
                >
                  <option value="">No linked claim</option>
                  {claims.map((claim) => (
                    <option key={claim.id} value={claim.id}>
                      {claim.claimNumber || "Unnumbered claim"} ·{" "}
                      {claim.customer.firstName} {claim.customer.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <input
                  required
                  value={entry.description}
                  onChange={(event) =>
                    setEntry({ ...entry, description: event.target.value })
                  }
                />
              </label>
              <label>
                Category
                <select
                  value={entry.category}
                  onChange={(event) =>
                    setEntry({ ...entry, category: event.target.value })
                  }
                >
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Entry date
                <input
                  required
                  type="date"
                  value={entry.entryDate}
                  onChange={(event) =>
                    setEntry({ ...entry, entryDate: event.target.value })
                  }
                />
              </label>
              <label>
                Payment method
                <select
                  value={entry.paymentMethod}
                  onChange={(event) =>
                    setEntry({ ...entry, paymentMethod: event.target.value })
                  }
                >
                  {paymentMethods.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Linked job
                <select
                  value={entry.jobId}
                  onChange={(event) =>
                    setEntry({ ...entry, jobId: event.target.value })
                  }
                >
                  <option value="">General shop expense</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.jobNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label className="finance-notes">
                Notes
                <textarea
                  value={entry.notes}
                  onChange={(event) =>
                    setEntry({ ...entry, notes: event.target.value })
                  }
                />
              </label>
            </div>
            <button className="orange-button submit-button" disabled={saving}>
              {saving ? "Saving..." : "Save entry"}
            </button>
          </form>
        </div>
      )}
      {recurringOpen && (
        <div className="modal-backdrop">
          <form className="modal finance-modal" onSubmit={saveRecurring}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Fixed cost</p>
                <h2>Add recurring expense</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setRecurringOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="finance-form-grid">
              <label>
                Name
                <input
                  required
                  placeholder="Shop rent"
                  value={recurring.name}
                  onChange={(event) =>
                    setRecurring({ ...recurring, name: event.target.value })
                  }
                />
              </label>
              <label>
                Amount
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={recurring.amount}
                  onChange={(event) =>
                    setRecurring({ ...recurring, amount: event.target.value })
                  }
                />
              </label>
              <label>
                Category
                <select
                  value={recurring.category}
                  onChange={(event) =>
                    setRecurring({ ...recurring, category: event.target.value })
                  }
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Frequency
                <select
                  value={recurring.frequency}
                  onChange={(event) =>
                    setRecurring({
                      ...recurring,
                      frequency: event.target
                        .value as typeof recurring.frequency,
                    })
                  }
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label>
                Start date
                <input
                  required
                  type="date"
                  value={recurring.startDate}
                  onChange={(event) =>
                    setRecurring({
                      ...recurring,
                      startDate: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <button className="orange-button submit-button" disabled={saving}>
              {saving ? "Saving..." : "Save recurring expense"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <span>$</span>
      </div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}
function ForecastBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
}) {
  return (
    <div className="forecast-row">
      <div>
        <span>{label}</span>
        <strong>{currency(value)}</strong>
      </div>
      <div className="forecast-track">
        <i
          className={tone}
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}
