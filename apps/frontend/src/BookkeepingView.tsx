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
type RollingSummary = { months: number; income: number; expenses: number; net: number };
type Employee = { id: string; name: string; phone: string | null; email: string | null; role: string | null; weeklyRate: number; startDate: string; active: boolean; payments: PayrollPayment[]; expectedToDate?: number; paidToDate?: number; balanceDue?: number };
type PayrollPayment = { id: string; amount: number; paymentDate: string; paymentMethod: string | null; notes: string | null };
type RentalTenant = { id: string; name: string; phone: string | null; email: string | null; space: string; shift: string; rentAmount: number; rentFrequency: string; startDate: string; active: boolean; payments: RentalPayment[]; expectedRentToDate?: number; rentCollected?: number; sharedExpensesCollected?: number; totalCollected?: number; netCollected?: number };
type RentalPayment = { id: string; type: "rent" | "shared_expense"; amount: number; paymentDate: string; paymentMethod: string | null; notes: string | null };
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
  const [rollingSummary, setRollingSummary] = React.useState<RollingSummary | null>(null);
  const [summary, setSummary] = React.useState<FinanceSummary | null>(
    data?.summary || null,
  );
  const [bankBalance, setBankBalance] = React.useState<BankBalance | null>(null);
  const [startingBalance, setStartingBalance] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<"ledger" | "payroll" | "rentals">("ledger");
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [employeeOpen, setEmployeeOpen] = React.useState(false);
  const [paymentEmployee, setPaymentEmployee] = React.useState<Employee | null>(null);
  const [employeeForm, setEmployeeForm] = React.useState({ name: "", role: "", phone: "", weeklyRate: "", startDate: new Date().toISOString().slice(0, 10) });
  const [paymentForm, setPaymentForm] = React.useState({ amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "cash", notes: "" });
  const [rentals, setRentals] = React.useState<RentalTenant[]>([]);
  const [rentalOpen, setRentalOpen] = React.useState(false);
  const [paymentRental, setPaymentRental] = React.useState<RentalTenant | null>(null);
  const [rentalForm, setRentalForm] = React.useState({ name: "", phone: "", email: "", shift: "day", rentAmount: "", rentFrequency: "daily", startDate: new Date().toISOString().slice(0, 10) });
  const [rentalPaymentForm, setRentalPaymentForm] = React.useState({ type: "rent", amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "cash", notes: "" });
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
    void request<Employee[]>("/finance/payroll").then(setEmployees).catch(() => undefined);
  }, [request, data]);
  React.useEffect(() => {
    void request<RentalTenant[]>("/finance/rentals/summary").then(setRentals).catch(() => undefined);
  }, [request, data]);
  React.useEffect(() => {
    if (period.endsWith("m")) {
      void request<RollingSummary>(`/finance/range?months=${period.slice(0, -1)}`)
        .then(setRollingSummary)
        .catch(() => undefined);
    } else {
      setRollingSummary(null);
      void request<FinanceSummary>(`/finance/summary?period=${period}`)
        .then(setSummary)
        .catch(() => undefined);
    }
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
  async function saveEmployee(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await request("/finance/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...employeeForm, weeklyRate: Number(employeeForm.weeklyRate), role: employeeForm.role || undefined, phone: employeeForm.phone || undefined }) }); setEmployeeOpen(false); setEmployeeForm({ name: "", role: "", phone: "", weeklyRate: "", startDate: new Date().toISOString().slice(0, 10) }); const payroll = await request<Employee[]>("/finance/payroll"); setEmployees(payroll); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save employee"); } finally { setSaving(false); }
  }
  async function savePayment(event: React.FormEvent) {
    event.preventDefault(); if (!paymentEmployee) return; setSaving(true); setError("");
    try { await request(`/finance/employees/${paymentEmployee.id}/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...paymentForm, amount: Number(paymentForm.amount) }) }); setPaymentEmployee(null); setPaymentForm({ amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "cash", notes: "" }); const payroll = await request<Employee[]>("/finance/payroll"); setEmployees(payroll); onChanged(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to record payroll payment"); } finally { setSaving(false); }
  }
  async function saveRental(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await request("/finance/rentals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rentalForm, rentAmount: Number(rentalForm.rentAmount), phone: rentalForm.phone || undefined, email: rentalForm.email || undefined }) }); setRentalOpen(false); setRentalForm({ name: "", phone: "", email: "", shift: "day", rentAmount: "", rentFrequency: "daily", startDate: new Date().toISOString().slice(0, 10) }); setRentals(await request<RentalTenant[]>("/finance/rentals/summary")); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save rental tenant"); } finally { setSaving(false); }
  }
  async function saveRentalPayment(event: React.FormEvent) {
    event.preventDefault(); if (!paymentRental) return; setSaving(true); setError("");
    try { await request(`/finance/rentals/${paymentRental.id}/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rentalPaymentForm, amount: Number(rentalPaymentForm.amount) }) }); setPaymentRental(null); setRentals(await request<RentalTenant[]>("/finance/rentals/summary")); setRentalPaymentForm({ type: "rent", amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "cash", notes: "" }); onChanged(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to record rental payment"); } finally { setSaving(false); }
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
  const selectedTotals = rollingSummary || totals;
  const trendMonths = period.endsWith("m") ? Number(period.slice(0, -1)) : 12;
  const trend = Array.from({ length: trendMonths }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - trendMonths + index + 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthEntries = entries.filter((entry) => entry.entryDate.startsWith(key));
    return { label: date.toLocaleDateString(undefined, { month: "short" }), income: monthEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0), expenses: monthEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0) };
  });
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
            <option value="month">This month</option>
            <option value="3m">Past 3 months</option>
            <option value="6m">Past 6 months</option>
            <option value="9m">Past 9 months</option>
            <option value="12m">Past 12 months</option>
          </select>
          <button className="orange-button" onClick={() => setEntryOpen(true)}>
            New entry
          </button>
        </div>
      </section>
      <div className="bookkeeping-tabs" role="tablist" aria-label="Bookkeeping views">
        <button type="button" className={activeTab === "ledger" ? "active" : ""} onClick={() => setActiveTab("ledger")}>Ledger</button>
        <button type="button" className={activeTab === "payroll" ? "active" : ""} onClick={() => setActiveTab("payroll")}>Employees &amp; payroll</button>
        <button type="button" className={activeTab === "rentals" ? "active" : ""} onClick={() => setActiveTab("rentals")}>Shop rentals</button>
      </div>
      {activeTab === "rentals" ? <section className="payroll-workspace rental-workspace">
        <div className="payroll-toolbar"><div><p className="eyebrow">Shared facility</p><h2>Shop rentals</h2><p className="subheading">Track daytime and nighttime mechanical renters, rent collected, and shared expenses.</p></div><button className="orange-button" onClick={() => setRentalOpen(true)}>Add renter</button></div>
        <div className="payroll-summary"><div><span>Active renters</span><strong>{rentals.filter((renter) => renter.active).length}</strong><small>Day and night spaces</small></div><div><span>Rent collected</span><strong>{currency(rentals.reduce((total, renter) => total + (renter.rentCollected || 0), 0))}</strong><small>Recorded rental income</small></div><div><span>Shared expenses</span><strong>{currency(rentals.reduce((total, renter) => total + (renter.sharedExpensesCollected || 0), 0))}</strong><small>Contributions received</small></div></div>
        <div className="employee-list">{rentals.map((renter) => <article className="employee-card rental-card" key={renter.id}><div className="employee-card-heading"><div><strong>{renter.name}</strong><small>{renter.shift} shift · {renter.space} · {renter.rentFrequency} rent</small></div><span className={renter.active ? "active-dot" : "inactive-dot"} /></div><div className="employee-metrics"><div><span>Rent target</span><strong>{currency(renter.rentAmount)}</strong></div><div><span>Expected</span><strong>{currency(renter.expectedRentToDate || 0)}</strong></div><div><span>Rent paid</span><strong className="finance-income">{currency(renter.rentCollected || 0)}</strong></div><div><span>Rent due</span><strong className={(renter.expectedRentToDate || 0) > (renter.rentCollected || 0) ? "payroll-due" : "finance-income"}>{currency(Math.max(0, (renter.expectedRentToDate || 0) - (renter.rentCollected || 0)))}</strong></div></div><div className="rental-card-footer"><span>Shared expenses: <b>{currency(renter.sharedExpensesCollected || 0)}</b></span><button className="orange-button" onClick={() => setPaymentRental(renter)}>Record payment</button></div></article>)}{!rentals.length && <div className="empty-state">No renters yet. Add the daytime or nighttime mechanical renter to begin tracking.</div>}</div>
      </section> : activeTab === "payroll" ? <section className="payroll-workspace">
        <div className="payroll-toolbar"><div><p className="eyebrow">People costs</p><h2>Employees &amp; payroll</h2><p className="subheading">Track weekly pay targets, partial payments, and what remains owed.</p></div><button className="orange-button" onClick={() => setEmployeeOpen(true)}>Add employee</button></div>
        <div className="payroll-summary"><div><span>Employees</span><strong>{employees.filter((employee) => employee.active).length}</strong><small>Active team members</small></div><div><span>Paid to date</span><strong>{currency(employees.reduce((total, employee) => total + (employee.paidToDate || 0), 0))}</strong><small>Recorded payroll payments</small></div><div><span>Balance due</span><strong className="payroll-due">{currency(employees.reduce((total, employee) => total + Math.max(0, employee.balanceDue || 0), 0))}</strong><small>Against weekly targets</small></div></div>
        <div className="employee-list">{employees.map((employee) => <article className="employee-card" key={employee.id}><div className="employee-card-heading"><div><strong>{employee.name}</strong><small>{employee.role || "Shop team member"} · Started {dateValue(employee.startDate)}</small></div><span className={employee.active ? "active-dot" : "inactive-dot"} /></div><div className="employee-metrics"><div><span>Weekly target</span><strong>{currency(employee.weeklyRate)}</strong></div><div><span>Expected</span><strong>{currency(employee.expectedToDate || 0)}</strong></div><div><span>Paid</span><strong className="finance-income">{currency(employee.paidToDate || 0)}</strong></div><div><span>Still owed</span><strong className={(employee.balanceDue || 0) > 0 ? "payroll-due" : "finance-income"}>{currency(Math.max(0, employee.balanceDue || 0))}</strong></div></div><div className="employee-card-actions"><button className="orange-button" onClick={() => setPaymentEmployee(employee)}>Record payment</button><span>{employee.payments.length} payment{employee.payments.length === 1 ? "" : "s"} recorded</span></div></article>)}{!employees.length && <div className="empty-state">No employees yet. Add your first team member to start tracking payroll.</div>}</div>
      </section> : <>
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
          value={currency(selectedTotals.income)}
          note={period.endsWith("m") ? `Past ${period.slice(0, -1)} months` : "Current month"}
          tone="green"
        />
        <Metric
          label="Job expenses"
          value={currency(period.endsWith("m") ? 0 : totals.jobExpenses)}
          note="Parts, labor, and job costs"
          tone="blue"
        />
        <Metric
          label="General expenses"
          value={currency(period.endsWith("m") ? selectedTotals.expenses : totals.generalExpenses)}
          note="Operating expenses"
          tone="orange"
        />
        <Metric
          label="Net"
          value={currency(selectedTotals.net)}
          note={`${currency(selectedTotals.expenses)} total expenses`}
          tone={selectedTotals.net >= 0 ? "green" : "orange"}
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
              <p>{period.endsWith("m") ? `Month by month · past ${period.slice(0, -1)} months` : "Current month"}</p>
            </div>
          </div>
          <div className="bar-chart">
            <div className="bar-group">
              <div
                className="bar income-bar"
                style={{
                  height: `${Math.max(8, (selectedTotals.income / maxBar) * 100)}%`,
                }}
              />
              <span>Income</span>
                <strong>{currency(selectedTotals.income)}</strong>
            </div>
            <div className="bar-group">
              <div
                className="bar expense-bar"
                style={{
                  height: `${Math.max(8, (selectedTotals.expenses / maxBar) * 100)}%`,
                }}
              />
              <span>Expenses</span>
                <strong>{currency(selectedTotals.expenses)}</strong>
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
          {period.endsWith("m") && <div className="monthly-trend">
            {trend.map((month) => <div className="monthly-trend-row" key={`${month.label}-${month.income}-${month.expenses}`}><strong>{month.label}</strong><span className="trend-income">{currency(month.income)}</span><span className="trend-expense">{currency(month.expenses)}</span><b className={month.income - month.expenses >= 0 ? "trend-positive" : "trend-negative"}>{currency(month.income - month.expenses)}</b></div>)}
            <div className="monthly-trend-labels"><span>Month</span><span>Income</span><span>Expenses</span><span>Net</span></div>
          </div>}
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
      </>}
      {rentalOpen && <div className="modal-backdrop"><form className="modal finance-modal" onSubmit={saveRental}><div className="modal-heading"><div><p className="eyebrow">Mechanical space</p><h2>Add renter</h2></div><button type="button" className="close-button" onClick={() => setRentalOpen(false)}>×</button></div><label>Name<input required value={rentalForm.name} onChange={(event) => setRentalForm({ ...rentalForm, name: event.target.value })} /></label><label>Phone<input type="tel" value={rentalForm.phone} onChange={(event) => setRentalForm({ ...rentalForm, phone: event.target.value })} /></label><label>Email<input type="email" value={rentalForm.email} onChange={(event) => setRentalForm({ ...rentalForm, email: event.target.value })} /></label><label>Shift<select value={rentalForm.shift} onChange={(event) => setRentalForm({ ...rentalForm, shift: event.target.value })}><option value="day">Day</option><option value="night">Night</option></select></label><label>Rent amount<input required min="0" step="0.01" type="number" value={rentalForm.rentAmount} onChange={(event) => setRentalForm({ ...rentalForm, rentAmount: event.target.value })} /></label><label>Rent frequency<select value={rentalForm.rentFrequency} onChange={(event) => setRentalForm({ ...rentalForm, rentFrequency: event.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Start date<input required type="date" value={rentalForm.startDate} onChange={(event) => setRentalForm({ ...rentalForm, startDate: event.target.value })} /></label><button className="orange-button submit-button" disabled={saving}>{saving ? "Saving..." : "Add renter"}</button></form></div>}
      {paymentRental && <div className="modal-backdrop"><form className="modal finance-modal" onSubmit={saveRentalPayment}><div className="modal-heading"><div><p className="eyebrow">Rental payment</p><h2>Record payment</h2><small>{paymentRental.name} · {paymentRental.shift} shift</small></div><button type="button" className="close-button" onClick={() => setPaymentRental(null)}>×</button></div><label>Payment type<select value={rentalPaymentForm.type} onChange={(event) => setRentalPaymentForm({ ...rentalPaymentForm, type: event.target.value })}><option value="rent">Rent</option><option value="shared_expense">Shared expense contribution</option></select></label><label>Amount<input required min="0.01" step="0.01" type="number" value={rentalPaymentForm.amount} onChange={(event) => setRentalPaymentForm({ ...rentalPaymentForm, amount: event.target.value })} /></label><label>Payment date<input required type="date" value={rentalPaymentForm.paymentDate} onChange={(event) => setRentalPaymentForm({ ...rentalPaymentForm, paymentDate: event.target.value })} /></label><label>Payment method<select value={rentalPaymentForm.paymentMethod} onChange={(event) => setRentalPaymentForm({ ...rentalPaymentForm, paymentMethod: event.target.value })}>{paymentMethods.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Notes<textarea value={rentalPaymentForm.notes} onChange={(event) => setRentalPaymentForm({ ...rentalPaymentForm, notes: event.target.value })} /></label><button className="orange-button submit-button" disabled={saving}>{saving ? "Saving..." : "Record payment"}</button></form></div>}
      {employeeOpen && <div className="modal-backdrop"><form className="modal finance-modal" onSubmit={saveEmployee}><div className="modal-heading"><div><p className="eyebrow">Team member</p><h2>Add employee</h2></div><button type="button" className="close-button" onClick={() => setEmployeeOpen(false)}>×</button></div><label>Name<input required value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} /></label><label>Role<input value={employeeForm.role} onChange={(event) => setEmployeeForm({ ...employeeForm, role: event.target.value })} placeholder="Technician, painter, office" /></label><label>Phone<input type="tel" value={employeeForm.phone} onChange={(event) => setEmployeeForm({ ...employeeForm, phone: event.target.value })} /></label><label>Weekly target<input required min="0" step="0.01" type="number" value={employeeForm.weeklyRate} onChange={(event) => setEmployeeForm({ ...employeeForm, weeklyRate: event.target.value })} /></label><label>Start date<input required type="date" value={employeeForm.startDate} onChange={(event) => setEmployeeForm({ ...employeeForm, startDate: event.target.value })} /></label><button className="orange-button submit-button" disabled={saving}>{saving ? "Saving..." : "Add employee"}</button></form></div>}
      {paymentEmployee && <div className="modal-backdrop"><form className="modal finance-modal" onSubmit={savePayment}><div className="modal-heading"><div><p className="eyebrow">Payroll payment</p><h2>Pay {paymentEmployee.name}</h2></div><button type="button" className="close-button" onClick={() => setPaymentEmployee(null)}>×</button></div><div className="payroll-payment-callout"><span>Still owed</span><strong>{currency(Math.max(0, paymentEmployee.balanceDue || 0))}</strong></div><label>Amount paid<input required min="0.01" step="0.01" type="number" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label><label>Payment date<input required type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} /></label><label>Payment method<select value={paymentForm.paymentMethod} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMethod: event.target.value })}>{paymentMethods.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Notes<textarea value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></label><button className="orange-button submit-button" disabled={saving}>{saving ? "Saving..." : "Record payment"}</button></form></div>}
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
