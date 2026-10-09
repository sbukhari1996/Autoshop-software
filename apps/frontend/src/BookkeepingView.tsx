import React from "react";
import { downloadMonthlyStatement } from "./monthlyStatement";

type FinanceEntry = {
  id: string;
  type: "income" | "expense";
  description: string;
  category: string | null;
  amount: number;
  paymentMethod: string | null;
  entryDate: string;
  notes: string | null;
  documents: FinanceEntryDocument[];
};
type FinanceEntryDocument = { id: string; fileName: string; createdAt: string };
type RecurringExpense = {
  id: string;
  name: string;
  amount: number;
  category: string | null;
  frequency: "weekly" | "monthly" | "yearly";
  startDate: string;
  endDate: string | null;
  active: boolean;
  notes?: string | null;
  payments: RecurringExpensePayment[];
};
type RecurringExpensePayment = { id: string; period: string; amount: number; paidAt: string };
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
type RollingSummary = { months: number; income: number; generalExpenses: number; jobExpenses: number; expenses: number; net: number };
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
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const categories = [
  "Parts",
  "Labor",
  "Payroll",
  "Payroll & Wages",
  "Rent",
  "Rent / Lease",
  "Phone & Internet",
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
const monthValue = (value: string) =>
  new Date(`${value}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const adjacentMonth = (value: string, amount: number) => {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
const recurringAmountInMonth = (item: RecurringExpense, period: string) => {
  const [year, month] = period.split("-").map(Number);
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  const startDate = new Date(item.startDate);
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const endDate = item.endDate ? new Date(item.endDate) : null;
  const end = endDate ? Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) : monthEnd;
  const lowerBound = Math.max(monthStart, start);
  const upperBound = Math.min(monthEnd, end);
  if (lowerBound > upperBound) return 0;
  if (item.frequency === "yearly") {
    if (month - 1 !== startDate.getUTCMonth()) return 0;
    const dueDate = Date.UTC(year, month - 1, Math.min(startDate.getUTCDate(), new Date(Date.UTC(year, month, 0)).getUTCDate()));
    return dueDate >= lowerBound && dueDate <= upperBound ? item.amount : 0;
  }
  if (item.frequency === "monthly") {
    const dueDate = Date.UTC(year, month - 1, Math.min(startDate.getUTCDate(), new Date(Date.UTC(year, month, 0)).getUTCDate()));
    return dueDate >= lowerBound && dueDate <= upperBound ? item.amount : 0;
  }
  let dueDate = start;
  if (dueDate < lowerBound) dueDate += Math.ceil((lowerBound - dueDate) / (7 * 24 * 60 * 60 * 1000)) * 7 * 24 * 60 * 60 * 1000;
  let occurrences = 0;
  while (dueDate <= upperBound) {
    occurrences += 1;
    dueDate += 7 * 24 * 60 * 60 * 1000;
  }
  return item.amount * occurrences;
};
const emptyEntry = {
  type: "income",
  description: "",
  category: "",
  amount: "",
  entryDate: new Date().toISOString().slice(0, 10),
  paymentMethod: "cash",
  notes: "",
};
const emptyRecurring = {
  name: "",
  amount: "",
  category: "Rent",
  frequency: "monthly",
  startDate: new Date().toISOString().slice(0, 10),
  active: true,
  notes: "",
};

export function BookkeepingView({
  data,
  request,
  onChanged,
}: {
  data: FinanceData | null;
  request: Request;
  onChanged: () => void;
}) {
  const [period, setPeriod] = React.useState("month");
  const [ledgerMonth, setLedgerMonth] = React.useState("all");
  const [ledgerYear, setLedgerYear] = React.useState(String(new Date().getFullYear()));
  const [ledgerType, setLedgerType] = React.useState<"all" | FinanceEntry["type"]>("all");
  const [selectedEntryIds, setSelectedEntryIds] = React.useState<string[]>([]);
  const [recurringPeriod, setRecurringPeriod] = React.useState(() => new Date().toISOString().slice(0, 7));
  const [chartYear, setChartYear] = React.useState(String(new Date().getFullYear()));
  const [rollingSummary, setRollingSummary] = React.useState<RollingSummary | null>(null);
  const [summary, setSummary] = React.useState<FinanceSummary | null>(
    data?.summary || null,
  );
  const [bankBalance, setBankBalance] = React.useState<BankBalance | null>(null);
  const [startingBalance, setStartingBalance] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<"ledger" | "payroll" | "rentals">("ledger");
  const [ledgerSearch, setLedgerSearch] = React.useState("");
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
  const [editingEntryId, setEditingEntryId] = React.useState<string | null>(null);
  const [recurringOpen, setRecurringOpen] = React.useState(false);
  const [editingRecurringId, setEditingRecurringId] = React.useState<string | null>(null);
  const [entry, setEntry] = React.useState(emptyEntry);
  const [recurring, setRecurring] = React.useState(emptyRecurring);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [uploadingReceiptFor, setUploadingReceiptFor] = React.useState<string | null>(null);
  const [receiptPreview, setReceiptPreview] = React.useState<{ entryId: string; document: FinanceEntryDocument; type: string; url?: string; text?: string } | null>(null);
  const receiptPreviewUrl = React.useRef<string | null>(null);
  const entries = data?.entries || [];
  const recurringItems = data?.recurring || [];
  const editingFinanceEntry = entries.find((item) => item.id === editingEntryId) || null;
  const availableYears = [...new Set([
    String(new Date().getFullYear()),
    ...entries.map((item) => item.entryDate.slice(0, 4)),
  ])].sort((left, right) => Number(right) - Number(left));
  const filteredEntries = entries.filter((item) => {
    const [year, month] = item.entryDate.slice(0, 7).split("-");
    if (year !== ledgerYear || (ledgerMonth !== "all" && month !== ledgerMonth)) return false;
    if (ledgerType !== "all" && item.type !== ledgerType) return false;
    const query = ledgerSearch.trim().toLocaleLowerCase();
    if (!query) return true;
    const searchableValues = [
      item.description,
      item.category,
      item.paymentMethod,
      item.entryDate.slice(0, 10),
      dateValue(item.entryDate),
      item.notes,
      item.amount.toFixed(2),
      ...item.documents.map((document) => document.fileName),
    ];
    return searchableValues.some((value) => value?.toLocaleLowerCase().includes(query));
  });
  const selectedEntries = filteredEntries.filter((item) => selectedEntryIds.includes(item.id));
  const filteredIncomeTotal = filteredEntries.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const filteredExpenseTotal = filteredEntries.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  const selectedIncomeTotal = selectedEntries.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const selectedExpenseTotal = selectedEntries.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  const recurringNextPeriod = adjacentMonth(recurringPeriod, 1);
  const recurringCurrentItems = recurringItems.filter((item) => recurringAmountInMonth(item, recurringPeriod) > 0);
  const recurringNextItems = recurringItems.filter((item) => recurringAmountInMonth(item, recurringNextPeriod) > 0);
  const recurringCurrentTotal = recurringCurrentItems.filter((item) => item.active).reduce((sum, item) => sum + recurringAmountInMonth(item, recurringPeriod), 0);
  const recurringCurrentPaid = recurringCurrentItems.filter((item) => item.active).reduce((sum, item) => sum + (item.payments.find((payment) => payment.period === recurringPeriod)?.amount || 0), 0);
  const recurringNextTotal = recurringNextItems.filter((item) => item.active).reduce((sum, item) => sum + recurringAmountInMonth(item, recurringNextPeriod), 0);
  React.useEffect(() => {
    setSummary(data?.summary || null);
  }, [data]);
  React.useEffect(() => () => {
    if (receiptPreviewUrl.current) URL.revokeObjectURL(receiptPreviewUrl.current);
  }, []);
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
      setRollingSummary(null);
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
  function openEntryForm(item?: FinanceEntry) {
    setError("");
    setEditingEntryId(item?.id || null);
    setEntry(item ? {
      type: item.type,
      description: item.description,
      category: item.category || "",
      amount: String(item.amount),
      entryDate: new Date(item.entryDate).toISOString().slice(0, 10),
      paymentMethod: item.paymentMethod || "cash",
      notes: item.notes || "",
    } : { ...emptyEntry });
    setEntryOpen(true);
  }
  function closeEntryForm() {
    setEntryOpen(false);
    setEditingEntryId(null);
  }
  function openRecurringForm(item?: RecurringExpense) {
    setError("");
    setEditingRecurringId(item?.id || null);
    setRecurring(item ? {
      name: item.name,
      amount: String(item.amount),
      category: item.category || "",
      frequency: item.frequency,
      startDate: new Date(item.startDate).toISOString().slice(0, 10),
      active: item.active,
      notes: item.notes || "",
    } : { ...emptyRecurring });
    setRecurringOpen(true);
  }
  async function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request(editingEntryId ? `/finance/entries/${editingEntryId}` : "/finance/entries", {
        method: editingEntryId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...entry,
          amount: Number(entry.amount),
          category: entry.category || null,
          notes: entry.notes || null,
        }),
      });
      setEntry({ ...emptyEntry });
      setEditingEntryId(null);
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
  async function uploadEntryReceipt(entryId: string, file: File) {
    setUploadingReceiptFor(entryId);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      await request(`/finance/entries/${entryId}/documents`, { method: "POST", body });
      onChanged();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to attach receipt");
    } finally {
      setUploadingReceiptFor(null);
    }
  }
  async function accessEntryReceipt(entryId: string, receipt: FinanceEntryDocument, download: boolean) {
    setError("");
    try {
      const token = localStorage.getItem("repairos_token");
      const response = await fetch(`${API_URL}/finance/entries/${entryId}/documents/${receipt.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Unable to ${download ? "download" : "preview"} receipt (HTTP ${response.status})`);
      const blob = await response.blob();
      if (download) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = receipt.fileName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      if (receiptPreviewUrl.current) URL.revokeObjectURL(receiptPreviewUrl.current);
      const type = blob.type || "application/octet-stream";
      if (type.startsWith("text/") || /^(application\/(json|xml|javascript))$/.test(type)) {
        setReceiptPreview({ entryId, document: receipt, type, text: await blob.text() });
        return;
      }
      const url = URL.createObjectURL(blob);
      receiptPreviewUrl.current = url;
      setReceiptPreview({ entryId, document: receipt, type, url });
    } catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : "Unable to access receipt");
    }
  }
  function closeReceiptPreview() {
    if (receiptPreviewUrl.current) URL.revokeObjectURL(receiptPreviewUrl.current);
    receiptPreviewUrl.current = null;
    setReceiptPreview(null);
  }
  async function deleteEntryReceipt(entryId: string, receipt: FinanceEntryDocument) {
    if (!window.confirm(`Delete receipt "${receipt.fileName}"? This cannot be undone.`)) return;
    setError("");
    try {
      await request(`/finance/entries/${entryId}/documents/${receipt.id}`, { method: "DELETE" });
      if (receiptPreview?.document.id === receipt.id) closeReceiptPreview();
      onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete receipt");
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
      await request(editingRecurringId ? `/finance/recurring/${editingRecurringId}` : "/finance/recurring", {
        method: editingRecurringId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...recurring,
          amount: Number(recurring.amount),
          category: recurring.category || undefined,
        }),
      });
      setRecurring(emptyRecurring);
      setEditingRecurringId(null);
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
  async function markRecurringPaid(item: RecurringExpense, paymentPeriod: string) {
    setError("");
    try {
      await request(`/finance/recurring/${item.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: paymentPeriod }),
      });
      onChanged();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to mark recurring expense paid");
    }
  }
  async function unmarkRecurringPaid(item: RecurringExpense, payment: RecurringExpensePayment) {
    setError("");
    try {
      await request(`/finance/recurring/${item.id}/payments/${payment.id}`, { method: "DELETE" });
      onChanged();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to undo recurring expense payment");
    }
  }
  function renderRecurringRows(items: RecurringExpense[], paymentPeriod: string) {
    if (!items.length) return <div className="empty-state">No recurring expenses scheduled for this month.</div>;
    return items.map((item) => {
      const payment = item.payments.find((record) => record.period === paymentPeriod);
      return (
        <div className="recurring-row" key={`${paymentPeriod}-${item.id}`}>
          <div className="recurring-name">
            <span className={payment ? "active-dot" : "inactive-dot"} />
            <div>
              <strong>{item.name}</strong>
              <small>{item.category || "General"} · {item.frequency}</small>
              {payment && <small>Paid {dateValue(payment.paidAt)}</small>}
              {item.notes && <small>{item.notes}</small>}
            </div>
          </div>
          <strong>{currency(payment?.amount ?? recurringAmountInMonth(item, paymentPeriod))}</strong>
          <button
            type="button"
            className={payment ? "toggle-button recurring-paid" : "secondary-button"}
            disabled={!item.active}
            onClick={() => void (payment ? unmarkRecurringPaid(item, payment) : markRecurringPaid(item, paymentPeriod))}
          >
            {!item.active ? "Paused" : payment ? "Paid · undo" : "Mark paid"}
          </button>
          <button type="button" className="toggle-button" onClick={() => void toggleRecurring(item)}>{item.active ? "Active" : "Resume"}</button>
          <button type="button" className="secondary-button" onClick={() => openRecurringForm(item)}>Edit</button>
          <button type="button" className="danger-button compact-danger" onClick={async () => { if (!window.confirm(`Delete recurring expense "${item.name}"?`)) return; setError(""); try { await request(`/finance/recurring/${item.id}`, { method: "DELETE" }); await onChanged(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete recurring expense"); } }}>Delete</button>
        </div>
      );
    });
  }
  const totals = summary || {
    income: 0,
    generalExpenses: 0,
    jobExpenses: 0,
    expenses: 0,
    net: 0,
  };
  const selectedTotals = rollingSummary || totals;
  const selectedPeriodLabel = period === "month" ? "This month" : `Past ${period.slice(0, -1)} months`;
  const trend = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1;
    const key = `${chartYear}-${String(monthNumber).padStart(2, "0")}`;
    const monthEntries = entries.filter((entry) => entry.entryDate.startsWith(key));
    return {
      label: new Date(`${key}-15T12:00:00`).toLocaleDateString(undefined, { month: "short" }),
      income: monthEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0),
      expenses: monthEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0),
    };
  });
  const maxTrendAmount = Math.max(1, ...trend.flatMap((month) => [month.income, month.expenses]));
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
          <h2>Period cash flow</h2>
          <p className="subheading">Net income after expenses for the selected period. The opening bank balance is tracked separately.</p>
        </div>
        <div className="bank-balance-current">
          <span>{period === "month" ? "Net this month" : `Net · ${selectedPeriodLabel}`}</span>
          <strong>{currency(selectedTotals.net)}</strong>
          <small>{currency(selectedTotals.income)} income · {currency(selectedTotals.expenses)} total expenses</small>
        </div>
        <form className="bank-balance-form" onSubmit={saveStartingBalance}>
          <label>Opening bank balance<input required min="0" step="0.01" type="number" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} /></label>
          <button className="orange-button" disabled={saving}>{saving ? "Saving..." : "Save balance"}</button>
        </form>
      </section>
      <section className="metric-grid finance-metrics">
        <Metric
          label="Income"
          value={currency(selectedTotals.income)}
          note={selectedPeriodLabel}
          tone="green"
        />
        <Metric
          label="Total expenses"
          value={currency(selectedTotals.expenses)}
          note={selectedPeriodLabel}
          tone="orange"
        />
        <Metric
          label="Net balance"
          value={currency(selectedTotals.net)}
          note={selectedPeriodLabel}
          tone={selectedTotals.net >= 0 ? "green" : "orange"}
        />
      </section>
      <div className="dashboard-grid finance-grid">
        <section className="surface">
          <div className="surface-heading">
            <div>
              <h2>Ledger</h2>
              <p>Income and expense activity · {filteredEntries.length} transactions shown</p>
            </div>
            <div className="finance-ledger-controls">
              <label className="finance-ledger-search">
                Search
                <input
                  type="search"
                  value={ledgerSearch}
                  onChange={(event) => setLedgerSearch(event.target.value)}
                  placeholder="Description, category, amount..."
                  aria-label="Search ledger transactions"
                />
              </label>
              <label>
                Month
                <select value={ledgerMonth} onChange={(event) => setLedgerMonth(event.target.value)}>
                  <option value="all">All months</option>
                  {Array.from({ length: 12 }, (_, index) => {
                    const month = String(index + 1).padStart(2, "0");
                    return <option value={month} key={month}>{new Date(`2026-${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long" })}</option>;
                  })}
                </select>
              </label>
              <label>
                Year
                <select value={ledgerYear} onChange={(event) => setLedgerYear(event.target.value)}>
                  {availableYears.map((year) => <option value={year} key={year}>{year}</option>)}
                </select>
              </label>
              <label>
                Type
                <select value={ledgerType} onChange={(event) => setLedgerType(event.target.value as "all" | FinanceEntry["type"])} aria-label="Filter ledger by transaction type">
                  <option value="all">Income &amp; expenses</option>
                  <option value="income">Income only</option>
                  <option value="expense">Expenses only</option>
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                title={selectedEntries.length ? "Download selected filtered transactions" : "Download filtered transactions"}
                onClick={() => downloadMonthlyStatement(selectedEntries.length ? selectedEntries : filteredEntries, ledgerYear, ledgerMonth, ledgerType)}
              >
                Download statement
              </button>
              <button className="text-button" onClick={() => openEntryForm()}>
                Add entry <span>+</span>
              </button>
            </div>
          </div>
          <div className="finance-table-wrap">
            <table className="data-table finance-table">
              <thead>
                <tr>
                  <th className="ledger-select-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all visible transactions"
                      checked={filteredEntries.length > 0 && selectedEntries.length === filteredEntries.length}
                      onChange={(event) => setSelectedEntryIds((current) => event.target.checked
                        ? [...new Set([...current, ...filteredEntries.map((item) => item.id)])]
                        : current.filter((id) => !filteredEntries.some((item) => item.id === id)))}
                    />
                  </th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Method</th>
                  <th>Receipts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((item) => (
                  <tr
                    key={item.id}
                    className="finance-entry-row clickable-row"
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest("button, a, input, select, label")) return;
                      openEntryForm(item);
                    }}
                    onKeyDown={(event) => {
                      if (!(event.target instanceof Element && event.target.closest("button, a, input, select, label")) && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        openEntryForm(item);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Open ${item.type}: ${item.description}`}
                  >
                    <td className="ledger-select-cell" data-label="Select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.type}: ${item.description}`}
                        checked={selectedEntryIds.includes(item.id)}
                        onChange={(event) => setSelectedEntryIds((current) => event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id))}
                      />
                    </td>
                    <td data-label="Date">{dateValue(item.entryDate)}</td>
                    <td className={`finance-amount ${item.type === "income" ? "finance-income" : "finance-expense"}`} data-label="Amount">
                      <span>{item.type === "income" ? "+" : "-"}{currency(item.amount)}</span>
                    </td>
                    <td data-label="Description">
                      <strong>{item.description}</strong>
                      {item.notes && (
                        <small className="table-subtext">{item.notes}</small>
                      )}
                    </td>
                    <td data-label="Category">{item.category || "Uncategorized"}</td>
                    <td data-label="Method">{item.paymentMethod?.replace("_", " ") || "-"}</td>
                    <td data-label="Receipts">
                      <div className="ledger-receipts">
                        {item.documents.map((receipt) => (
                          <div className="ledger-receipt" key={receipt.id}>
                            <span>{receipt.fileName}</span>
                            <button type="button" onClick={() => void accessEntryReceipt(item.id, receipt, false)}>Preview</button>
                            <button type="button" onClick={() => void accessEntryReceipt(item.id, receipt, true)}>Download</button>
                            <button type="button" className="danger-button compact-danger" onClick={() => void deleteEntryReceipt(item.id, receipt)}>Delete</button>
                          </div>
                        ))}
                        {item.type === "expense" && <label className="ledger-receipt-upload">
                          {uploadingReceiptFor === item.id ? "Uploading..." : "Attach receipt"}
                          <input type="file" disabled={uploadingReceiptFor === item.id} onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void uploadEntryReceipt(item.id, file);
                          }} />
                        </label>}
                      </div>
                    </td>
                    <td data-label="Actions"><div className="ledger-entry-actions"><button type="button" className="secondary-button" onClick={() => openEntryForm(item)}>Edit</button><button type="button" className="danger-button compact-danger" onClick={async () => { if (!window.confirm(`Delete ledger entry "${item.description}"?`)) return; setError(""); try { await request(`/finance/entries/${item.id}`, { method: "DELETE" }); await onChanged(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete ledger entry"); } }}>Delete</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filteredEntries.length && (
            <div className="empty-state">
              {ledgerSearch.trim()
                ? "No ledger transactions match this search."
                : `No ${ledgerType === "income" ? "income" : ledgerType === "expense" ? "expense" : "bookkeeping"} entries for this month and year.`}
            </div>
          )}
          <div className="ledger-totals">
            <div><span>Filtered income</span><strong className="finance-income">{currency(filteredIncomeTotal)}</strong></div>
            <div><span>Filtered expenses</span><strong className="finance-expense">{currency(filteredExpenseTotal)}</strong></div>
            <div><span>Net</span><strong className={filteredIncomeTotal >= filteredExpenseTotal ? "finance-income" : "finance-expense"}>{currency(filteredIncomeTotal - filteredExpenseTotal)}</strong></div>
            {selectedEntries.length > 0 && (
              <div className="ledger-selected-total">
                <span>{selectedEntries.length} selected · {currency(selectedIncomeTotal)} income · {currency(selectedExpenseTotal)} expenses</span>
                <strong>Selected net: {currency(selectedIncomeTotal - selectedExpenseTotal)}</strong>
              </div>
            )}
          </div>
        </section>
        <section className="surface finance-chart">
          <div className="surface-heading">
            <div>
              <h2>Income vs expenses</h2>
              <p>Month-by-month comparison · {chartYear}</p>
            </div>
            <label className="finance-chart-year">
              Chart year
              <select value={chartYear} onChange={(event) => setChartYear(event.target.value)}>
                {availableYears.map((year) => <option value={year} key={year}>{year}</option>)}
              </select>
            </label>
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
          <div className="yearly-month-chart" role="img" aria-label={`Monthly income and expense comparison for ${chartYear}`}>
            {trend.map((month) => <div className="yearly-month-column" key={`${chartYear}-${month.label}`}>
              <div className="yearly-month-bars">
                <span className="yearly-income-bar" title={`Income: ${currency(month.income)}`} style={{ height: `${month.income ? Math.max(2, month.income / maxTrendAmount * 100) : 0}%` }} />
                <span className="yearly-expense-bar" title={`Expenses: ${currency(month.expenses)}`} style={{ height: `${month.expenses ? Math.max(2, month.expenses / maxTrendAmount * 100) : 0}%` }} />
              </div>
              <span>{month.label}</span>
            </div>)}
          </div>
          <div className="monthly-trend-scroll">
          <div className="monthly-trend">
            {trend.map((month) => <div className="monthly-trend-row" key={`${month.label}-${month.income}-${month.expenses}`}><strong>{month.label}</strong><span className="trend-income">{currency(month.income)}</span><span className="trend-expense">{currency(month.expenses)}</span><b className={month.income - month.expenses >= 0 ? "trend-positive" : "trend-negative"}>{currency(month.income - month.expenses)}</b></div>)}
            <div className="monthly-trend-labels"><span>Month</span><span>Income</span><span>Expenses</span><span>Net</span></div>
          </div>
          </div>
        </section>
      </div>
      <section className="surface recurring-panel">
        <div className="surface-heading">
          <div>
            <h2>Recurring expenses</h2>
            <p>Track each month’s scheduled payments and balances</p>
          </div>
          <div className="recurring-heading-actions">
            <label>
              Payment month
              <input type="month" value={recurringPeriod} onChange={(event) => setRecurringPeriod(event.target.value)} />
            </label>
            <button className="orange-button" onClick={() => openRecurringForm()}>Add recurring</button>
          </div>
        </div>
        <div className="recurring-period-grid">
          <section className="recurring-period">
            <div className="recurring-period-heading">
              <h3>This month · {monthValue(recurringPeriod)}</h3>
              <span>{currency(recurringCurrentTotal - recurringCurrentPaid)} remaining</span>
            </div>
            <div className="recurring-list">{renderRecurringRows(recurringCurrentItems, recurringPeriod)}</div>
          </section>
          <section className="recurring-period">
            <div className="recurring-period-heading">
              <h3>Next month · {monthValue(recurringNextPeriod)}</h3>
              <span>{currency(recurringNextTotal)} scheduled</span>
            </div>
            <div className="recurring-list">{renderRecurringRows(recurringNextItems, recurringNextPeriod)}</div>
          </section>
        </div>
        {!recurringItems.length && <div className="empty-state">Add rent, utilities, insurance, or other fixed costs.</div>}
        <div className="recurring-totals">
          <div><span>{monthValue(recurringPeriod)} scheduled</span><strong>{currency(recurringCurrentTotal)}</strong></div>
          <div><span>{monthValue(recurringPeriod)} paid</span><strong className="finance-income">{currency(recurringCurrentPaid)}</strong></div>
          <div><span>{monthValue(recurringPeriod)} remaining</span><strong className="finance-expense">{currency(Math.max(0, recurringCurrentTotal - recurringCurrentPaid))}</strong></div>
          <div><span>{monthValue(recurringNextPeriod)} scheduled</span><strong>{currency(recurringNextTotal)}</strong></div>
        </div>
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
                <h2>{editingEntryId ? "Edit transaction" : "Record transaction"}</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={closeEntryForm}
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
            {editingFinanceEntry?.type === "expense" && (
              <section className="finance-entry-receipts">
                <h3>Receipts</h3>
                <div className="ledger-receipts">
                  {editingFinanceEntry.documents.map((receipt) => (
                    <div className="ledger-receipt" key={receipt.id}>
                      <span>{receipt.fileName}</span>
                      <button type="button" onClick={() => void accessEntryReceipt(editingFinanceEntry.id, receipt, false)}>Preview</button>
                      <button type="button" onClick={() => void accessEntryReceipt(editingFinanceEntry.id, receipt, true)}>Download</button>
                      <button type="button" className="danger-button compact-danger" onClick={() => void deleteEntryReceipt(editingFinanceEntry.id, receipt)}>Delete</button>
                    </div>
                  ))}
                  {!editingFinanceEntry.documents.length && <p className="records-muted">No receipt attached yet.</p>}
                  <label className="ledger-receipt-upload">
                    {uploadingReceiptFor === editingFinanceEntry.id ? "Uploading..." : "Attach receipt"}
                    <input type="file" disabled={uploadingReceiptFor === editingFinanceEntry.id} onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void uploadEntryReceipt(editingFinanceEntry.id, file);
                    }} />
                  </label>
                </div>
              </section>
            )}
            <button className="orange-button submit-button" disabled={saving}>
              {saving ? "Saving..." : editingEntryId ? "Save changes" : "Save entry"}
            </button>
          </form>
        </div>
      )}
      {receiptPreview && <div className="modal-backdrop" onClick={closeReceiptPreview}>
        <section className="modal finance-receipt-preview" onClick={(event) => event.stopPropagation()}>
          <div className="modal-heading">
            <h2>{receiptPreview.document.fileName}</h2>
            <button type="button" className="close-button" onClick={closeReceiptPreview}>×</button>
          </div>
          {receiptPreview.type === "application/pdf" || /\.pdf$/i.test(receiptPreview.document.fileName)
            ? <iframe className="finance-receipt-preview-pdf" src={receiptPreview.url} title={`Receipt preview: ${receiptPreview.document.fileName}`} />
            : receiptPreview.type.startsWith("image/")
              ? <img className="finance-receipt-preview-image" src={receiptPreview.url} alt={receiptPreview.document.fileName} />
              : receiptPreview.type.startsWith("audio/")
                ? <audio controls src={receiptPreview.url} />
                : receiptPreview.type.startsWith("video/")
                  ? <video controls className="document-preview-video" src={receiptPreview.url} />
                  : receiptPreview.text !== undefined
                    ? <pre className="document-preview-text">{receiptPreview.text}</pre>
                    : <p className="records-muted">This file type cannot be previewed in the browser. Download it to open it in a compatible app.</p>}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => void accessEntryReceipt(receiptPreview.entryId, receiptPreview.document, true)}>Download</button>
            <button type="button" className="secondary-button" onClick={closeReceiptPreview}>Close</button>
          </div>
        </section>
      </div>}
      {recurringOpen && (
        <div className="modal-backdrop">
          <form className="modal finance-modal" onSubmit={saveRecurring}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Fixed cost</p>
                <h2>{editingRecurringId ? "Edit recurring expense" : "Add recurring expense"}</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => { setRecurringOpen(false); setEditingRecurringId(null); }}
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
              <label className="finance-notes">
                Notes
                <textarea
                  value={recurring.notes}
                  onChange={(event) =>
                    setRecurring({ ...recurring, notes: event.target.value })
                  }
                />
              </label>
            </div>
            <button className="orange-button submit-button" disabled={saving}>
              {saving ? "Saving..." : editingRecurringId ? "Save changes" : "Save recurring expense"}
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
