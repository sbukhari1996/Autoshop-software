import React from "react";
import type { Invoice } from "./InvoiceView";

// Lightweight shapes: only the fields the reports read.
export type ReportJob = { id: string; jobNumber: string; status: string; totalRevenue: number; customer: { firstName: string; lastName: string } | null };
export type ReportClaim = { id: string; claimNumber: string | null; insuranceCompany: string | null; claimStatus: string };
export type ReportEntry = { id: string; type: "income" | "expense"; amount: number; category: string | null; entryDate: string };
export type ReportSummary = {
  metrics: { openJobs: number; inspections: number; customers: number; revenue: number; expenses: number };
  jobsByStatus: Array<{ status: string; count: number }>;
  estimateTotals: { count: number; total: number };
  documentCount: number;
};

type Range = "30d" | "90d" | "12m" | "all";
const RANGES: Array<[Range, string]> = [["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"], ["all", "All time"]];
const PALETTE = ["#E96B2C", "#2E7D9A", "#2E9D6A", "#F2A516", "#7A5BC4", "#C24D6E", "#6B7F8E", "#9AA5AB"];

const money = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (value: number) => (Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${Math.round(value)}`);
const pct = (value: number) => `${Math.round(value * 100)}%`;
const label = (value: string) => value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const DAY = 86400000;

function rangeStart(range: Range): Date | null {
  const now = new Date();
  if (range === "30d") return new Date(now.getTime() - 30 * DAY);
  if (range === "90d") return new Date(now.getTime() - 90 * DAY);
  if (range === "12m") return new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return null;
}

function monthKeys(count = 12) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: date.toLocaleDateString("en-US", { month: "short" }) + (date.getMonth() === 0 ? ` ${date.getFullYear()}` : "") };
  });
}

function downloadCsv(fileName: string, rows: Array<Array<string | number>>) {
  const escape = (cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`;
  const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------- Charts (inline SVG, no external library) ----------

function GroupedBars({ labels, series }: { labels: string[]; series: Array<{ name: string; color: string; values: number[] }> }) {
  const width = 640;
  const height = 240;
  const padLeft = 48;
  const padBottom = 28;
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const plotWidth = width - padLeft - 8;
  const plotHeight = height - padBottom - 10;
  const groupWidth = plotWidth / labels.length;
  const barWidth = Math.max(4, Math.min(16, (groupWidth - 6) / series.length));
  return (
    <div className="rpt-chart">
      <div className="rpt-legend">{series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bar chart">
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = 10 + plotHeight * (1 - step);
          return <g key={step}><line x1={padLeft} x2={width - 8} y1={y} y2={y} className="rpt-grid" /><text x={padLeft - 6} y={y + 4} textAnchor="end" className="rpt-axis">{compact(max * step)}</text></g>;
        })}
        {labels.map((text, index) => {
          const groupX = padLeft + index * groupWidth + (groupWidth - barWidth * series.length) / 2;
          return <g key={text + index}>
            {series.map((item, seriesIndex) => {
              const value = item.values[index] || 0;
              const h = (value / max) * plotHeight;
              return <rect key={item.name} x={groupX + seriesIndex * barWidth} y={10 + plotHeight - h} width={barWidth - 2} height={Math.max(0, h)} rx={2} fill={item.color}><title>{`${text} · ${item.name}: ${money(value)}`}</title></rect>;
            })}
            <text x={padLeft + index * groupWidth + groupWidth / 2} y={height - 8} textAnchor="middle" className="rpt-axis">{text}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}

function LineChart({ labels, series }: { labels: string[]; series: Array<{ name: string; color: string; values: number[] }> }) {
  const width = 640;
  const height = 240;
  const padLeft = 48;
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const plotWidth = width - padLeft - 16;
  const plotHeight = height - 38;
  const x = (index: number) => padLeft + (labels.length === 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const y = (value: number) => 10 + plotHeight - (value / max) * plotHeight;
  return (
    <div className="rpt-chart">
      <div className="rpt-legend">{series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
        {[0, 0.5, 1].map((step) => <g key={step}><line x1={padLeft} x2={width - 16} y1={y(max * step)} y2={y(max * step)} className="rpt-grid" /><text x={padLeft - 6} y={y(max * step) + 4} textAnchor="end" className="rpt-axis">{compact(max * step)}</text></g>)}
        {series.map((item) => (
          <g key={item.name}>
            <polyline fill="none" stroke={item.color} strokeWidth={2.5} strokeLinejoin="round" points={item.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
            {item.values.map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r={3} fill={item.color}><title>{`${labels[index]} · ${item.name}: ${money(value)}`}</title></circle>)}
          </g>
        ))}
        {labels.map((text, index) => <text key={text + index} x={x(index)} y={height - 8} textAnchor="middle" className="rpt-axis">{text}</text>)}
      </svg>
    </div>
  );
}

function Donut({ slices }: { slices: Array<{ label: string; value: number; color: string }> }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  if (!total) return <p className="rpt-empty">No data for this period yet.</p>;
  return (
    <div className="rpt-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Donut chart">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#eef1f2" strokeWidth="18" />
        {slices.filter((slice) => slice.value > 0).map((slice) => {
          const length = (slice.value / total) * circumference;
          const element = <circle key={slice.label} cx="70" cy="70" r={radius} fill="none" stroke={slice.color} strokeWidth="18" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)"><title>{`${slice.label}: ${slice.value}`}</title></circle>;
          offset += length;
          return element;
        })}
        <text x="70" y="68" textAnchor="middle" className="rpt-donut-total">{total}</text>
        <text x="70" y="84" textAnchor="middle" className="rpt-donut-sub">total</text>
      </svg>
      <ul>
        {slices.filter((slice) => slice.value > 0).map((slice) => (
          <li key={slice.label}><i style={{ background: slice.color }} /><span>{slice.label}</span><strong>{slice.value}</strong><small>{pct(slice.value / total)}</small></li>
        ))}
      </ul>
    </div>
  );
}

function HBars({ items, format = (value: number) => String(value), empty = "No data yet." }: { items: Array<{ label: string; value: number; sub?: string; color?: string }>; format?: (value: number) => string; empty?: string }) {
  if (!items.length) return <p className="rpt-empty">{empty}</p>;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="rpt-hbars">
      {items.map((item, index) => (
        <li key={item.label + index}>
          <div><span>{item.label}</span><strong>{format(item.value)}</strong></div>
          <div className="rpt-bar-track"><i style={{ width: `${(item.value / max) * 100}%`, background: item.color || PALETTE[index % PALETTE.length] }} /></div>
          {item.sub && <small>{item.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

// ---------- Report ----------

export function ReportsDashboard({ summary, invoices, jobs, claims, entries, onNavigate }: {
  summary: ReportSummary | null;
  invoices: Invoice[];
  jobs: ReportJob[];
  claims: ReportClaim[];
  entries: ReportEntry[];
  onNavigate: (view: "Invoices" | "Jobs" | "Claims" | "Bookkeeping") => void;
}) {
  const [range, setRange] = React.useState<Range>("12m");
  const start = rangeStart(range);
  const inRange = (value: string | null | undefined) => {
    if (!value) return false;
    if (!start) return true;
    return new Date(value) >= start;
  };

  const invoicesInRange = invoices.filter((invoice) => inRange(invoice.issueDate));
  const entriesInRange = entries.filter((entry) => inRange(entry.entryDate));
  const billed = invoicesInRange.reduce((sum, invoice) => sum + invoice.total, 0);
  const collected = invoicesInRange.reduce((sum, invoice) => sum + invoice.amountPaid, 0);
  const outstanding = invoicesInRange.reduce((sum, invoice) => sum + invoice.balanceDue, 0);
  const expenses = entriesInRange.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const collectionRate = billed ? collected / billed : 0;
  const averageInvoice = invoicesInRange.length ? billed / invoicesInRange.length : 0;

  // Last 12 months, always shown for trends
  const months = monthKeys(12);
  const billedByMonth = new Map<string, number>();
  const collectedByMonth = new Map<string, number>();
  const expensesByMonth = new Map<string, number>();
  for (const invoice of invoices) {
    const key = invoice.issueDate.slice(0, 7);
    billedByMonth.set(key, (billedByMonth.get(key) || 0) + invoice.total);
    for (const payment of invoice.payments || []) {
      const paidKey = payment.date.slice(0, 7);
      collectedByMonth.set(paidKey, (collectedByMonth.get(paidKey) || 0) + payment.amount);
    }
  }
  for (const entry of entries) {
    if (entry.type !== "expense") continue;
    const key = entry.entryDate.slice(0, 7);
    expensesByMonth.set(key, (expensesByMonth.get(key) || 0) + entry.amount);
  }
  const monthBilled = months.map((month) => billedByMonth.get(month.key) || 0);
  const monthCollected = months.map((month) => collectedByMonth.get(month.key) || 0);
  const monthExpenses = months.map((month) => expensesByMonth.get(month.key) || 0);

  // Receivables aging (all open invoices)
  const now = Date.now();
  const aging = [
    { label: "Not yet due", value: 0, color: "#2E9D6A" },
    { label: "1–30 days late", value: 0, color: "#F2A516" },
    { label: "31–60 days late", value: 0, color: "#E96B2C" },
    { label: "61–90 days late", value: 0, color: "#C24D6E" },
    { label: "Over 90 days", value: 0, color: "#7A2E4A" },
  ];
  for (const invoice of invoices) {
    if (invoice.balanceDue <= 0) continue;
    const daysLate = invoice.dueDate ? Math.floor((now - new Date(invoice.dueDate).getTime()) / DAY) : 0;
    const bucket = daysLate <= 0 ? 0 : daysLate <= 30 ? 1 : daysLate <= 60 ? 2 : daysLate <= 90 ? 3 : 4;
    aging[bucket].value += invoice.balanceDue;
  }
  const overdue = aging.slice(1).reduce((sum, bucket) => sum + bucket.value, 0);

  // Top customers by billing in range
  const byCustomer = new Map<string, { name: string; count: number; billed: number; paid: number }>();
  for (const invoice of invoicesInRange) {
    const name = invoice.customer ? `${invoice.customer.firstName} ${invoice.customer.lastName}` : invoice.walkInCustomerName || "Walk-in / counter";
    const row = byCustomer.get(name) || { name, count: 0, billed: 0, paid: 0 };
    row.count += 1;
    row.billed += invoice.total;
    row.paid += invoice.amountPaid;
    byCustomer.set(name, row);
  }
  const topCustomers = [...byCustomer.values()].sort((a, b) => b.billed - a.billed).slice(0, 8);

  // Expense categories in range
  const byCategory = new Map<string, number>();
  for (const entry of entriesInRange) {
    if (entry.type !== "expense") continue;
    const name = entry.category || "Uncategorized";
    byCategory.set(name, (byCategory.get(name) || 0) + entry.amount);
  }
  const expenseSlices = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, value], index) => ({ label: name, value: Math.round(value), color: PALETTE[index] }));

  // Claims
  const byInsurer = new Map<string, number>();
  for (const claim of claims) {
    const name = claim.insuranceCompany || "Not specified";
    byInsurer.set(name, (byInsurer.get(name) || 0) + 1);
  }
  const insurerItems = [...byInsurer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  const byClaimStatus = new Map<string, number>();
  for (const claim of claims) byClaimStatus.set(claim.claimStatus, (byClaimStatus.get(claim.claimStatus) || 0) + 1);
  const claimStatusItems = [...byClaimStatus.entries()].map(([status, value]) => ({ label: label(status), value }));

  // Jobs: completed or ready but never invoiced
  const invoicedJobIds = new Set(invoices.map((invoice) => invoice.jobId).filter(Boolean));
  const uninvoiced = jobs.filter((job) => ["ready", "completed"].includes(job.status) && !invoicedJobIds.has(job.id));
  const stageSlices = (summary?.jobsByStatus || []).map((entry, index) => ({ label: label(entry.status), value: entry.count, color: PALETTE[index % PALETTE.length] }));

  // Review: findings generated from the numbers above
  const findings: Array<{ tone: "good" | "warn" | "info"; text: string; action?: { label: string; view: "Invoices" | "Jobs" | "Claims" | "Bookkeeping" } }> = [];
  if (billed > 0) {
    findings.push({ tone: collectionRate >= 0.8 ? "good" : "warn", text: `${pct(collectionRate)} of billed work has been collected in this period (${money(collected)} of ${money(billed)}).` });
  }
  if (outstanding > 0) {
    findings.push({ tone: overdue > 0 ? "warn" : "info", text: `${money(outstanding)} is still owed across open invoices${overdue > 0 ? `, and ${money(overdue)} of it is past due.` : "."}`, action: { label: "Review invoices", view: "Invoices" } });
  }
  if (uninvoiced.length) {
    findings.push({ tone: "warn", text: `${uninvoiced.length} completed or ready ${uninvoiced.length === 1 ? "job has" : "jobs have"} no invoice yet: ${uninvoiced.slice(0, 3).map((job) => job.jobNumber).join(", ")}${uninvoiced.length > 3 ? "…" : ""}.`, action: { label: "Open jobs", view: "Jobs" } });
  }
  if (expenses > 0 && billed > 0) {
    const topExpense = expenseSlices[0];
    findings.push({ tone: expenses > billed ? "warn" : "good", text: `Expenses are ${pct(expenses / billed)} of billing in this period${topExpense ? `; the largest category is ${topExpense.label} (${money(topExpense.value)}).` : "."}`, action: { label: "Open bookkeeping", view: "Bookkeeping" } });
  }
  if (topCustomers.length) {
    const top = topCustomers[0];
    findings.push({ tone: "info", text: `${top.name} is the largest account this period at ${money(top.billed)} across ${top.count} ${top.count === 1 ? "invoice" : "invoices"}.` });
  }
  if (insurerItems.length) {
    findings.push({ tone: "info", text: `${insurerItems[0].label} accounts for the most claims (${insurerItems[0].value} of ${claims.length}).`, action: { label: "View claims", view: "Claims" } });
  }
  if (!findings.length) findings.push({ tone: "info", text: "Not enough activity yet to review. Findings appear once invoices, payments, or expenses are recorded." });

  const exportMonthly = () => downloadCsv("monthly-report.csv", [["Month", "Billed", "Collected", "Expenses", "Net cash"], ...months.map((month, index) => [month.label, monthBilled[index].toFixed(2), monthCollected[index].toFixed(2), monthExpenses[index].toFixed(2), (monthCollected[index] - monthExpenses[index]).toFixed(2)])]);
  const exportCustomers = () => downloadCsv("top-customers.csv", [["Customer", "Invoices", "Billed", "Collected"], ...topCustomers.map((row) => [row.name, row.count, row.billed.toFixed(2), row.paid.toFixed(2)])]);
  const exportAging = () => downloadCsv("receivables-aging.csv", [["Bucket", "Balance"], ...aging.map((bucket) => [bucket.label, bucket.value.toFixed(2)])]);

  return (
    <div className="rpt">
      <div className="rpt-toolbar">
        <div className="rpt-range" role="group" aria-label="Report period">
          {RANGES.map(([value, text]) => <button key={value} type="button" className={range === value ? "is-active" : ""} onClick={() => setRange(value)} aria-pressed={range === value}>{text}</button>)}
        </div>
        <button type="button" className="secondary-button" onClick={exportMonthly}>Export monthly CSV</button>
      </div>

      <section className="rpt-kpis">
        <Kpi label="Billed" value={money(billed)} note={`${invoicesInRange.length} invoices`} tone="orange" />
        <Kpi label="Collected" value={money(collected)} note={`${pct(collectionRate)} collection rate`} tone="green" />
        <Kpi label="Outstanding" value={money(outstanding)} note={overdue > 0 ? `${money(overdue)} past due` : "Nothing past due"} tone={overdue > 0 ? "red" : "blue"} />
        <Kpi label="Expenses" value={money(expenses)} note="From bookkeeping" tone="purple" />
        <Kpi label="Net cash" value={money(collected - expenses)} note="Collected less expenses" tone={collected - expenses >= 0 ? "green" : "red"} />
        <Kpi label="Avg invoice" value={money(averageInvoice)} note={`${summary?.metrics.openJobs ?? 0} open jobs`} tone="blue" />
      </section>

      <section className="rpt-card">
        <div className="rpt-card-head"><div><h3>Review</h3><p>Findings based on the numbers in this report</p></div></div>
        <ul className="rpt-findings">
          {findings.map((finding, index) => (
            <li key={index} className={`is-${finding.tone}`}>
              <span className="rpt-dot" aria-hidden="true" />
              <p>{finding.text}</p>
              {finding.action && <button type="button" className="text-button" onClick={() => onNavigate(finding.action!.view)}>{finding.action.label} →</button>}
            </li>
          ))}
        </ul>
      </section>

      <div className="rpt-grid-2">
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Billing vs expenses</h3><p>Last 12 months</p></div></div>
          <GroupedBars labels={months.map((month) => month.label)} series={[{ name: "Billed", color: "#E96B2C", values: monthBilled }, { name: "Expenses", color: "#2E7D9A", values: monthExpenses }]} />
        </section>
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Cash in vs cash out</h3><p>Payments received against expenses, last 12 months</p></div></div>
          <LineChart labels={months.map((month) => month.label)} series={[{ name: "Collected", color: "#2E9D6A", values: monthCollected }, { name: "Expenses", color: "#2E7D9A", values: monthExpenses }]} />
        </section>
      </div>

      <div className="rpt-grid-3">
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Jobs by stage</h3><p>Every repair order right now</p></div></div>
          <Donut slices={stageSlices} />
        </section>
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Expenses by category</h3><p>{RANGES.find(([value]) => value === range)?.[1]}</p></div></div>
          <Donut slices={expenseSlices} />
        </section>
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Receivables aging</h3><p>Open balances by days past due</p></div><button type="button" className="text-button" onClick={exportAging}>CSV</button></div>
          <HBars items={aging.map((bucket) => ({ label: bucket.label, value: bucket.value, color: bucket.color }))} format={compact} empty="No open balances." />
        </section>
      </div>

      <div className="rpt-grid-3">
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Claims by insurer</h3><p>{claims.length} claims on file</p></div></div>
          <HBars items={insurerItems} empty="No claims on file yet." />
        </section>
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Claims by status</h3><p>Where claims stand today</p></div></div>
          <HBars items={claimStatusItems} empty="No claims on file yet." />
        </section>
        <section className="rpt-card">
          <div className="rpt-card-head"><div><h3>Pipeline</h3><p>Estimates and paperwork</p></div></div>
          <dl className="rpt-stats">
            <div><dt>Estimates saved</dt><dd>{summary?.estimateTotals.count ?? 0}</dd></div>
            <div><dt>Estimate value</dt><dd>{money(summary?.estimateTotals.total ?? 0)}</dd></div>
            <div><dt>Scheduled inspections</dt><dd>{summary?.metrics.inspections ?? 0}</dd></div>
            <div><dt>Documents on file</dt><dd>{summary?.documentCount ?? 0}</dd></div>
          </dl>
        </section>
      </div>

      <section className="rpt-card">
        <div className="rpt-card-head"><div><h3>Top customers</h3><p>Ranked by billing in this period</p></div><button type="button" className="text-button" onClick={exportCustomers}>CSV</button></div>
        {topCustomers.length ? (
          <div className="rpt-table-wrap">
            <table className="rpt-table">
              <thead><tr><th>Customer</th><th className="num">Invoices</th><th className="num">Billed</th><th className="num">Collected</th><th>Share</th></tr></thead>
              <tbody>
                {topCustomers.map((row) => (
                  <tr key={row.name}>
                    <td data-label="Customer">{row.name}</td>
                    <td className="num" data-label="Invoices">{row.count}</td>
                    <td className="num" data-label="Billed">{money(row.billed)}</td>
                    <td className="num" data-label="Collected">{money(row.paid)}</td>
                    <td data-label="Share"><div className="rpt-bar-track"><i style={{ width: `${(row.billed / Math.max(billed, 1)) * 100}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rpt-empty">No invoices in this period yet.</p>}
      </section>

      <section className="rpt-card">
        <div className="rpt-card-head"><div><h3>Monthly summary</h3><p>Last 12 months</p></div><button type="button" className="text-button" onClick={exportMonthly}>CSV</button></div>
        <div className="rpt-table-wrap">
          <table className="rpt-table">
            <thead><tr><th>Month</th><th className="num">Billed</th><th className="num">Collected</th><th className="num">Expenses</th><th className="num">Net cash</th></tr></thead>
            <tbody>
              {months.map((month, index) => {
                const net = monthCollected[index] - monthExpenses[index];
                return (
                  <tr key={month.key}>
                    <td data-label="Month">{month.label}</td>
                    <td className="num" data-label="Billed">{money(monthBilled[index])}</td>
                    <td className="num" data-label="Collected">{money(monthCollected[index])}</td>
                    <td className="num" data-label="Expenses">{money(monthExpenses[index])}</td>
                    <td className={`num ${net < 0 ? "is-negative" : ""}`} data-label="Net cash">{money(net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label: text, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className={`rpt-kpi tone-${tone}`}>
      <span>{text}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
