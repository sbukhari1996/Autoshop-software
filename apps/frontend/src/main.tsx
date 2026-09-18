import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { EstimateBuilder } from "./EstimateBuilder";
import { BookkeepingView } from "./BookkeepingView";
import { InvoiceView, type Invoice } from "./InvoiceView";

type View =
  | "Dashboard"
  | "Customers"
  | "Vehicles"
  | "Claims"
  | "Jobs"
  | "Estimates"
  | "Documents"
  | "Invoices"
  | "Bookkeeping"
  | "Reports";
type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address?: string | null;
  vehicles?: Array<{ id: string; year: number | null; make: string | null; model: string | null }>;
  _count?: { claims: number; jobs: number };
};
type Vehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim?: string | null;
  bodyClass?: string | null;
  vin: string | null;
  licensePlate: string | null;
  licenseState?: string | null;
  color?: string | null;
  customer: Customer;
};
type Claim = {
  id: string;
  customerId?: string;
  vehicleId?: string | null;
  claimNumber: string | null;
  insuranceCompany: string | null;
  claimStatus: string;
  customer: Customer;
  vehicle: Vehicle | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerInsurance?: string | null;
  customerPolicyNumber?: string | null;
  customerClaimNumber?: string | null;
  customerAddress?: string | null;
  driverLicense?: string | null;
  vehicleYear?: number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleVin?: string | null;
  vehicleTrim?: string | null;
  vehicleBodyClass?: string | null;
  vehicleColor?: string | null;
  vehicleLicensePlate?: string | null;
  vehiclePlateState?: string | null;
  atFaultDriverName?: string | null;
  atFaultDriverPhone?: string | null;
  atFaultDriverLicense?: string | null;
  atFaultDriverDlState?: string | null;
  atFaultPlate?: string | null;
  atFaultPlateState?: string | null;
  atFaultVehicleVin?: string | null;
  atFaultVehicleYear?: number | null;
  atFaultVehicleMake?: string | null;
  atFaultVehicleModel?: string | null;
  atFaultVehicleTrim?: string | null;
  atFaultVehicleBodyClass?: string | null;
  atFaultVehicleColor?: string | null;
  atFaultInsurance?: string | null;
  atFaultPolicyNumber?: string | null;
  atFaultClaimNumber?: string | null;
  atFaultInsurancePhone?: string | null;
  incidentDate?: string | null;
  policeReportNumber?: string | null;
  policeDepartment?: string | null;
  witnessName?: string | null;
  witnessPhone?: string | null;
  damagePhotos?: boolean;
  platePhotos?: boolean;
  atFaultDlPhotos?: boolean;
  insuranceCardPhotos?: boolean;
  policeReportFiled?: boolean;
  witnessStatement?: boolean;
  estimateAttached?: boolean;
  readyToSubmit?: boolean;
  photoFolderLink?: string | null;
  adjusterName?: string | null;
  adjusterPhone?: string | null;
  adjusterEmail?: string | null;
  adjusterVisitAt?: string | null;
  dateSubmitted?: string | null;
  policeReportFile?: string | null;
  notes?: string | null;
  jobs?: Array<{ id: string; jobNumber: string; status: string }>;
};
type Job = {
  id: string;
  jobNumber: string;
  claimId?: string | null;
  status: string;
  totalRevenue: number;
  totalExpenses?: number;
  customer: Customer;
  vehicle: Vehicle | null;
  documents?: DocumentRecord[];
  estimates?: HubEstimate[];
  expenses?: Expense[];
  statusHistory?: JobStatusEntry[];
  authorizations?: RepairAuthorization[];
};
type Expense = {
  id: string;
  description: string;
  amount: number;
  category: string | null;
  expenseDate: string;
};
type DashboardData = {
  metrics: {
    openJobs: number;
    inspections: number;
    customers: number;
    revenue: number;
    expenses: number;
  };
  recentJobs: Job[];
  upcomingSchedule: Inspection[];
};
type Inspection = {
  id: string;
  scheduledFor: string;
  inspectorName: string | null;
  inspectorPhone: string | null;
  insuranceRep: string | null;
  status: string;
  notes: string | null;
  customer: Customer;
  claim: (Claim & { vehicle: Vehicle | null }) | null;
  job: (Job & { vehicle: Vehicle | null }) | null;
};
type Estimate = {
  id: string;
  estimateNumber: string | null;
  status: string;
  totalAmount: number;
  job: Job;
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    laborHours: number;
  }>;
};
type HubEstimate = {
  id: string;
  estimateNumber: string | null;
  status: string;
  totalAmount: number;
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    laborHours: number;
    paintHours?: number;
  }>;
};
type JobStatusEntry = {
  id: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  createdAt: string;
};
type RepairAuthorization = {
  id: string;
  fileName: string;
  status: string;
  generatedAt: string;
};
type DocumentRecord = {
  id: string;
  fileName: string;
  filePath: string;
  documentType: string | null;
  description?: string | null;
  createdAt: string;
  claim?: Claim & { customer: Customer; vehicle: Vehicle | null };
  job?: Job;
};
type ClaimHub = Claim & { documents: DocumentRecord[]; jobs: Job[] };
type DocumentsData = {
  claimDocuments: DocumentRecord[];
  jobDocuments: DocumentRecord[];
};
type ReportsData = DashboardData & {
  jobsByStatus: Array<{ status: string; count: number }>;
  estimateTotals: { count: number; total: number };
  documentCount: number;
};
type FinanceEntry = { id: string; type: "income" | "expense"; description: string; category: string | null; amount: number; paymentMethod: string | null; entryDate: string; notes: string | null; job?: { jobNumber: string } | null };
type RecurringExpense = { id: string; name: string; amount: number; category: string | null; frequency: "weekly" | "monthly" | "yearly"; startDate: string; active: boolean };
type FinanceSummary = { income: number; generalExpenses: number; jobExpenses: number; expenses: number; net: number };
type FinanceData = { entries: FinanceEntry[]; recurring: RecurringExpense[]; summary: FinanceSummary };

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const NEON_AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL || "";
const DEFAULT_ORGANIZATION = "Mastercraft Auto Repair & Collision";
const navItems: Array<{ label: View; icon: string }> = [
  { label: "Dashboard", icon: "grid" },
  { label: "Customers", icon: "users" },
  { label: "Vehicles", icon: "car" },
  { label: "Claims", icon: "shield" },
  { label: "Jobs", icon: "wrench" },
  { label: "Estimates", icon: "file" },
  { label: "Documents", icon: "folder" },
  { label: "Invoices", icon: "file" },
  { label: "Bookkeeping", icon: "chart" },
  { label: "Reports", icon: "chart" },
];
const icons: Record<string, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  users:
    "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  car: "M5 17h14l1-5-2-5H6l-2 5 1 5zM4 12h16M7 17v2M17 17v2M7 7l1-3h8l1 3",
  shield: "M12 3l8 4v5c0 4.5-3.4 7.9-8 9-4.6-1.1-8-4.5-8-9V7l8-4zM9 12l2 2 4-4",
  wrench:
    "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.2 2.2-2.4-.6-.6-2.4 2.2-2.2z",
  file: "M6 2h9l3 3v17H6zM14 2v4h4M9 13h6M9 17h6",
  folder: "M3 6h7l2 2h9v11H3z",
  chart: "M4 19V5M4 19h17M8 16v-4M12 16V8M16 16v-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  close: "M6 6l12 12M18 6L6 18",
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={icons[name] || icons.grid} />
    </svg>
  );
}
async function fetchJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem("repairos_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${result.error || "Request failed"} (HTTP ${response.status})`);
  return result;
}

type Session = {
  user: { id: string; name: string; email: string; role: string };
  organizations: Array<{ id: string; name: string; slug: string; role: string }>;
  activeOrganization: { id: string; name: string; slug: string; role: string } | null;
  activeRole: string | null;
};

function PublicLanding({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <div className="brand landing-brand">
          <div className="brand-mark"><Icon name="wrench" /></div>
          <div><strong>Repair<span>OS</span></strong><small>by Mastercraft</small></div>
        </div>
        <button className="landing-signin" onClick={onGetStarted}>Sign in</button>
      </header>
      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="landing-kicker">Precision operations for modern repair shops</p>
            <h1>Run every repair with <em>confidence.</em></h1>
            <p className="landing-lede">RepairOS brings work orders, customers, estimates, claims, documents, and financials into one calm command center for Mastercraft Auto Repair &amp; Collision.</p>
            <div className="landing-actions"><button className="orange-button" onClick={onGetStarted}>Get started <Icon name="arrow" /></button><span className="landing-note"><span className="shop-dot" /> Built for busy shop teams</span></div>
          </div>
          <div className="landing-console" aria-label="RepairOS operations preview">
            <div className="console-top"><span className="console-lights"><i /><i /><i /></span><span>MASTERCRAFT / OVERVIEW</span><b>09:41 AM</b></div>
            <div className="console-title"><div><small>THURSDAY, SEPTEMBER 17</small><h2>Good morning, Shop Admin</h2></div><span className="status-pill green">Live workspace</span></div>
            <div className="console-metrics"><div><small>ACTIVE JOBS</small><strong>24</strong><span>+12.5%</span></div><div><small>OPEN CLAIMS</small><strong>08</strong><span>Needs review</span></div><div><small>NET REVENUE</small><strong>$48.2k</strong><span>+8.4%</span></div></div>
            <div className="console-chart"><div className="console-chart-head"><span>Repair throughput</span><b>Last 30 days</b></div><div className="chart-lines"><i /><i /><i /><i /><i /></div><svg viewBox="0 0 500 115" preserveAspectRatio="none"><path d="M0 90 C45 88 53 66 87 73 S128 103 161 67 S204 61 230 76 S264 33 298 45 S342 76 373 35 S420 53 450 25 S478 40 500 12" /></svg></div>
          </div>
        </section>
        <section className="landing-section"><div className="section-intro"><p className="landing-kicker">One operating system</p><h2>Everything the front office needs, in one view.</h2></div><div className="feature-grid">
          {[['wrench', 'Work orders', 'Keep every repair moving from intake to delivery.'], ['users', 'Customer management', 'See people, vehicles, claims, and history together.'], ['chart', 'Billing & bookkeeping', 'Track invoices, payments, expenses, and margin.'], ['file', 'Estimates', 'Build clear estimates that earn authorization.'], ['folder', 'Claims & documents', 'Keep insurer details and paperwork at hand.'], ['grid', 'Reports', 'Measure throughput, revenue, and follow-up work.']].map(([icon, title, copy]) => <article className="feature-block" key={title}><span className="feature-icon"><Icon name={icon} /></span><h3>{title}</h3><p>{copy}</p><span className="feature-arrow">↗</span></article>)}
        </div></section>
        <section className="landing-footer"><strong>Repair<span>OS</span></strong><span>Clear work. Better repairs.</span><span>Mastercraft Auto Repair &amp; Collision</span></section>
      </main>
    </div>
  );
}

function AuthScreen({
  onAuthenticated,
  onBack,
}: {
  onAuthenticated: (token: string) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [form, setForm] = React.useState({ name: "", email: "", password: "" });
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const openNeonAuth = () => {
    if (NEON_AUTH_URL) window.location.href = NEON_AUTH_URL;
    else setNotice("Google sign-in is not configured for this local workspace.");
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await fetchJson<{ token: string }>(`/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      localStorage.setItem("repairos_token", result.token);
      onAuthenticated(result.token);
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Unable to authenticate",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand auth-brand">
          <div className="brand-mark">
            <Icon name="wrench" />
          </div>
          <div>
            <strong>
              Repair<span>OS</span>
            </strong>
            <small>Collision operations</small>
          </div>
        </div>
        <p className="auth-welcome">Welcome to RepairOS</p>
        <p className="auth-caption">Mastercraft Auto Repair &amp; Collision</p>
        <button type="button" className="google-button" onClick={openNeonAuth}>
          <span className="google-mark">G</span>
          Continue with Google
        </button>
        <div className="auth-divider"><span>or</span></div>
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setNotice(""); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); setNotice(""); }}>Create account</button>
        </div>
        <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
        <p className="subheading">{mode === "login" ? "Use your shop account to continue." : "Create access for your shop workspace."}</p>
        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}
        {mode === "register" && (
          <label>
            Name
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
        )}
        <label>
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
          />
        </label>
        <label>
          Password
          <input
            required
            minLength={8}
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
          />
        </label>
            <button className="orange-button auth-submit" disabled={loading}>
              {loading
                ? "Working..."
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
        {mode === "login" && <button type="button" className="forgot-button" onClick={() => { setNotice(NEON_AUTH_URL ? "Continue with Google to reset your password through Neon Auth." : "Please contact your shop administrator to reset your password."); }}>Forgot password?</button>}
        <button type="button" className="auth-back" onClick={onBack}>Back to overview</button>
      </form>
    </div>
  );
}

function OrganizationSetup({ session, onSelected }: { session: Session; onSelected: (token: string) => void }) {
  const [name, setName] = React.useState(DEFAULT_ORGANIZATION);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  async function chooseOrganization(organizationId: string) {
    setLoading(true); setError("");
    try { const result = await fetchJson<{ token: string }>(`/auth/organizations/${organizationId}/select`, { method: "POST" }); localStorage.setItem("repairos_token", result.token); onSelected(result.token); }
    catch (selectionError) { setError(selectionError instanceof Error ? selectionError.message : "Unable to select organization"); } finally { setLoading(false); }
  }
  async function createOrganization(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try { const result = await fetchJson<{ token: string }>("/auth/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); localStorage.setItem("repairos_token", result.token); onSelected(result.token); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Unable to create organization"); } finally { setLoading(false); }
  }
  return <div className="auth-shell setup-shell"><div className="setup-card"><div className="auth-brand brand"><div className="brand-mark"><Icon name="wrench" /></div><div><strong>Repair<span>OS</span></strong><small>Workspace setup</small></div></div><p className="eyebrow">Welcome, {session.user.name}</p><h1>Choose your workspace</h1><p className="subheading">Select an existing organization or create the shop workspace you will manage.</p>{error && <div className="error-banner">{error}</div>}{session.organizations.length > 0 && <div className="organization-list">{session.organizations.map((organization) => <button key={organization.id} className="organization-option" onClick={() => void chooseOrganization(organization.id)} disabled={loading}><span className="shop-dot" /><span><strong>{organization.name}</strong><small>{organization.role}</small></span><Icon name="arrow" /></button>)}</div>}<form onSubmit={createOrganization} className="organization-create"><label>New organization name<input required value={name} onChange={(event) => setName(event.target.value)} /></label><button className="orange-button auth-submit" disabled={loading}>{loading ? "Setting up..." : "Create workspace"}</button></form></div></div>;
}

function App() {
  const [token, setToken] = React.useState(() =>
    localStorage.getItem("repairos_token"),
  );
  const [entry, setEntry] = React.useState<"landing" | "auth">("landing");
  const [session, setSession] = React.useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(Boolean(token));
  const [view, setView] = React.useState<View>("Dashboard");
  const [search, setSearch] = React.useState("");
  const [dashboard, setDashboard] = React.useState<DashboardData | null>(null);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([]);
  const [claims, setClaims] = React.useState<Claim[]>([]);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [estimates, setEstimates] = React.useState<Estimate[]>([]);
  const [documents, setDocuments] = React.useState<DocumentsData | null>(null);
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [reports, setReports] = React.useState<ReportsData | null>(null);
  const [finance, setFinance] = React.useState<FinanceData | null>(null);
  const [modal, setModal] = React.useState<
    "customer" | "vehicle" | "claim" | "job" | null
  >(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const [dismissedNotifications, setDismissedNotifications] = React.useState<string[]>([]);
  const notificationStorageKey = `repairos_dismissed_notifications_${session?.activeOrganization?.id || "default"}`;
  React.useEffect(() => {
    try { setDismissedNotifications(JSON.parse(localStorage.getItem(notificationStorageKey) || "[]")); }
    catch { setDismissedNotifications([]); }
  }, [notificationStorageKey]);
  const dismissNotification = (notificationId: string) => {
    setDismissedNotifications((current) => {
      const next = current.includes(notificationId) ? current : [...current, notificationId];
      localStorage.setItem(notificationStorageKey, JSON.stringify(next));
      return next;
    });
  };
  React.useEffect(() => {
    if (!token) {
      setSession(null);
      setSessionLoading(false);
      return;
    }
    setSessionLoading(true);
    void fetchJson<Session>("/auth/session")
      .then(setSession)
      .catch(() => {
        localStorage.removeItem("repairos_token");
        setToken(null);
        setEntry("auth");
      })
      .finally(() => setSessionLoading(false));
  }, [token]);
  async function loadData() {
    setLoading(true);
    setError("");
    try {
      if (view === "Dashboard") {
        const [dashboardResult, customerResult, claimResult, jobResult] = await Promise.allSettled([
          fetchJson<DashboardData>("/dashboard"),
          fetchJson<Customer[]>("/customers"),
          fetchJson<Claim[]>("/claims"),
          fetchJson<Job[]>("/jobs"),
        ]);
        if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);
        if (customerResult.status === "fulfilled") setCustomers(customerResult.value);
        if (claimResult.status === "fulfilled") setClaims(claimResult.value);
        if (jobResult.status === "fulfilled") setJobs(jobResult.value);
        if (dashboardResult.status === "rejected") throw dashboardResult.reason;
      }
      if (view === "Customers" || view === "Claims") setCustomers(await fetchJson("/customers"));
      if (view === "Vehicles" || view === "Claims")
        setVehicles(
          await fetchJson(
            `/vehicles${search ? `?search=${encodeURIComponent(search)}` : ""}`,
          ),
        );
      if (view === "Claims") setClaims(await fetchJson("/claims"));
      if (view === "Jobs") setJobs(await fetchJson("/jobs"));
      if (view === "Estimates") setEstimates(await fetchJson("/estimates"));
      if (view === "Documents") setDocuments(await fetchJson("/documents"));
      if (view === "Invoices") {
        const [invoiceResult, customerResult, jobResult, claimResult] = await Promise.all([
          fetchJson<Invoice[]>("/invoices"),
          fetchJson<Customer[]>("/customers"),
          fetchJson<Job[]>("/jobs"),
          fetchJson<Claim[]>("/claims"),
        ]);
        setInvoices(invoiceResult);
        setCustomers(customerResult);
        setJobs(jobResult);
        setClaims(claimResult);
      }
      if (view === "Bookkeeping") {
        const [entries, recurring, summary] = await Promise.all([
          fetchJson<FinanceEntry[]>("/finance/entries"),
          fetchJson<RecurringExpense[]>("/finance/recurring"),
          fetchJson<FinanceSummary>("/finance/summary?period=month"),
        ]);
        setFinance({ entries, recurring, summary });
        setJobs(await fetchJson<Job[]>("/jobs"));
      }
      if (view === "Reports") setReports(await fetchJson("/reports"));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load data",
      );
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    if (!token || sessionLoading || !session?.activeOrganization) return;
    void loadData();
    if (view === "Documents" || view === "Estimates" || view === "Claims" || view === "Invoices" || view === "Customers") {
      void fetchJson<Job[]>("/jobs")
        .then(setJobs)
        .catch(() => undefined);
    }
    if (view === "Documents" || view === "Invoices" || view === "Customers") {
      void fetchJson<Claim[]>("/claims")
        .then(setClaims)
        .catch(() => undefined);
    }
  }, [view, token, sessionLoading, session?.activeOrganization?.id]);
  const navigate = (nextView: View) => {
    setView(nextView);
    setSearch("");
  };
  const newType =
    view === "Customers"
      ? "customer"
      : view === "Vehicles"
        ? "vehicle"
          : view === "Claims"
          ? null
          : view === "Jobs"
            ? "job"
            : null;
  if (!token) {
    return entry === "landing"
      ? <PublicLanding onGetStarted={() => setEntry("auth")} />
      : <AuthScreen onAuthenticated={setToken} onBack={() => setEntry("landing")} />;
  }
  if (sessionLoading || !session) return <div className="auth-shell"><div className="auth-loading">Loading your workspace...</div></div>;
  if (!session.activeOrganization) return <OrganizationSetup session={session} onSelected={setToken} />;
  const organizationName = session.activeOrganization.name || DEFAULT_ORGANIZATION;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="wrench" />
          </div>
          <div>
            <strong>
              Repair<span>OS</span>
            </strong>
            <small>Collision operations</small>
          </div>
        </div>
        <div className="shop-switcher">
          <span className="shop-dot" />
          <div>
            <strong>{organizationName}</strong>
            <small>Admin workspace</small>
          </div>
          <Icon name="arrow" />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navItems.map((item) => (
            <button
              className={view === item.label ? "nav-item active" : "nav-item"}
              key={item.label}
              onClick={() => navigate(item.label)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.label === "Claims" && <b className="nav-count">{claims.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setNotificationsOpen((open) => !open)} aria-expanded={notificationsOpen}>
            <Icon name="bell" />
            <span>Notifications</span>
            {(dashboard?.upcomingSchedule?.some((inspection) => !dismissedNotifications.includes(`inspection:${inspection.id}`)) || claims.some((claim) => ["new", "in_review"].includes(claim.claimStatus) && !dismissedNotifications.includes(`claim:${claim.id}`)) || jobs.some((job) => ["ready", "completed"].includes(job.status) && !dismissedNotifications.includes(`job:${job.id}`))) ? <b className="notification-dot" /> : null}
          </button>
          {notificationsOpen && <div className="notification-panel">
            <div className="notification-panel-heading"><div><strong>Notifications</strong><small>Shop activity that needs attention</small></div><button type="button" className="notification-close" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><Icon name="close" /></button></div>
            <div className="notification-list">
              {(dashboard?.upcomingSchedule || []).filter((inspection) => !dismissedNotifications.includes(`inspection:${inspection.id}`)).slice(0, 4).map((inspection) => <button type="button" className="notification-item" key={`inspection-${inspection.id}`} onClick={() => { dismissNotification(`inspection:${inspection.id}`); setNotificationsOpen(false); navigate("Dashboard"); }}><span className="notification-icon orange"><Icon name="bell" /></span><span><strong>Inspection scheduled</strong><small>{inspection.customer.firstName} {inspection.customer.lastName} · {formatDateTime(inspection.scheduledFor)}</small></span></button>)}
              {claims.filter((claim) => ["new", "in_review"].includes(claim.claimStatus) && !dismissedNotifications.includes(`claim:${claim.id}`)).slice(0, 4).map((claim) => <button type="button" className="notification-item" key={`claim-${claim.id}`} onClick={() => { dismissNotification(`claim:${claim.id}`); setNotificationsOpen(false); navigate("Claims"); }}><span className="notification-icon blue"><Icon name="shield" /></span><span><strong>Claim needs attention</strong><small>{claim.claimNumber || "Unnumbered claim"} · {claim.customer.firstName} {claim.customer.lastName}</small></span></button>)}
              {jobs.filter((job) => ["ready", "completed"].includes(job.status) && !dismissedNotifications.includes(`job:${job.id}`)).slice(0, 3).map((job) => <button type="button" className="notification-item" key={`job-${job.id}`} onClick={() => { dismissNotification(`job:${job.id}`); setNotificationsOpen(false); navigate("Jobs"); }}><span className="notification-icon green"><Icon name="wrench" /></span><span><strong>Repair order update</strong><small>{job.jobNumber} · {job.status.replaceAll("_", " ")}</small></span></button>)}
              {!dashboard?.upcomingSchedule?.some((inspection) => !dismissedNotifications.includes(`inspection:${inspection.id}`)) && !claims.some((claim) => ["new", "in_review"].includes(claim.claimStatus) && !dismissedNotifications.includes(`claim:${claim.id}`)) && !jobs.some((job) => ["ready", "completed"].includes(job.status) && !dismissedNotifications.includes(`job:${job.id}`)) && <p className="notification-empty">You are all caught up.</p>}
            </div>
          </div>}
          <div className="user-card">
            <div className="avatar">SB</div>
            <div>
              <strong>{session.user.name || "Shop admin"}</strong>
              <small>{session.activeRole || "Administrator"}</small>
            </div>
            <span className="more">...</span>
          </div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <Icon name="arrow" />
            <strong>{view}</strong>
          </div>
          <div className="top-actions">
            <label className="global-search">
              <Icon name="search" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && view === "Vehicles")
                    void loadData();
                }}
                placeholder="Search anything..."
              />
              <kbd>CMD K</kbd>
            </label>
            <button className="icon-button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications" aria-expanded={notificationsOpen}>
              <Icon name="bell" />
              <i />
            </button>
            <div className="top-avatar">SB</div>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {view === "Dashboard"
                  ? "Thursday, September 17, 2026"
                  : "Operations workspace"}
              </p>
              <h1>
                {view === "Dashboard" ? "Good morning, Shop Admin" : view}
              </h1>
              <p className="subheading">
                {view === "Dashboard"
                  ? "Here is what is happening across your shop today."
                  : view === "Customers"
                    ? "Manage customer relationships and repair history."
                    : view === "Vehicles"
                      ? "Track every vehicle through its repair journey."
                      : view === "Claims"
                        ? "Coordinate insurer details and claim progress."
                        : view === "Jobs"
                          ? "Move active repairs from intake to delivery."
                          : view === "Estimates"
                            ? "Build a clear view of repair value before authorization."
                            : view === "Documents"
                              ? "Keep claim and job paperwork visible to the office."
                              : view === "Invoices"
                                ? "Create repair invoices, record payments, and keep balances current."
                              : "Measure shop throughput, revenue, and follow-up work."}
              </p>
            </div>
            {newType && (
              <button
                className="orange-button"
                onClick={() => setModal(newType)}
              >
                <Icon name="plus" /> New {newType}
              </button>
            )}
          </div>
          {error && <div className="error-banner">{error}</div>}
          {loading && <div className="loading-bar" />}
          {view === "Dashboard" && (
            <Dashboard
              data={dashboard}
              customers={customers}
              claims={claims}
              jobs={jobs}
              onNavigate={navigate}
              onCreated={() => void loadData()}
            />
          )}
          {view === "Customers" && <CustomerView customers={customers} claims={claims} vehicles={vehicles} jobs={jobs} onChanged={loadData} />}
          {view === "Vehicles" && <VehicleView vehicles={vehicles} customers={customers} onChanged={loadData} />}
          {view === "Claims" && (
            <ClaimView
              claims={claims}
              customers={customers}
              vehicles={vehicles}
              jobs={jobs}
              onChanged={loadData}
            />
          )}
          {view === "Jobs" && <JobView jobs={jobs} onChanged={loadData} />}
          {view === "Estimates" && (
            <><EstimateBuilder jobs={jobs} request={fetchJson} onSaved={loadData} /><EstimateRegister estimates={estimates} request={fetchJson} onChanged={loadData} onNavigate={navigate} /></>
          )}
          {view === "Documents" && <DocumentView documents={documents} />}
          {view === "Invoices" && <InvoiceView invoices={invoices} customers={customers} jobs={jobs} claims={claims} request={fetchJson} apiUrl={API_URL} onChanged={loadData} />}
          {view === "Bookkeeping" && <BookkeepingView data={finance} jobs={jobs} claims={claims} request={fetchJson} onChanged={() => void loadData()} />}
          {view === "Reports" && (
            <ReportView reports={reports} onNavigate={navigate} />
          )}
        </div>
      </main>
      {modal && (
        <CreateModal
          type={modal}
          customers={customers}
          vehicles={vehicles}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            void loadData();
          }}
        />
      )}
    </div>
  );
}

function Dashboard({
  data,
  customers,
  claims,
  jobs,
  onNavigate,
  onCreated,
}: {
  data: DashboardData | null;
  customers: Customer[];
  claims: Claim[];
  jobs: Job[];
  onNavigate: (view: View) => void;
  onCreated: () => void;
}) {
  const [scheduleModalOpen, setScheduleModalOpen] = React.useState(false);
  const [selectedInspection, setSelectedInspection] = React.useState<Inspection | null>(null);
  const metrics = data?.metrics || {
    openJobs: 0,
    inspections: 0,
    customers: 0,
    revenue: 0,
    expenses: 0,
  };
  const cards = [
    {
      label: "Active repair jobs",
      value: metrics.openJobs,
      note: "Across all stages",
      icon: "wrench",
      tone: "orange",
      action: "Jobs" as View,
    },
    {
      label: "Scheduled inspections",
      value: metrics.inspections,
      note: "Needs attention today",
      icon: "shield",
      tone: "blue",
      action: "Claims" as View,
    },
    {
      label: "Total customers",
      value: metrics.customers,
      note: "Lifetime records",
      icon: "users",
      tone: "green",
      action: "Customers" as View,
    },
    {
      label: "Net revenue",
      value: `$${(metrics.revenue - metrics.expenses).toLocaleString()}`,
      note: `$${metrics.revenue.toLocaleString()} gross revenue`,
      icon: "chart",
      tone: "purple",
      action: "Reports" as View,
    },
  ];
  return (
    <>
      <section className="metric-grid">
        {cards.map((card) => (
          <button
            className="metric-card"
            key={card.label}
            onClick={() => onNavigate(card.action)}
          >
            <div className={`metric-icon ${card.tone}`}>
              <Icon name={card.icon} />
            </div>
            <div className="metric-copy">
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </div>
            <Icon name="arrow" />
          </button>
        ))}
      </section>
      <section className="dashboard-grid">
        <div className="surface wide">
          <div className="surface-heading">
            <div>
              <h2>Active work orders</h2>
              <p>Latest repair activity across the shop</p>
            </div>
            <button className="text-button" onClick={() => onNavigate("Jobs")}>
              View all <Icon name="arrow" />
            </button>
          </div>
          <JobTable jobs={data?.recentJobs || []} />
        </div>
        <div className="surface">
          <div className="surface-heading">
            <div>
              <h2>Upcoming schedule</h2>
              <p>Inspections and customer handoffs</p>
            </div>
            <button className="text-button" onClick={() => { setSelectedInspection(null); setScheduleModalOpen(true); }}>
              <Icon name="plus" /> Add event
            </button>
          </div>
          {data?.upcomingSchedule?.length ? (
            <div className="schedule">
              {data.upcomingSchedule.map((inspection) => (
                <ScheduleItem
                  key={inspection.id}
                  time={new Date(inspection.scheduledFor).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  title={`${inspection.customer.firstName} ${inspection.customer.lastName}`}
                  detail={[
                    inspection.claim?.claimNumber
                      ? `Claim #${inspection.claim.claimNumber}`
                      : "No claim",
                    inspection.claim?.vehicle || inspection.job?.vehicle
                      ? [
                          inspection.claim?.vehicle?.year || inspection.job?.vehicle?.year,
                          inspection.claim?.vehicle?.make || inspection.job?.vehicle?.make,
                          inspection.claim?.vehicle?.model || inspection.job?.vehicle?.model,
                        ].filter(Boolean).join(" ")
                      : "Vehicle pending",
                    `Inspector: ${inspection.inspectorName || "Unassigned"}`,
                    inspection.inspectorPhone ? `Call: ${inspection.inspectorPhone}` : "",
                    `Insurance: ${inspection.insuranceRep || "Unassigned"}`,
                  ].join(" · ")}
                  status={inspection.status}
                  tone={inspection.status === "scheduled" ? "orange" : "blue"}
                  onClick={() => { setSelectedInspection(inspection); setScheduleModalOpen(true); }}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">No upcoming inspections scheduled.</div>
          )}
        </div>
      </section>
      {scheduleModalOpen && (
        <InspectionModal
          customers={customers}
          claims={claims}
          jobs={jobs}
          inspection={selectedInspection}
          onClose={() => setScheduleModalOpen(false)}
          onCreated={() => {
            setScheduleModalOpen(false);
            setSelectedInspection(null);
            onCreated();
          }}
        />
      )}
    </>
  );
}
function CustomerView({ customers, claims, vehicles, jobs, onChanged }: { customers: Customer[]; claims: Claim[]; vehicles: Vehicle[]; jobs: Job[]; onChanged: () => Promise<void> }) {
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null);
  const [selectedClaim, setSelectedClaim] = React.useState<Claim | null>(null);
  const [error, setError] = React.useState("");
  const customerClaims = selectedCustomer ? claims.filter((claim) => claim.customerId === selectedCustomer.id) : [];
  const customerVehicles = selectedCustomer ? vehicles.filter((vehicle) => vehicle.customer.id === selectedCustomer.id) : [];
  const customerJobs = selectedCustomer ? jobs.filter((job) => job.customer.id === selectedCustomer.id) : [];
  return <>
    {error && <div className="error-banner">{error}</div>}
    {selectedCustomer && <div className="customer-file-action"><span>Customer file: <strong>{selectedCustomer.firstName} {selectedCustomer.lastName}</strong></span><button type="button" className="danger-button" onClick={async () => { if (!window.confirm(`Delete ${selectedCustomer.firstName} ${selectedCustomer.lastName}? This cannot be undone.`)) return; setError(""); try { await fetchJson(`/customers/${selectedCustomer.id}`, { method: "DELETE" }); setSelectedCustomer(null); await onChanged(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete customer"); } }}>Delete customer</button></div>}
    <div className="customer-workspace">
      <div className="surface customer-directory"><div className="surface-heading"><div><h2>Customer directory</h2><p>{customers.length} customer records · Select a customer to see their complete file</p></div></div><table className="data-table"><thead><tr><th>Customer</th><th>Contact</th><th>Open jobs</th><th>Claims</th></tr></thead><tbody>{customers.map((customer) => <tr className={selectedCustomer?.id === customer.id ? "clickable-row selected-row" : "clickable-row"} key={customer.id} onClick={() => { setSelectedCustomer(customer); setSelectedClaim(null); }}><td><div className="person-cell"><div className="table-avatar">{customer.firstName[0]}{customer.lastName[0]}</div><strong>{customer.firstName} {customer.lastName}</strong></div></td><td>{customer.phone || customer.email || "No contact details"}</td><td>{customer._count?.jobs || 0}</td><td><span className="status-pill blue">{customer._count?.claims || 0} claims</span></td></tr>)}</tbody></table>{!customers.length && <EmptyState text="No customers yet. Create the first customer to begin an intake." />}</div>
      <div className="surface customer-file">{selectedCustomer ? <><div className="customer-file-heading"><div className="table-avatar large-avatar">{selectedCustomer.firstName[0]}{selectedCustomer.lastName[0]}</div><div><p className="eyebrow">Customer file</p><h2>{selectedCustomer.firstName} {selectedCustomer.lastName}</h2><p>{selectedCustomer.phone || "No phone"} · {selectedCustomer.email || "No email"}</p></div></div><div className="customer-stats"><span><strong>{customerClaims.length}</strong> claims</span><span><strong>{customerVehicles.length}</strong> vehicles</span><span><strong>{customerJobs.length}</strong> jobs</span></div><div className="customer-file-section"><div className="records-section-heading"><h4>Claims</h4><span>Click a claim to open its full file</span></div>{customerClaims.length ? <div className="customer-claims">{customerClaims.map((claim) => <button className="customer-claim-row" key={claim.id} onClick={() => setSelectedClaim(claim)}><span><strong>{claim.claimNumber || "Unnumbered claim"}</strong><small>{claim.insuranceCompany || "Insurance pending"} · {claim.vehicle ? [claim.vehicle.year, claim.vehicle.make, claim.vehicle.model].filter(Boolean).join(" ") : "Vehicle pending"}</small></span><span className={`status-pill ${claim.claimStatus === "approved" ? "green" : "orange"}`}>{claim.claimStatus}</span><Icon name="arrow" /></button>)}</div> : <p className="records-muted">No claims attached to this customer.</p>}</div><div className="customer-file-section"><div className="records-section-heading"><h4>Vehicles</h4><span>{customerVehicles.length} registered</span></div>{customerVehicles.length ? <div className="customer-vehicle-list">{customerVehicles.map((vehicle) => <span key={vehicle.id}>{[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Vehicle pending"}</span>)}</div> : <p className="records-muted">No vehicles attached to this customer.</p>}</div></> : <EmptyState text="Select a customer to view every claim, vehicle, and repair record together." />}</div>
    </div>
    {selectedClaim && <ClaimWorkspace claim={selectedClaim} customers={customers} vehicles={vehicles} jobs={jobs} onClose={() => setSelectedClaim(null)} onSaved={async () => { await onChanged(); setSelectedClaim(null); }} />}
  </>;
}
function VehicleView({ vehicles, customers, onChanged }: { vehicles: Vehicle[]; customers: Customer[]; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = React.useState<Vehicle | null>(null);
  return <><DataSurface title="Vehicle registry" subtitle="Click a vehicle to view or update its saved details" headers={["Vehicle", "Owner", "VIN", "License plate"]} rows={vehicles.map((vehicle) => [<div className="vehicle-cell"><Icon name="car" /><strong>{[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Vehicle pending"}</strong></div>, `${vehicle.customer.firstName} ${vehicle.customer.lastName}`, <span className="mono">{vehicle.vin || "Not recorded"}</span>, vehicle.licensePlate ? `${vehicle.licensePlate}${vehicle.licenseState ? ` (${vehicle.licenseState})` : ""}` : "Not recorded"])} empty="No vehicles found. Add a vehicle from a customer intake." onRowClick={(index) => setSelected(vehicles[index])} />{selected && <VehicleEditModal vehicle={selected} customers={customers} onClose={() => setSelected(null)} onSaved={async () => { await onChanged(); setSelected(null); }} />}</>;
}
function VehicleEditModal({ vehicle, customers, onClose, onSaved }: { vehicle: Vehicle; customers: Customer[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = React.useState({ customerId: vehicle.customer.id, year: String(vehicle.year || ''), make: vehicle.make || '', model: vehicle.model || '', trim: vehicle.trim || '', bodyClass: vehicle.bodyClass || '', vin: vehicle.vin || '', color: vehicle.color || '', licensePlate: vehicle.licensePlate || '', licenseState: vehicle.licenseState || '' });
  const [error, setError] = React.useState(''); const [vinLoading, setVinLoading] = React.useState(false); const [vinMessage, setVinMessage] = React.useState('');
  const update = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  async function decode() { if (!form.vin) { setVinMessage('Enter a VIN first.'); return; } setVinLoading(true); try { const result = await fetchJson<{ year: string; make: string; model: string; trim: string; bodyClass: string }>(`/vin/${form.vin}`); setForm({ ...form, vin: form.vin.toUpperCase(), year: result.year, make: result.make, model: result.model, trim: result.trim, bodyClass: result.bodyClass }); setVinMessage(`Decoded ${result.year} ${result.make} ${result.model} ${result.trim}`); } catch (decodeError) { setVinMessage(decodeError instanceof Error ? decodeError.message : 'VIN could not be decoded'); } finally { setVinLoading(false); } }
  async function save(event: React.FormEvent) { event.preventDefault(); try { await fetchJson(`/vehicles/${vehicle.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, year: form.year ? Number(form.year) : undefined }) }); await onSaved(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to update vehicle'); } }
  async function remove() { if (!window.confirm("Delete this vehicle? This cannot be undone.")) return; setError(""); try { await fetchJson(`/vehicles/${vehicle.id}`, { method: "DELETE" }); await onSaved(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete vehicle"); } }
  const field = (key: keyof typeof form, label: string) => <label>{label}<input value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>;
  return <div className="modal-backdrop" onClick={onClose}><form className="modal vehicle-edit-modal" onSubmit={save} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Vehicle record</p><h2>Edit vehicle</h2></div><button type="button" className="close-button" onClick={onClose}><Icon name="close" /></button></div>{error && <div className="error-banner">{error}</div>}<Select name="customerId" label="Customer" options={customers.map((customer) => ({ value: customer.id, label: `${customer.firstName} ${customer.lastName}` }))} form={form} setForm={setForm} /><div className="vin-control-row">{field('vin', 'VIN')}<button type="button" className="secondary-button" onClick={() => void decode()} disabled={vinLoading}>{vinLoading ? 'Decoding...' : 'Decode VIN'}</button></div>{vinMessage && <p className="vin-success">{vinMessage}</p>}<div className="form-row">{field('year', 'Year')}{field('make', 'Make')}{field('model', 'Model')}</div><div className="form-row">{field('trim', 'Trim')}{field('bodyClass', 'Body style')}{field('color', 'Color')}</div><div className="form-row">{field('licensePlate', 'License plate')}{field('licenseState', 'Plate state')}</div><div className="modal-actions"><button type="button" className="danger-button" onClick={() => void remove()}>Delete vehicle</button><button className="orange-button submit-button">Save vehicle</button></div></form></div>;
}
function ClaimView({
  claims,
  customers,
  vehicles,
  jobs,
  onChanged,
}: {
  claims: Claim[];
  customers: Customer[];
  vehicles: Vehicle[];
  jobs: Job[];
  onChanged: () => Promise<void>;
}) {
  const [selectedClaim, setSelectedClaim] = React.useState<Claim | null>(null);
  const [creating, setCreating] = React.useState(false);
  return (
    <>
      <div className="surface">
        <SurfaceHeading
          title="Claims desk"
          subtitle="Select a claim to complete intake, link repair work, or print authorization"
        />
        <div className="claim-list-action"><button className="orange-button" onClick={() => setCreating(true)}><Icon name="plus" /> New claim intake</button></div>
        {claims.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Customer / vehicle</th>
                <th>Carrier</th>
                <th>Repair order</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr className="clickable-row" key={claim.id} onClick={() => setSelectedClaim(claim)}>
                  <td><strong className="mono">{claim.claimNumber || "UNNUMBERED"}</strong></td>
                  <td>
                    {claim.customer.firstName} {claim.customer.lastName}
                    <small className="table-subtext">
                      {claim.vehicle ? [claim.vehicle.year, claim.vehicle.make, claim.vehicle.model].filter(Boolean).join(" ") : "Vehicle pending"}
                    </small>
                  </td>
                  <td>{claim.insuranceCompany || "Carrier pending"}</td>
                  <td>{claim.jobs?.[0]?.jobNumber || "Unlinked"}</td>
                  <td><span className={`status-pill ${claim.claimStatus === "approved" ? "green" : "orange"}`}>{claim.claimStatus}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState text="No claims have been entered yet. Start a claim intake to create the first record." />}
      </div>
      {(selectedClaim || creating) && (
        <ClaimWorkspace
          claim={selectedClaim}
          customers={customers}
          vehicles={vehicles}
          jobs={jobs}
          onClose={() => { setSelectedClaim(null); setCreating(false); }}
          onSaved={async () => { await onChanged(); setSelectedClaim(null); setCreating(false); }}
        />
      )}
    </>
  );
}

type ClaimForm = Record<string, string | boolean>;
const claimTextFields = [
  ["claimNumber", "Claim number"], ["customerName", "Customer name"], ["customerPhone", "Customer phone"],
  ["customerInsurance", "Customer insurance"], ["customerPolicyNumber", "Customer policy number"], ["customerClaimNumber", "Customer claim number"],
  ["customerAddress", "Street address"], ["driverLicense", "Driver's license"], ["vehicleYear", "Vehicle year"], ["vehicleMake", "Vehicle make"],
  ["vehicleModel", "Vehicle model"], ["vehicleVin", "VIN"], ["vehicleTrim", "Vehicle trim"], ["vehicleBodyClass", "Body style"], ["vehicleColor", "Vehicle color"], ["vehicleLicensePlate", "License plate"], ["vehiclePlateState", "Plate state"],
  ["atFaultDriverName", "At-fault driver name"], ["atFaultDriverPhone", "At-fault driver phone"], ["atFaultDriverLicense", "At-fault driver's license"], ["atFaultDriverDlState", "DL state"],
  ["atFaultPlate", "At-fault license plate"], ["atFaultPlateState", "At-fault plate state"], ["atFaultVehicleVin", "At-fault vehicle VIN"], ["atFaultVehicleYear", "At-fault vehicle year"], ["atFaultVehicleMake", "At-fault vehicle make"], ["atFaultVehicleModel", "At-fault vehicle model"], ["atFaultVehicleTrim", "At-fault vehicle trim"], ["atFaultVehicleBodyClass", "At-fault body style"], ["atFaultVehicleColor", "At-fault vehicle color"], ["atFaultInsurance", "At-fault insurance"], ["atFaultPolicyNumber", "At-fault policy number"],
  ["atFaultClaimNumber", "At-fault claim number"], ["atFaultInsurancePhone", "At-fault insurance phone"], ["policeReportNumber", "Police report number"], ["policeDepartment", "Police department"],
  ["witnessName", "Witness name"], ["witnessPhone", "Witness phone"], ["photoFolderLink", "Photo folder link"], ["adjusterName", "Adjuster name"], ["adjusterPhone", "Adjuster phone"], ["adjusterEmail", "Adjuster email"],
] as const;
const claimFlags = [
  ["damagePhotos", "Damage photos"], ["platePhotos", "Plate photos"], ["atFaultDlPhotos", "At-fault DL photos"], ["insuranceCardPhotos", "Insurance card photos"],
  ["policeReportFiled", "Police report filed"], ["witnessStatement", "Witness statement"], ["estimateAttached", "Estimate attached"], ["readyToSubmit", "Ready to submit"],
] as const;
function claimFormFromClaim(claim: Claim | null, customer?: Customer, vehicle?: Vehicle | null): ClaimForm {
  const source = claim || {};
  const customerName = customer ? `${customer.firstName} ${customer.lastName}` : source.customerName || "";
  const selectedVehicle = vehicle || source.vehicle;
  return {
    customerId: source.customerId || customer?.id || "", vehicleId: source.vehicleId || selectedVehicle?.id || "", jobId: source.jobs?.[0]?.id || "",
    ...Object.fromEntries(claimTextFields.map(([key]) => [key, source[key as keyof Claim] ?? ""])),
    customerName, customerPhone: source.customerPhone || customer?.phone || "", customerAddress: source.customerAddress || customer?.address || "",
    insuranceCompany: source.insuranceCompany || "", policeReportFile: source.policeReportFile || "",
    vehicleYear: source.vehicleYear ?? selectedVehicle?.year ?? "", vehicleMake: source.vehicleMake || selectedVehicle?.make || "", vehicleModel: source.vehicleModel || selectedVehicle?.model || "",
    vehicleVin: source.vehicleVin || selectedVehicle?.vin || "", vehicleLicensePlate: source.vehicleLicensePlate || selectedVehicle?.licensePlate || "",
    incidentDate: source.incidentDate ? String(source.incidentDate).slice(0, 10) : "", adjusterVisitAt: toDateTimeLocal(source.adjusterVisitAt), dateSubmitted: source.dateSubmitted ? String(source.dateSubmitted).slice(0, 10) : "",
    status: source.claimStatus || "new", notes: source.notes || "",
    ...Object.fromEntries(claimFlags.map(([key]) => [key, source[key as keyof Claim] || false])),
  };
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value: string | boolean | undefined) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function ClaimWorkspace({
  claim,
  customers,
  vehicles,
  jobs,
  onClose,
  onSaved,
}: {
  claim: Claim | null;
  customers: Customer[];
  vehicles: Vehicle[];
  jobs: Job[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = React.useState<ClaimForm>(() => claimFormFromClaim(claim, claim?.customer, claim?.vehicle));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [vinState, setVinState] = React.useState({
    customer: { loading: false, message: "", error: false },
    atFault: { loading: false, message: "", error: false },
  });
  const [printMode, setPrintMode] = React.useState(false);
  const [workspaceTab, setWorkspaceTab] = React.useState<"intake" | "records">("intake");
  const customerId = String(form.customerId || "");
  const availableVehicles = vehicles.filter((vehicle) => vehicle.customer.id === customerId);
  const availableJobs = jobs.filter((job) => job.customer.id === customerId);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  React.useEffect(() => {
    if (claim && !form.jobId) {
      const linkedJob = jobs.find((job) => job.claimId === claim.id);
      if (linkedJob) update("jobId", linkedJob.id);
    }
  }, [claim, form.jobId, jobs]);
  function update(key: string, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function selectCustomer(value: string) {
    const customer = customers.find((item) => item.id === value);
    const firstVehicle = vehicles.find((vehicle) => vehicle.customer.id === value);
    setForm((current) => ({
      ...current, customerId: value, vehicleId: "", jobId: "",
      customerName: customer ? `${customer.firstName} ${customer.lastName}` : "", customerPhone: customer?.phone || "", customerAddress: customer?.address || "",
      vehicleYear: firstVehicle?.year ?? "", vehicleMake: firstVehicle?.make || "", vehicleModel: firstVehicle?.model || "", vehicleVin: firstVehicle?.vin || "", vehicleTrim: "", vehicleBodyClass: "", vehicleLicensePlate: firstVehicle?.licensePlate || "",
    }));
  }
  function selectVehicle(value: string) {
    const vehicle = availableVehicles.find((item) => item.id === value);
    setForm((current) => ({ ...current, vehicleId: value, vehicleYear: vehicle?.year ?? "", vehicleMake: vehicle?.make || "", vehicleModel: vehicle?.model || "", vehicleVin: vehicle?.vin || "", vehicleTrim: "", vehicleBodyClass: "", vehicleLicensePlate: vehicle?.licensePlate || "" }));
  }
  async function decodeVin(kind: "customer" | "atFault") {
    const vinKey = kind === "customer" ? "vehicleVin" : "atFaultVehicleVin";
    const vin = String(form[vinKey] || "").trim();
    if (!vin) {
      setVinState((current) => ({ ...current, [kind]: { loading: false, message: "Enter a VIN first.", error: true } }));
      return;
    }
    setVinState((current) => ({ ...current, [kind]: { loading: true, message: "", error: false } }));
    try {
      const result = await fetchJson<{ vin: string; year: string; make: string; model: string; trim: string; bodyClass: string }>(`/vin/${encodeURIComponent(vin)}`);
      const prefix = kind === "customer" ? "vehicle" : "atFaultVehicle";
      setForm((current) => ({
        ...current,
        [`${prefix}Vin`]: result.vin,
        [`${prefix}Year`]: result.year,
        [`${prefix}Make`]: result.make,
        [`${prefix}Model`]: result.model,
        [`${prefix}Trim`]: result.trim,
        [`${prefix}BodyClass`]: result.bodyClass,
      }));
      setVinState((current) => ({ ...current, [kind]: { loading: false, message: `Decoded ${[result.year, result.make, result.model].filter(Boolean).join(" ")}`, error: false } }));
    } catch (decodeError) {
      setVinState((current) => ({ ...current, [kind]: { loading: false, message: decodeError instanceof Error ? decodeError.message : "VIN could not be decoded", error: true } }));
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!customerId) { setError("Select an existing customer before saving the claim."); return; }
    setBusy(true); setError("");
    const address = [form.customerAddress, form.customerCity, form.customerState, form.customerZip].filter(Boolean).join(", ");
    const payload = { ...form, customerAddress: address, vehicleId: form.vehicleId || null, jobId: form.jobId || null, vehicleYear: form.vehicleYear ? Number(form.vehicleYear) : null, atFaultVehicleYear: form.atFaultVehicleYear ? Number(form.atFaultVehicleYear) : null, incidentDate: form.incidentDate || null, adjusterVisitAt: form.adjusterVisitAt || null, dateSubmitted: form.dateSubmitted || null };
    try {
      const path = claim ? `/claims/${claim.id}` : "/claims";
      await fetchJson(path, { method: claim ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save claim"); }
    finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className={`modal claim-workspace ${printMode ? "authorization-mode" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className={`modal-heading claim-heading ${printMode ? "authorization-heading" : ""}`}>
          {!printMode && <div><p className="eyebrow">{claim ? "Edit claim" : "New intake"}</p><h2>{claim?.claimNumber || "Claim workspace"}</h2><p className="subheading">Customer, vehicle, insurer, and authorization record</p></div>}
          <div className="claim-heading-actions">{claim && <button type="button" className="danger-button" onClick={async () => { if (!window.confirm("Delete this claim? This cannot be undone.")) return; setBusy(true); setError(""); try { await fetchJson(`/claims/${claim.id}`, { method: "DELETE" }); await onSaved(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete claim"); } finally { setBusy(false); } }}>Delete claim</button>}<button type="button" className="secondary-button" onClick={() => setPrintMode(!printMode)}>{printMode ? "Back to intake" : "Authorization form"}</button><button className="close-button" onClick={onClose}><Icon name="close" /></button></div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!printMode && claim && <div className="claim-workspace-tabs" role="tablist" aria-label="Claim workspace sections"><button type="button" className={workspaceTab === "intake" ? "active" : ""} onClick={() => setWorkspaceTab("intake")}>Claim intake</button><button type="button" className={workspaceTab === "records" ? "active" : ""} onClick={() => setWorkspaceTab("records")}>Documents &amp; job records</button></div>}
        {printMode ? <AuthorizationForm form={form} customer={selectedCustomer || claim?.customer} vehicle={availableVehicles.find((item) => item.id === form.vehicleId) || claim?.vehicle} jobLabel={availableJobs.find((item) => item.id === form.jobId)?.jobNumber} jobId={String(form.jobId || "")} /> : workspaceTab === "records" && claim ? <ClaimRecordsPanel claim={claim} selectedJobId={String(form.jobId || "")} /> : (
          <form className="claim-form" onSubmit={save}>
            <div className="claim-section"><h3>Record links</h3><div className="claim-grid">
              <label>Existing customer<select required value={customerId} onChange={(event) => selectCustomer(event.target.value)}><option value="">Select customer</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.firstName} {customer.lastName}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}</select></label>
              <label>Vehicle belonging to customer<select value={String(form.vehicleId || "")} onChange={(event) => selectVehicle(event.target.value)} disabled={!customerId}><option value="">Manual vehicle details / none</option>{availableVehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle pending"}{vehicle.vin ? ` · ${vehicle.vin}` : ""}</option>)}</select></label>
              <label>Linked RO / job<select value={String(form.jobId || "")} onChange={(event) => update("jobId", event.target.value)} disabled={!customerId}><option value="">No linked repair order</option>{availableJobs.map((job) => <option value={job.id} key={job.id}>{job.jobNumber} · {job.status}</option>)}</select></label>
              <Field label="Claim #" value={form.claimNumber} onChange={(value) => update("claimNumber", value)} />
            </div></div>
            <div className="claim-section"><h3>Customer and policy</h3><div className="claim-grid">{claimTextFields.slice(1, 6).map(([key, label]) => <Field key={key} label={label} value={form[key]} onChange={(value) => update(key, value)} />)}<Field label="Primary insurance carrier" value={form.insuranceCompany} onChange={(value) => update("insuranceCompany", value)} /><Field label="Street" value={form.customerAddress} onChange={(value) => update("customerAddress", value)} /><Field label="City" value={form.customerCity} onChange={(value) => update("customerCity", value)} /><Field label="State" value={form.customerState} onChange={(value) => update("customerState", value)} /><Field label="ZIP" value={form.customerZip} onChange={(value) => update("customerZip", value)} /><Field label="Driver's license" value={form.driverLicense} onChange={(value) => update("driverLicense", value)} /></div></div>
            <div className="claim-section"><h3>Vehicle details</h3><div className="claim-grid"><div className="vin-control-row"><Field label="VIN" value={form.vehicleVin} onChange={(value) => update("vehicleVin", value)} /><button type="button" className="secondary-button" onClick={() => void decodeVin("customer")} disabled={vinState.customer.loading}>{vinState.customer.loading ? "Decoding..." : "Decode VIN"}</button></div>{vinState.customer.message && <p className={vinState.customer.error ? "vin-error" : "vin-success"}>{vinState.customer.message}</p>}<Field label="Vehicle year" value={form.vehicleYear} onChange={(value) => update("vehicleYear", value)} /><Field label="Vehicle make" value={form.vehicleMake} onChange={(value) => update("vehicleMake", value)} /><Field label="Vehicle model" value={form.vehicleModel} onChange={(value) => update("vehicleModel", value)} /><Field label="Vehicle trim" value={form.vehicleTrim} onChange={(value) => update("vehicleTrim", value)} /><Field label="Body style" value={form.vehicleBodyClass} onChange={(value) => update("vehicleBodyClass", value)} /><Field label="Vehicle color" value={form.vehicleColor} onChange={(value) => update("vehicleColor", value)} /><Field label="License plate" value={form.vehicleLicensePlate} onChange={(value) => update("vehicleLicensePlate", value)} /><Field label="Plate state" value={form.vehiclePlateState} onChange={(value) => update("vehiclePlateState", value)} /></div></div>
            <div className="claim-section"><h3>At-fault party and insurance</h3><div className="claim-grid"><Field label="At-fault driver name" value={form.atFaultDriverName} onChange={(value) => update("atFaultDriverName", value)} /><Field label="At-fault driver phone" value={form.atFaultDriverPhone} onChange={(value) => update("atFaultDriverPhone", value)} /><Field label="At-fault driver's license" value={form.atFaultDriverLicense} onChange={(value) => update("atFaultDriverLicense", value)} /><Field label="DL state" value={form.atFaultDriverDlState} onChange={(value) => update("atFaultDriverDlState", value)} /><Field label="At-fault license plate" value={form.atFaultPlate} onChange={(value) => update("atFaultPlate", value)} /><Field label="At-fault plate state" value={form.atFaultPlateState} onChange={(value) => update("atFaultPlateState", value)} /><div className="vin-control-row"><Field label="At-fault vehicle VIN" value={form.atFaultVehicleVin} onChange={(value) => update("atFaultVehicleVin", value)} /><button type="button" className="secondary-button" onClick={() => void decodeVin("atFault")} disabled={vinState.atFault.loading}>{vinState.atFault.loading ? "Decoding..." : "Decode VIN"}</button></div>{vinState.atFault.message && <p className={vinState.atFault.error ? "vin-error" : "vin-success"}>{vinState.atFault.message}</p>}<Field label="At-fault vehicle year" value={form.atFaultVehicleYear} onChange={(value) => update("atFaultVehicleYear", value)} /><Field label="At-fault vehicle make" value={form.atFaultVehicleMake} onChange={(value) => update("atFaultVehicleMake", value)} /><Field label="At-fault vehicle model" value={form.atFaultVehicleModel} onChange={(value) => update("atFaultVehicleModel", value)} /><Field label="At-fault vehicle trim" value={form.atFaultVehicleTrim} onChange={(value) => update("atFaultVehicleTrim", value)} /><Field label="At-fault body style" value={form.atFaultVehicleBodyClass} onChange={(value) => update("atFaultVehicleBodyClass", value)} /><Field label="At-fault vehicle color" value={form.atFaultVehicleColor} onChange={(value) => update("atFaultVehicleColor", value)} /><Field label="At-fault insurance" value={form.atFaultInsurance} onChange={(value) => update("atFaultInsurance", value)} /><Field label="At-fault policy number" value={form.atFaultPolicyNumber} onChange={(value) => update("atFaultPolicyNumber", value)} /><Field label="At-fault claim number" value={form.atFaultClaimNumber} onChange={(value) => update("atFaultClaimNumber", value)} /><Field label="At-fault insurance phone" value={form.atFaultInsurancePhone} onChange={(value) => update("atFaultInsurancePhone", value)} /></div></div>
            <div className="claim-section"><h3>Incident and witnesses</h3><div className="claim-grid"><Field label="Incident date" type="date" value={form.incidentDate} onChange={(value) => update("incidentDate", value)} /><Field label="Police report number" value={form.policeReportNumber} onChange={(value) => update("policeReportNumber", value)} /><Field label="Police department" value={form.policeDepartment} onChange={(value) => update("policeDepartment", value)} /><Field label="Witness name" value={form.witnessName} onChange={(value) => update("witnessName", value)} /><Field label="Witness phone" value={form.witnessPhone} onChange={(value) => update("witnessPhone", value)} /></div></div>
            <div className="claim-section"><h3>Documentation checklist</h3><div className="claim-checklist">{claimFlags.map(([key, label]) => <label key={key} className="checkbox-field"><input type="checkbox" checked={Boolean(form[key])} onChange={(event) => update(key, event.target.checked)} />{label}</label>)}</div><div className="claim-grid claim-followup"><Field label="Photo folder link" value={form.photoFolderLink} onChange={(value) => update("photoFolderLink", value)} /><Field label="Police report file" value={form.policeReportFile} onChange={(value) => update("policeReportFile", value)} /><Field label="Adjuster name" value={form.adjusterName} onChange={(value) => update("adjusterName", value)} /><Field label="Adjuster phone" value={form.adjusterPhone} onChange={(value) => update("adjusterPhone", value)} /><Field label="Adjuster email" value={form.adjusterEmail} onChange={(value) => update("adjusterEmail", value)} /><Field label="Adjuster visit" type="datetime-local" value={form.adjusterVisitAt} onChange={(value) => update("adjusterVisitAt", value)} /></div></div>
            <div className="claim-section"><h3>Claim status</h3><div className="claim-grid"><label>Status<select value={String(form.status)} onChange={(event) => update("status", event.target.value)}>{["new", "submitted", "in_review", "approved", "denied", "closed"].map((status) => <option key={status}>{status}</option>)}</select></label><Field label="Date submitted" type="date" value={form.dateSubmitted} onChange={(value) => update("dateSubmitted", value)} /><label className="claim-notes">Notes<textarea value={String(form.notes || "")} onChange={(event) => update("notes", event.target.value)} /></label></div></div>
            <div className="claim-form-actions"><button type="button" className="secondary-button" onClick={() => setPrintMode(true)}>Preview authorization</button><button className="orange-button" disabled={busy}>{busy ? "Saving..." : claim ? "Save claim" : "Create claim"}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}

const documentTypes = ["accident_photos", "license_photos", "insurance_card", "police_report", "estimate", "repair_authorization", "invoice", "parts_invoice", "receipt", "other"] as const;
function ClaimRecordsPanel({ claim, selectedJobId }: { claim: Claim; selectedJobId: string }) {
  const [hub, setHub] = React.useState<ClaimHub | null>(null);
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [target, setTarget] = React.useState(selectedJobId || "claim");
  const [documentType, setDocumentType] = React.useState<typeof documentTypes[number]>("other");
  const [description, setDescription] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function loadHub() {
    setLoading(true);
    try {
      const [hubResult, invoiceResult] = await Promise.all([
        fetchJson<ClaimHub>(`/claims/${claim.id}/hub`),
        fetchJson<Invoice[]>("/invoices"),
      ]);
      setHub(hubResult);
      setInvoices(invoiceResult);
      setError("");
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load claim records"); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { void loadHub(); }, [claim.id]);
  React.useEffect(() => { setTarget(selectedJobId || "claim"); }, [selectedJobId]);
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) { setError("Choose a file before uploading."); return; }
    setBusy(true); setError("");
    const body = new FormData();
    body.append("file", file); body.append("documentType", documentType); body.append("description", description);
    body.append(target === "claim" ? "claimId" : "jobId", target === "claim" ? claim.id : target);
    try { await fetchJson("/documents/upload", { method: "POST", body }); setFile(null); setDescription(""); await loadHub(); }
    catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Unable to upload document"); }
    finally { setBusy(false); }
  }
  const jobs = hub?.jobs || [];
  const linkedInvoices = invoices.filter((invoice) => invoice.claimId === claim.id || jobs.some((job) => invoice.jobId === job.id));
  const documents = [
    ...(hub?.documents || []).map((document) => ({ document, owner: "Claim" })),
    ...jobs.flatMap((job) => (job.documents || []).map((document) => ({ document, owner: job.jobNumber }))),
  ].sort((left, right) => new Date(right.document.createdAt).getTime() - new Date(left.document.createdAt).getTime());
  const downloadUrl = (id: string) => `${API_URL}/documents/${id}/download`;
  async function accessDocument(documentRecord: DocumentRecord, download: boolean) {
    const previewWindow = download ? null : window.open("about:blank", "_blank");
    if (!download && !previewWindow) { setError("Your browser blocked the document preview. Allow pop-ups for this app and try again."); return; }
    if (previewWindow) previewWindow.document.title = documentRecord.fileName;
    try {
      const response = await fetch(downloadUrl(documentRecord.id), { headers: { Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` } });
      if (!response.ok) throw new Error("Unable to open document");
      const url = URL.createObjectURL(await response.blob());
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = documentRecord.fileName;
        link.click();
      } else {
        previewWindow!.location.href = url;
      }
      if (download) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (documentError) {
      previewWindow?.close();
      setError(documentError instanceof Error ? documentError.message : "Unable to access document");
    }
  }
  return <div className="claim-records">
    <div className="records-heading"><div><p className="eyebrow">Claim file</p><h3>Documents &amp; job records</h3><p className="subheading">Keep the claim file, repair orders, estimates, and financial trail together.</p></div>{claim.photoFolderLink && <a className="secondary-button records-link" href={claim.photoFolderLink} target="_blank" rel="noreferrer">Open photo folder</a>}</div>
    {error && <div className="error-banner">{error}</div>}
    <form className="records-upload" onSubmit={upload}><label>Attach to<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="claim">Claim file</option>{jobs.map((job) => <option value={job.id} key={job.id}>{job.jobNumber} · {job.status}</option>)}</select></label><label>Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value as typeof documentTypes[number])}>{documentTypes.map((type) => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}</select></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional note" /></label><label className="records-file">File<input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button className="orange-button" disabled={busy}>{busy ? "Uploading..." : "Upload record"}</button></form>
    {loading ? <p className="records-muted">Loading claim records...</p> : <>
      <section className="records-section"><div className="records-section-heading"><h4>Uploaded documents</h4><span>{documents.length} records</span></div>{documents.length ? <div className="records-list">{documents.map(({ document, owner }) => <div className="record-row" key={document.id}><div><strong>{document.fileName}</strong><small>{document.documentType || "other"}{document.description ? ` · ${document.description}` : ""}</small></div><span>{owner}</span><time>{formatDateTime(document.createdAt)}</time><div className="document-actions"><button type="button" onClick={() => void accessDocument(document, false)}>Open</button><button type="button" onClick={() => void accessDocument(document, true)}>Download</button></div></div>)}</div> : <p className="records-muted">No local documents are attached yet.</p>}</section>
      <section className="records-section"><div className="records-section-heading"><h4>Invoices &amp; payments</h4><span>{linkedInvoices.length} linked</span></div>{linkedInvoices.length ? linkedInvoices.map((invoice) => <div className="record-summary invoice-record" key={invoice.id}><div><strong>{invoice.invoiceNumber} · {invoice.status}</strong><small>{invoice.job?.jobNumber || "Claim invoice"} · Total ${invoice.total.toFixed(2)} · Paid ${invoice.amountPaid.toFixed(2)} · Balance ${invoice.balanceDue.toFixed(2)}</small></div>{invoice.payments.length ? <div className="invoice-payment-list">{invoice.payments.map((payment) => <small key={payment.id}>{payment.method.replace("_", " ")} · ${payment.amount.toFixed(2)} · {formatDateTime(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small>)}</div> : <small>No payments recorded</small>}</div>) : <p className="records-muted">No invoices are linked to this claim or its repair orders yet.</p>}</section>
      {jobs.map((job) => <section className="records-section" key={job.id}><div className="records-section-heading"><h4>{job.jobNumber} <span className={`status-pill ${job.status === "completed" ? "green" : "orange"}`}>{job.status}</span></h4><span>Revenue ${job.totalRevenue.toFixed(2)} · Expenses ${(job.totalExpenses ?? job.expenses?.reduce((sum, expense) => sum + expense.amount, 0) ?? 0).toFixed(2)}</span></div>{(job.estimates || []).map((estimate) => <div className="record-summary" key={estimate.id}><strong>Estimate {estimate.estimateNumber || " draft"} · ${estimate.totalAmount.toFixed(2)}</strong><small>{estimate.status} · {estimate.lineItems.length} line items: {estimate.lineItems.map((line) => line.description).join(", ")}</small></div>)}{(job.expenses || []).map((expense) => <div className="record-summary" key={expense.id}><strong>Expense · ${expense.amount.toFixed(2)}</strong><small>{expense.description}{expense.category ? ` · ${expense.category}` : ""} · {formatDateTime(expense.expenseDate)}</small></div>)}{(job.statusHistory || []).map((entry) => <div className="record-summary" key={entry.id}><strong>Status {entry.fromStatus} → {entry.toStatus}</strong><small>{entry.note || "No note"} · {formatDateTime(entry.createdAt)}</small></div>)}{(job.authorizations || []).map((authorization) => <div className="record-summary" key={authorization.id}><strong>Repair authorization · {authorization.status}</strong><small>{authorization.fileName} · {formatDateTime(authorization.generatedAt)}</small></div>)}</section>)}
    </>}
  </div>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | boolean | undefined; onChange: (value: string) => void; type?: string }) {
  return <label>{label}<input type={type} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></label>;
}

function AuthorizationForm({ form, customer, vehicle, jobId }: { form: ClaimForm; customer?: Customer; vehicle?: Vehicle | null; jobLabel?: string; jobId?: string }) {
  const customerName = customer ? `${customer.firstName} ${customer.lastName}` : String(form.customerName || "");
  const vehicleYear = vehicle?.year || form.vehicleYear || "";
  const vehicleMake = vehicle?.make || form.vehicleMake || "";
  const vehicleModel = vehicle?.model || form.vehicleModel || "";
  const vehicleVin = vehicle?.vin || form.vehicleVin || "";
  const vehiclePlate = vehicle?.licensePlate || form.vehicleLicensePlate || "";
  const value = (field: string) => String(form[field] || "");
  const [downloadBusy, setDownloadBusy] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState("");
  const line = (label: string, content: React.ReactNode = "", className = "") => <span className={`authorization-field ${className}`}><b>{label}</b> <span>{content}</span></span>;
  const section = (title: string, children: React.ReactNode) => <section className="authorization-section"><h3>{title}</h3>{children}<div className="authorization-initial">Initial here: ____________________</div></section>;
  async function downloadAuthorization() {
    if (!jobId) { setDownloadError("Link a repair order before downloading the authorization."); return; }
    setDownloadBusy(true); setDownloadError("");
    try {
      const result = await fetchJson<{ downloadUrl: string; fileName: string }>(`/jobs/${jobId}/authorization.pdf`, { method: "POST" });
      const response = await fetch(new URL(result.downloadUrl, API_URL).toString(), { headers: { Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` } });
      if (!response.ok) throw new Error("Unable to download authorization PDF");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (downloadActionError) {
      setDownloadError(downloadActionError instanceof Error ? downloadActionError.message : "Unable to download authorization PDF");
    } finally { setDownloadBusy(false); }
  }
  return <div className="authorization-preview"><div className="authorization-actions"><button type="button" className="orange-button print-button" onClick={() => window.print()}>Print authorization</button><button type="button" className="secondary-button download-button" onClick={() => void downloadAuthorization()} disabled={downloadBusy}>{downloadBusy ? "Preparing PDF..." : "Download PDF"}</button></div>{downloadError && <p className="authorization-download-error">{downloadError}</p>}<article className="authorization-paper">
    <header className="authorization-header"><h1>MASTERCRAFT AUTO REPAIR &amp; COLLISION</h1><p>38-21 23rd Street, Long Island City, NY 11101</p><p>Tel: (718) 603-0412&nbsp; · &nbsp;(718) 578-4563</p><p>Website: www.mastercraftauto.com</p><p>Email: shop@mastercraftautony.com</p><span className="authorization-facility">Facility Number: 7136099</span><span className="authorization-ein">EIN# 42-2914045</span></header>
    <h2 className="authorization-recognized">Recognized By All Insurance Companies</h2>
    <div className="authorization-intake">
      <div className="authorization-line-row">{line("Date", new Date().toLocaleDateString("en-US"), "date-line")}{line("Name (Person in Charge)", customerName, "name-line")}{line("Claim#", value("claimNumber"), "claim-line")}</div>
      <div className="authorization-line-row">{line("Address", value("customerAddress"), "address-line")}{line("City", value("customerCity"), "city-line")}</div>
      <div className="authorization-line-row">{line("State", value("customerState"), "state-line")}{line("Zip Code", value("customerZip"), "zip-line")}{line("Phone", value("customerPhone"), "phone-line")}{line("Alt. Phone", "", "alt-phone-line")}</div>
      <div className="authorization-line-row">{line("License No.", value("driverLicense"), "license-line")}{line("Insurance Company", value("insuranceCompany"), "insurance-line")}{line("Date of Loss", value("incidentDate"), "loss-line")}</div>
      <div className="authorization-line-row">{line("Year", vehicleYear, "year-line")}{line("Make", vehicleMake, "make-line")}{line("Model", vehicleModel, "model-line")}{line("Type", value("vehicleBodyClass"), "type-line")}{line("License No.", vehiclePlate, "vehicle-license-line")}</div>
      <div className="authorization-line-row">{line("Vehicle Identification Number", vehicleVin, "vin-line")}{line("Color", vehicle?.color || value("vehicleColor"), "color-line")}</div>
    </div>
    {section("Designated Representative Authorization", <p>I (Above Owner) insured by: <span className="authorization-blank">______________________________</span> hereby authorize MASTERCRAFT AUTO REPAIR &amp; COLLISION as my/our designated representative to reach an agreed price with the insurance company as to the reasonable cost to repair my/our vehicle. The designated authorization is in conformance with New York State Department Regulations No.64 and is NOT an authorization to repair.</p>)}
    {section("Authorization To Repair", <><p>I (Above Owner) hereby authorize MASTERCRAFT AUTO REPAIR &amp; COLLISION to test drive my vehicle while the vehicle is in their possession.</p><p className="authorization-bold-center">AS AGREED TO REPAIR FOR INSURANCE COMPANY PRICE ONLY AND AS PER SHOP ESTIMATE<br />TO OWNER OR PERSON IN CHARGE OF DAMAGE VEHICLE:</p><p>Please read all printed matter before signing, all complaints of quality of repairs must be made to the New York State Department of Motor Vehicle. No Towing Company or Insurance may require that repair be made to a motor vehicle in a particular place or repair shop. You have the right to have your motor vehicle repaired in the shop of your choice.</p><p>1. Do Not Sign this "Authorization to Repair" at the scene of an accident. You can not be required to do so<br /><span className="authorization-indent">SIGN ONLY AT:</span><br /><span className="authorization-indent">(a) The place to which the vehicle is towed to, or</span><br /><span className="authorization-indent">(b) Your home or place designated by the person in charge of the disabled vehicle, or</span><br /><span className="authorization-indent">(c) The hospital, if you are hospitalized by not before twenty-four (24) hours after the accident unless you are discharged from hospital before that period of time.</span></p><p>2. Before signing your name to the bottom of this form, print/write in your own handwriting in the spaces provided I authorize the repair of the vehicle indicated above.</p></>)}
    {section("Authorization To Dismantle", <p>I (Above Owner) hereby authorize MASTERCRAFT AUTO REPAIR &amp; COLLISION to dismantle my vehicle prior/after Insurance Co. inspection to see any hidden and related damage. MASTERCRAFT AUTO REPAIR &amp; COLLISION hourly rate of $75.00 per hour maximum time of dismantling <span className="authorization-blank">__________</span> hours. I also allow MASTERCRAFT AUTO REPAIR &amp; COLLISION to place my vehicle in any one of their location while in their possession.</p>)}
    {section("Direction of Payment", <p>I (Above Owner) hereby authorize <span className="authorization-blank">______________________________</span> on my claim# <span className="authorization-blank">__________________</span> to directly pay MASTERCRAFT AUTO REPAIR &amp; COLLISION. I understand that by signing this authorization, I will give permission to also make 2 party check.</p>)}
    {section("Department of Motor Vehicles Notification", <p>I Authorize MASTERCRAFT AUTO REPAIR &amp; COLLISION to charge $150.00 per day storage for above vehicle upon completion of repairs or if vehicle redeemed a total loss.</p>)}
    <table className="authorization-signature-table"><thead><tr><th>Owner/person in charge (Print Name)</th><th>Signature</th><th>Date</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><div className="authorization-signed-fields">{line("Address where signed", "")}{line("City", "")}{line("State / Zip-Code", "")}</div><p className="authorization-final">ALL OF THE ABOVE ENTRIES MUST BE MADE AT THE TIME THE AUTHORIZATION TO REPAIR IS SIGNED.</p>
  </article></div>;
}

function LegacyAuthorizationForm({ form, customer, vehicle, jobLabel }: { form: ClaimForm; customer?: Customer; vehicle?: Vehicle | null; jobLabel?: string }) {
  return <div className="authorization-paper"><div className="authorization-brand"><strong>MASTERCRAFT</strong><span>COLLISION REPAIR AUTHORIZATION</span></div><div className="authorization-meta"><span>Claim #: <b>{String(form.claimNumber || "")}</b></span><span>RO / Job: <b>{jobLabel || ""}</b></span><span>Date: <b>{new Date().toLocaleDateString()}</b></span></div><p>I hereby authorize Mastercraft Collision Repair to act as my designated representative for the repair of the vehicle described below and to communicate with my insurance carrier on my behalf.</p><h4>Designated representative authorization</h4><p>Mastercraft Collision Repair is authorized to discuss estimates, supplements, photographs, payment, and repair status with the insurance company and its representatives.</p><h4>Authorization to repair</h4><p>I authorize the shop to repair my vehicle using accepted industry methods and the parts and procedures necessary to restore it to pre-loss condition. I understand that I am responsible for all charges not paid by insurance.</p><h4>Authorization to dismantle</h4><p>I authorize disassembly as reasonably necessary to inspect hidden damage and prepare a complete estimate. I understand that dismantling may reveal additional damage and that reassembly charges may apply if repairs are declined.</p><h4>Direction of payment</h4><p>I direct my insurance company to pay Mastercraft Collision Repair directly for authorized repairs and supplements. This direction does not release me from responsibility for the repair balance.</p><h4>DMV notification</h4><p>I acknowledge that required damage or total-loss information may be reported to the DMV or other governmental agency as required by law.</p><div className="authorization-vehicle"><span>Customer: <b>{customer ? `${customer.firstName} ${customer.lastName}` : String(form.customerName || "")}</b></span><span>Vehicle: <b>{vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : [form.vehicleYear, form.vehicleMake, form.vehicleModel].filter(Boolean).join(" ")}</b></span><span>VIN: <b>{String(form.vehicleVin || "")}</b></span></div><div className="authorization-signatures"><div><span>Customer printed name</span><i /><span>Customer signature</span><i /></div><div><span>Shop representative printed name</span><i /><span>Shop representative signature</span><i /></div></div><div className="authorization-footer"><span>Address where signed: ______________________________________________</span><span>Customer initials: __________</span><span>Shop initials: __________</span></div><button className="orange-button print-button" onClick={() => window.print()}><Icon name="file" /> Print completed form</button></div>;
}
function JobView({
  jobs,
  onChanged = async () => undefined,
}: {
  jobs: Job[];
  onChanged?: () => Promise<void>;
}) {
  const [selectedJob, setSelectedJob] = React.useState<Job | null>(null);
  return (
    <>
      <div className="surface">
        <SurfaceHeading
          title="Repair board"
          subtitle="Every active work order in one place"
        />
        <p className="records-muted">Jobs cannot be deleted here because linked claims, invoices, and repair history are protected by the backend.</p>
        <JobTable jobs={jobs} onSelect={setSelectedJob} />
        {jobs.length === 0 && (
          <EmptyState text="No repair jobs yet. Create a job from a claim or customer intake." />
        )}
      </div>
      {selectedJob && (
        <JobOperations
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
function JobOperations({
  job,
  onClose,
  onChanged,
}: {
  job: Job;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const statuses = [
    "new",
    "inspection",
    "authorized",
    "in_progress",
    "ready",
    "completed",
    "cancelled",
  ];
  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [generatedInvoice, setGeneratedInvoice] = React.useState<{ id: string; invoiceNumber: string } | null>(null);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    description: "",
    amount: "",
    category: "",
  });
  const [error, setError] = React.useState("");
  async function loadExpenses() {
    setExpenses(await fetchJson<Expense[]>(`/jobs/${job.id}/expenses`));
  }
  React.useEffect(() => {
    void loadExpenses();
  }, [job.id]);
  async function transition(status: string) {
    try {
      await fetchJson(`/jobs/${job.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await onChanged();
      onClose();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update status",
      );
    }
  }
  async function addExpense(event: React.FormEvent) {
    event.preventDefault();
    try {
      await fetchJson(`/jobs/${job.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ description: "", amount: "", category: "" });
      await loadExpenses();
      await onChanged();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to add expense",
      );
    }
  }
  async function generateInvoice() {
    try {
      const invoice = await fetchJson<{ id: string; invoiceNumber: string }>(`/invoices/from-job/${job.id}`, { method: "POST" });
      setGeneratedInvoice(invoice);
      await onChanged();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to generate PDF",
      );
    }
  }
  async function downloadGeneratedInvoice() {
    if (!generatedInvoice) return;
    setPdfBusy(true);
    try {
      const result = await fetchJson<{ downloadUrl: string; fileName: string }>(`/invoices/${generatedInvoice.id}/pdf`, { method: "POST" });
      const response = await fetch(new URL(result.downloadUrl, API_URL).toString(), { headers: { Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` } });
      if (!response.ok) throw new Error("Unable to download invoice PDF");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = result.fileName;
      link.click();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to download invoice PDF");
    } finally { setPdfBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal job-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{job.jobNumber}</p>
            <h2>Job operations</h2>
          </div>
          <button className="close-button" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {generatedInvoice && <div className="vin-success">Invoice {generatedInvoice.invoiceNumber} is ready. <button className="secondary-button" type="button" onClick={() => void downloadGeneratedInvoice()} disabled={pdfBusy}>{pdfBusy ? "Preparing PDF..." : "Download invoice PDF"}</button></div>}
        <label>
          Status
          <select
            value={job.status}
            onChange={(event) => void transition(event.target.value)}
          >
            {statuses.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button
          className="orange-button"
          type="button"
          onClick={() => void generateInvoice()}
        >
          <Icon name="file" /> Generate job invoice
        </button>
        <div className="operation-section">
          <h3>Expenses</h3>
          {expenses.length ? (
            <div className="expense-list">
              {expenses.map((expense) => (
                <div key={expense.id}>
                  <span>
                    {expense.description}
                    <small>
                      {expense.category || "General"} ·{" "}
                      {new Date(expense.expenseDate).toLocaleDateString()}
                    </small>
                  </span>
                  <span className="expense-actions"><strong>${expense.amount.toLocaleString()}</strong><button type="button" className="danger-button compact-danger" onClick={async () => { if (!window.confirm(`Delete expense "${expense.description}"?`)) return; setError(""); try { await fetchJson(`/jobs/expenses/${expense.id}`, { method: "DELETE" }); await loadExpenses(); await onChanged(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete expense"); } }}>Delete</button></span>
                </div>
              ))}
            </div>
          ) : (
            <p className="table-subtext">No expenses recorded for this job.</p>
          )}
          <form className="expense-form" onSubmit={addExpense}>
            <input
              required
              placeholder="Description"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
            <input
              required
              min="0.01"
              step="0.01"
              type="number"
              placeholder="Amount"
              value={form.amount}
              onChange={(event) =>
                setForm({ ...form, amount: event.target.value })
              }
            />
            <input
              placeholder="Category"
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value })
              }
            />
            <button className="text-button">
              Add expense <Icon name="plus" />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function EstimateRegister({
  estimates,
  onNavigate,
}: {
  estimates: Estimate[];
  onNavigate: (view: View) => void;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  onChanged: () => Promise<void>;
}) {
  const total = estimates.reduce(
    (sum, estimate) => sum + estimate.totalAmount,
    0,
  );
  return (
    <>
      <div className="metric-grid compact-metrics">
        <MetricSummary
          label="Estimates"
          value={estimates.length}
          note="Saved repair proposals"
          icon="file"
          tone="blue"
        />
        <MetricSummary
          label="Quoted value"
          value={`$${total.toLocaleString()}`}
          note="Across all estimates"
          icon="chart"
          tone="orange"
        />
      </div>
      <div className="surface">
        <SurfaceHeading
          title="Estimate register"
          subtitle="Line-item totals and authorization status"
        />
        {estimates.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Estimate</th>
                <th>Work order</th>
                <th>Customer</th>
                <th>Line items</th>
                <th>Status</th>
                <th>Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((estimate) => (
                <tr key={estimate.id}>
                  <td>
                    <strong className="mono">
                      {estimate.estimateNumber || "DRAFT"}
                    </strong>
                  </td>
                  <td className="mono">{estimate.job.jobNumber}</td>
                  <td>
                    {estimate.job.customer.firstName}{" "}
                    {estimate.job.customer.lastName}
                  </td>
                  <td>{estimate.lineItems.length}</td>
                  <td>
                    <span
                      className={`status-pill ${estimate.status === "approved" ? "green" : estimate.status === "draft" ? "blue" : "orange"}`}
                    >
                      {estimate.status}
                    </span>
                  </td>
                  <td>
                    <strong>${estimate.totalAmount.toLocaleString()}</strong>
                  </td>
                  <td><button type="button" className="danger-button compact-danger" onClick={async () => { if (!window.confirm(`Delete estimate ${estimate.estimateNumber || "DRAFT"}?`)) return; try { await request(`/estimates/${estimate.id}`, { method: "DELETE" }); await onChanged(); } catch (deleteError) { window.alert(deleteError instanceof Error ? deleteError.message : "Unable to delete estimate"); } }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            text="No estimates yet. Create an estimate from a repair job when the estimate workflow is enabled."
            action="View repair jobs"
            onAction={() => onNavigate("Jobs")}
          />
        )}
      </div>
    </>
  );
}
function DocumentView({
  documents,
  jobs = [],
  claims = [],
  onUploaded = async () => undefined,
}: {
  documents: DocumentsData | null;
  jobs?: Job[];
  claims?: Claim[];
  onUploaded?: () => Promise<void>;
}) {
  const records = [
    ...(documents?.claimDocuments || []),
    ...(documents?.jobDocuments || []),
  ];
  const [context, setContext] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [message, setMessage] = React.useState("");
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !context) return;
    const body = new FormData();
    body.append("file", file);
    if (context.startsWith("job:")) body.append("jobId", context.slice(4));
    else body.append("claimId", context.slice(6));
    try {
      await fetchJson("/documents/upload", { method: "POST", body });
      setFile(null);
      setContext("");
      setMessage(
        "Uploaded and persisted by the API in its local uploads directory.",
      );
      await onUploaded();
    } catch (uploadError) {
      setMessage(
        uploadError instanceof Error ? uploadError.message : "Unable to upload",
      );
    }
  }
  return (
    <>
      <div className="surface upload-panel">
        <SurfaceHeading
          title="Upload document"
          subtitle="Attach a file to one job or claim"
        />
        <form className="upload-form" onSubmit={upload}>
          <select
            required
            value={context}
            onChange={(event) => setContext(event.target.value)}
          >
            <option value="">Select job or claim</option>
            <optgroup label="Jobs">
              {jobs.map((job) => (
                <option value={`job:${job.id}`} key={job.id}>
                  {job.jobNumber} - {job.customer.firstName}{" "}
                  {job.customer.lastName}
                </option>
              ))}
            </optgroup>
            <optgroup label="Claims">
              {claims.map((claim) => (
                <option value={`claim:${claim.id}`} key={claim.id}>
                  {claim.claimNumber || "Unnumbered claim"} -{" "}
                  {claim.customer.firstName} {claim.customer.lastName}
                </option>
              ))}
            </optgroup>
          </select>
          <input
            required
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <button className="orange-button" disabled={!file || !context}>
            <Icon name="plus" /> Upload
          </button>
        </form>
        {message && <small className="upload-note">{message}</small>}
        <small className="upload-note">
          Files are stored as local server files, so they require the API's
          upload directory to remain available.
        </small>
      </div>
      <div className="surface">
        <SurfaceHeading
          title="Document register"
          subtitle="Claim and job paperwork, receipts, and authorizations"
        />
        {records.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Context</th>
                <th>Type</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {records.map((document) => {
                const owner = document.claim || document.job;
                const customer = owner?.customer;
                return (
                  <tr key={document.id}>
                    <td>
                      <div className="document-cell">
                        <Icon name="file" />
                        <strong>{document.fileName}</strong>
                      </div>
                    </td>
                    <td>
                      {document.claim
                        ? `Claim ${document.claim.claimNumber || "unassigned"}`
                        : `Job ${document.job?.jobNumber}`}
                      <small className="table-subtext">
                        {customer
                          ? `${customer.firstName} ${customer.lastName}`
                          : "Customer unavailable"}
                      </small>
                    </td>
                    <td>{document.documentType || "General document"}</td>
                    <td>{new Date(document.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState text="No documents uploaded yet." />
        )}
      </div>
    </>
  );
}
function ReportView({
  reports,
  onNavigate,
}: {
  reports: ReportsData | null;
  onNavigate: (view: View) => void;
}) {
  const metrics = reports?.metrics || {
    openJobs: 0,
    inspections: 0,
    customers: 0,
    revenue: 0,
    expenses: 0,
  };
  const margin = metrics.revenue - metrics.expenses;
  return (
    <>
      <section className="metric-grid">
        <MetricSummary
          label="Gross revenue"
          value={`$${metrics.revenue.toLocaleString()}`}
          note="From repair jobs"
          icon="chart"
          tone="green"
        />
        <MetricSummary
          label="Shop expenses"
          value={`$${metrics.expenses.toLocaleString()}`}
          note="Recorded job expenses"
          icon="wrench"
          tone="orange"
        />
        <MetricSummary
          label="Net contribution"
          value={`$${margin.toLocaleString()}`}
          note="Revenue less expenses"
          icon="arrow"
          tone="blue"
        />
        <MetricSummary
          label="Documents"
          value={reports?.documentCount || 0}
          note="Claim and job records"
          icon="folder"
          tone="purple"
        />
      </section>
      <div className="dashboard-grid report-grid">
        <div className="surface">
          <SurfaceHeading
            title="Workload by stage"
            subtitle="Current repair jobs grouped by status"
          />
          {reports?.jobsByStatus.length ? (
            <div className="status-list">
              {reports.jobsByStatus.map((entry) => (
                <div className="status-row" key={entry.status}>
                  <span>{entry.status}</span>
                  <strong>{entry.count}</strong>
                  <div className="status-bar">
                    <i
                      style={{
                        width: `${Math.min(100, (entry.count / Math.max(...reports.jobsByStatus.map((item) => item.count))) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              text="No repair jobs to summarize yet."
              action="Open jobs"
              onAction={() => onNavigate("Jobs")}
            />
          )}
        </div>
        <div className="surface">
          <SurfaceHeading
            title="Pipeline signals"
            subtitle="Operational totals from this workspace"
          />
          <div className="report-facts">
            <div>
              <span>Active jobs</span>
              <strong>{metrics.openJobs}</strong>
            </div>
            <div>
              <span>Scheduled inspections</span>
              <strong>{metrics.inspections}</strong>
            </div>
            <div>
              <span>Customers</span>
              <strong>{metrics.customers}</strong>
            </div>
            <div>
              <span>Estimate value</span>
              <strong>
                ${(reports?.estimateTotals.total || 0).toLocaleString()}
              </strong>
              <small>
                {reports?.estimateTotals.count || 0} saved estimates
              </small>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
function MetricSummary({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  note: string;
  icon: string;
  tone: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon name={icon} />
      </div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}
function DataSurface({
  title,
  subtitle,
  headers,
  rows,
  empty,
  onRowClick,
}: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
  onRowClick?: (index: number) => void;
}) {
  return (
    <div className="surface">
      <SurfaceHeading title={title} subtitle={subtitle} />
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={onRowClick ? "clickable-row" : undefined} onClick={() => onRowClick?.(index)}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState text={empty} />}
    </div>
  );
}
function SurfaceHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="surface-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <button className="filter-button">
        Filter <span>v</span>
      </button>
    </div>
  );
}
function JobTable({
  jobs,
  onSelect,
}: {
  jobs: Job[];
  onSelect?: (job: Job) => void;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Work order</th>
          <th>Customer</th>
          <th>Vehicle</th>
          <th>Stage</th>
          <th>Revenue</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr
            key={job.id}
            className={onSelect ? "clickable-row" : ""}
            onClick={() => onSelect?.(job)}
          >
            <td>
              <strong className="mono">{job.jobNumber}</strong>
            </td>
            <td>
              {job.customer.firstName} {job.customer.lastName}
            </td>
            <td>
              {job.vehicle
                ? [job.vehicle.year, job.vehicle.make, job.vehicle.model]
                    .filter(Boolean)
                    .join(" ")
                : "Vehicle pending"}
            </td>
            <td>
              <span
                className={`status-pill ${job.status === "completed" ? "green" : job.status === "new" ? "blue" : "orange"}`}
              >
                {job.status}
              </span>
            </td>
            <td>${job.totalRevenue.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function InspectionModal({
  customers,
  claims,
  jobs,
  inspection,
  onClose,
  onCreated,
}: {
  customers: Customer[];
  claims: Claim[];
  jobs: Job[];
  inspection?: Inspection | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = React.useState({
    customerId: inspection?.customer.id || "",
    claimId: inspection?.claim?.id || "",
    jobId: inspection?.job?.id || "",
    scheduledFor: toDateTimeLocal(inspection?.scheduledFor),
    inspectorName: inspection?.inspectorName || "",
    inspectorPhone: inspection?.inspectorPhone || "",
    insuranceRep: inspection?.insuranceRep || "",
    status: inspection?.status || "scheduled",
    notes: inspection?.notes || "",
  });
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const customerClaims = claims.filter((claim) => claim.customerId === form.customerId);
  const customerJobs = jobs.filter(
    (job) => job.customer.id === form.customerId && (!form.claimId || job.claimId === form.claimId),
  );
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await fetchJson(inspection ? `/inspections/${inspection.id}` : "/inspections", {
        method: inspection ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, claimId: form.claimId || undefined, jobId: form.jobId || undefined }),
      });
      onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to schedule inspection");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal inspection-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Schedule an inspection</p>
            <h2>{inspection ? "Edit event" : "Add event"}</h2>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <label>
          Customer
          <select
            required
            value={form.customerId}
            onChange={(event) => setForm({ ...form, customerId: event.target.value, claimId: "", jobId: "" })}
          >
            <option value="">Select customer</option>
            {customers.map((customer) => (
              <option value={customer.id} key={customer.id}>
                {customer.firstName} {customer.lastName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Claim {customerClaims.length ? "" : "(optional)"}
          <select
            required={customerClaims.length > 0}
            disabled={!form.customerId || !customerClaims.length}
            value={form.claimId}
            onChange={(event) => update("claimId", event.target.value)}
          >
            <option value="">{customerClaims.length ? "Select claim" : "No claims on file"}</option>
            {customerClaims.map((claim) => (
              <option value={claim.id} key={claim.id}>
                {claim.claimNumber || "Unnumbered claim"} · {claim.insuranceCompany || "Insurance pending"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Repair job (optional)
          <select
            disabled={!form.customerId || !form.claimId || !customerJobs.length}
            value={form.jobId}
            onChange={(event) => update("jobId", event.target.value)}
          >
            <option value="">{customerJobs.length ? "No linked job" : "No matching jobs"}</option>
            {customerJobs.map((job) => (
              <option value={job.id} key={job.id}>
                {job.jobNumber} · {job.status}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Inspection date and time
            <input required type="datetime-local" value={form.scheduledFor} onChange={(event) => update("scheduledFor", event.target.value)} />
          </label>
          <label>
            Inspector name
            <input value={form.inspectorName} onChange={(event) => update("inspectorName", event.target.value)} />
          </label>
          <label>
            Inspector phone
            <input type="tel" value={form.inspectorPhone} onChange={(event) => update("inspectorPhone", event.target.value)} placeholder="(718) 555-0142" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Insurance representative
            <input value={form.insuranceRep} onChange={(event) => update("insuranceRep", event.target.value)} />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(event) => update("status", event.target.value)}>
              {['scheduled', 'completed', 'cancelled', 'rescheduled'].map((status) => (
                <option value={status} key={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Notes
          <textarea className="inspection-notes" value={form.notes} onChange={(event) => update("notes", event.target.value)} />
        </label>
        <button className="orange-button submit-button" type="submit" disabled={saving}>
          {saving ? "Saving..." : inspection ? "Save changes" : "Schedule inspection"} <Icon name="arrow" />
        </button>
      </form>
    </div>
  );
}
function ScheduleItem({
  time,
  title,
  detail,
  status,
  tone,
  onClick,
}: {
  time: string;
  title: string;
  detail: string;
  status: string;
  tone: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="schedule-item schedule-item-clickable" onClick={onClick}>
      <time>{time}</time>
      <span className={`schedule-line ${tone}`} />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
        <span className={`status-pill ${status === "scheduled" ? "orange" : "blue"}`}>{status}</span>
      </div>
    </button>
  );
}
function EmptyState({
  text,
  action,
  onAction,
}: {
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      {text}
      {action && onAction && (
        <button className="text-button" onClick={onAction}>
          {action} <Icon name="arrow" />
        </button>
      )}
    </div>
  );
}

function CreateModal({
  type,
  customers,
  vehicles,
  onClose,
  onCreated,
}: {
  type: "customer" | "vehicle" | "claim" | "job";
  customers: Customer[];
  vehicles: Vehicle[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [vinLoading, setVinLoading] = React.useState(false);
  const [vinMessage, setVinMessage] = React.useState("");
  const labels = {
    customer: "New customer",
    vehicle: "Add vehicle",
    claim: "New insurance claim",
    job: "Create repair job",
  };
  const endpoint = {
    customer: "/customers",
    vehicle: "/vehicles",
    claim: "/claims",
    job: "/jobs",
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const payload = type === "vehicle"
        ? { ...form, year: form.year ? Number(form.year) : undefined, vin: form.vin?.toUpperCase(), licensePlate: form.licensePlate?.toUpperCase() }
        : form;
      await fetchJson(endpoint[type], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onCreated();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Unable to save",
      );
    }
  }
  async function decodeVehicleVin() {
    const vin = form.vin?.trim();
    if (!vin) { setVinMessage("Enter a VIN first."); return; }
    setVinLoading(true); setVinMessage("");
    try {
      const result = await fetchJson<{ year: string; make: string; model: string; trim: string; bodyClass: string; color?: string }>(`/vin/${encodeURIComponent(vin)}`);
      setForm((current) => ({ ...current, vin: vin.toUpperCase(), year: result.year, make: result.make, model: result.model, trim: result.trim, bodyClass: result.bodyClass, color: result.color || current.color }));
      setVinMessage(`Decoded ${[result.year, result.make, result.model, result.trim].filter(Boolean).join(" ")}`);
    } catch (decodeError) { setVinMessage(decodeError instanceof Error ? decodeError.message : "VIN could not be decoded"); }
    finally { setVinLoading(false); }
  }
  const input = (
    key: string,
    label: string,
    required = false,
    placeholder = "",
  ) => (
    <label>
      {label}
      <input
        required={required}
        placeholder={placeholder}
        value={form[key] || ""}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </label>
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Workspace action</p>
            <h2>{labels[type]}</h2>
          </div>
          <button type="button" className="close-button" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {type === "customer" && (
          <>
            {input("firstName", "First name", true)}
            {input("lastName", "Last name", true)}
            {input("phone", "Phone")}
            {input("email", "Email")}
          </>
        )}
        {type === "vehicle" && (
          <>
            <Select
              name="customerId"
              label="Customer"
              options={customers.map((customer) => ({
                value: customer.id,
                label: `${customer.firstName} ${customer.lastName}`,
              }))}
              form={form}
              setForm={setForm}
            />
            <div className="vin-control-row">{input("vin", "VIN", false, "4T1G11AK7MU425615")}<button type="button" className="secondary-button" onClick={() => void decodeVehicleVin()} disabled={vinLoading}>{vinLoading ? "Decoding..." : "Decode VIN"}</button></div>
            {vinMessage && <p className={vinMessage.startsWith("Decoded") ? "vin-success" : "vin-error"}>{vinMessage}</p>}
            <div className="form-row">{input("year", "Year", false, "2024")}{input("make", "Make")}{input("model", "Model")}</div>
            <div className="form-row">{input("trim", "Trim")}{input("bodyClass", "Body style")}{input("color", "Color")}</div>
            <div className="form-row">{input("licensePlate", "License plate")}{input("licenseState", "Plate state")}</div>
          </>
        )}
        {type === "claim" && (
          <>
            <Select
              name="customerId"
              label="Customer"
              options={customers.map((customer) => ({
                value: customer.id,
                label: `${customer.firstName} ${customer.lastName}`,
              }))}
              form={form}
              setForm={setForm}
            />
            <Select
              name="vehicleId"
              label="Vehicle"
              options={vehicles.map((vehicle) => ({
                value: vehicle.id,
                label: `${vehicle.make || ""} ${vehicle.model || ""} - ${vehicle.customer.lastName}`,
              }))}
              form={form}
              setForm={setForm}
            />
            {input("claimNumber", "Claim number")}
            {input("insuranceCompany", "Insurance carrier")}
            {input("adjusterName", "Adjuster name")}
          </>
        )}
        {type === "job" && (
          <>
            <Select
              name="customerId"
              label="Customer"
              options={customers.map((customer) => ({
                value: customer.id,
                label: `${customer.firstName} ${customer.lastName}`,
              }))}
              form={form}
              setForm={setForm}
            />
            {input("jobNumber", "Job number", true, "J-2040")}
            <Select
              name="vehicleId"
              label="Vehicle"
              options={vehicles.map((vehicle) => ({
                value: vehicle.id,
                label: `${vehicle.make || ""} ${vehicle.model || ""} - ${vehicle.customer.lastName}`,
              }))}
              form={form}
              setForm={setForm}
            />
          </>
        )}
        <button className="orange-button submit-button" type="submit">
          Save to workspace <Icon name="arrow" />
        </button>
      </form>
    </div>
  );
}
function Select({
  name,
  label,
  options,
  form,
  setForm,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  form: Record<string, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <label>
      {label}
      <select
        required
        value={form[name] || ""}
        onChange={(event) => setForm({ ...form, [name]: event.target.value })}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
