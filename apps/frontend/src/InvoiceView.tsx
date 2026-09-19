import React from "react";
import { LineItemPresetPicker } from "./LineItemPresetPicker";
import type { CollisionPresetItem } from "./collisionLineItemPresets";

type Customer = { id: string; firstName: string; lastName: string; phone: string | null };
type Job = { id: string; jobNumber: string; claimId?: string | null; customer: Customer };
type Claim = { id: string; claimNumber: string | null; customer: Customer };
type LineItem = { id?: string; description: string; quantity: number | string; unitPrice: number | string };
type Payment = { id: string; method: string; amount: number; date: string; notes: string | null };
type InvoiceDocument = { id: string; fileName: string; documentType: string; description: string | null; createdAt: string };
export type Invoice = { id: string; invoiceNumber: string; customerId?: string; customer: Customer; jobId?: string | null; job?: { id: string; jobNumber: string } | null; claimId?: string | null; claim?: { id: string; claimNumber: string | null } | null; status: string; issueDate: string; dueDate: string | null; subtotal: number; tax: number; total: number; amountPaid: number; balanceDue: number; lineItems: LineItem[]; payments: Payment[]; documents?: InvoiceDocument[]; notes: string | null };
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
type FormLine = { description: string; quantity: string; unitPrice: string };
type PdfResult = { downloadUrl: string; fileName: string };
const methods = [["cash", "Cash"], ["debit_card", "Debit card"], ["credit_card", "Credit card"], ["check", "Check"], ["ach", "ACH"], ["other", "Other"]];
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No due date";
const freshLine = (): FormLine => ({ description: "", quantity: "1", unitPrice: "" });
let activeInvoicePdfDownload: (() => void) | null = null;
let activeInvoiceDelete: (() => void) | null = null;

export function InvoiceView({ invoices, customers, jobs, claims, request, apiUrl, onChanged }: { invoices: Invoice[]; customers: Customer[]; jobs: Job[]; claims: Claim[]; request: Request; apiUrl: string; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = React.useState<Invoice | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [paymentInvoice, setPaymentInvoice] = React.useState<Invoice | null>(null);
  const [query, setQuery] = React.useState("");
  const filtered = invoices.filter((invoice) => `${invoice.invoiceNumber} ${invoice.customer.firstName} ${invoice.customer.lastName} ${invoice.job?.jobNumber || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="invoice-workspace">
    <section className="invoice-toolbar"><div><p className="eyebrow">Receivables control</p><h2>Invoice register</h2><p className="subheading">Create repair invoices, record collections, and keep balances current.</p></div><div className="invoice-actions"><input aria-label="Search invoices" placeholder="Search invoice, customer, or RO" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="secondary-button" onClick={() => void onChanged()}>Refresh</button><button className="orange-button" onClick={() => setCreating(true)}>New invoice</button></div></section>
    <section className="metric-grid invoice-metrics"><Metric label="Open balance" value={money(invoices.reduce((sum, item) => sum + item.balanceDue, 0))} note="Across all invoices" tone="orange" /><Metric label="Collected" value={money(invoices.reduce((sum, item) => sum + item.amountPaid, 0))} note="Payments recorded" tone="green" /><Metric label="Invoices" value={String(invoices.length)} note="All statuses" tone="blue" /><Metric label="Needs follow-up" value={String(invoices.filter((item) => item.status === "overdue" || item.status === "partial").length)} note="Partial or overdue" tone="purple" /></section>
    <section className="surface"><div className="surface-heading"><div><h2>Invoices</h2><p>Every invoice and its current collection status</p></div></div>{filtered.length ? <div className="finance-table-wrap"><table className="data-table invoice-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Repair order</th><th>Issued</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead><tbody>{filtered.map((invoice) => <tr className="clickable-row" key={invoice.id} onClick={() => setSelected(invoice)}><td><strong className="mono">{invoice.invoiceNumber}</strong><small className="table-subtext">Due {date(invoice.dueDate)}</small></td><td>{invoice.customer.firstName} {invoice.customer.lastName}</td><td>{invoice.job?.jobNumber || "Unlinked"}<small className="table-subtext">{invoice.claim?.claimNumber ? `Claim ${invoice.claim.claimNumber}` : "No claim linked"}</small></td><td>{date(invoice.issueDate)}</td><td><strong>{money(invoice.total)}</strong></td><td className={invoice.balanceDue > 0 ? "finance-expense" : "finance-income"}>{money(invoice.balanceDue)}</td><td><span className={`status-pill ${invoice.status === "paid" ? "green" : invoice.status === "partial" || invoice.status === "overdue" ? "orange" : "blue"}`}>{invoice.status}</span></td></tr>)}</tbody></table></div> : <EmptyInvoice text={query ? "No invoices match this search." : "No invoices yet. Create one from an existing customer to start receivables."} action={!query ? () => setCreating(true) : undefined} />}</section>
    {(creating || selected || paymentInvoice) && <InvoiceModal invoice={paymentInvoice || selected} mode={creating ? "create" : paymentInvoice ? "payment" : "detail"} customers={customers} jobs={jobs} claims={claims} request={request} apiUrl={apiUrl} onClose={() => { setCreating(false); setSelected(null); setPaymentInvoice(null); }} onSaved={async () => { setCreating(false); setSelected(null); setPaymentInvoice(null); await onChanged(); }} onPayment={() => { if (selected) { setPaymentInvoice(selected); setSelected(null); } }} />}
  </div>;
}

function InvoiceModal({ invoice, mode, customers, jobs, claims, request, apiUrl, onClose, onSaved, onPayment }: { invoice: Invoice | null; mode: "create" | "detail" | "payment"; customers: Customer[]; jobs: Job[]; claims: Claim[]; request: Request; apiUrl: string; onClose: () => void; onSaved: () => Promise<void>; onPayment: () => void }) {
  const [customerId, setCustomerId] = React.useState(invoice?.customerId || invoice?.customer.id || "");
  const [jobId, setJobId] = React.useState(invoice?.jobId || "");
  const [claimId, setClaimId] = React.useState(invoice?.claimId || "");
  const [number, setNumber] = React.useState(invoice?.invoiceNumber || "");
  const [issueDate, setIssueDate] = React.useState(invoice?.issueDate?.slice(0, 10) || today());
  const [dueDate, setDueDate] = React.useState(invoice?.dueDate?.slice(0, 10) || today());
  const [taxRate, setTaxRate] = React.useState(invoice ? String(invoice.tax * 100 / Math.max(invoice.subtotal, 0.01)) : "0");
  const [lines, setLines] = React.useState<FormLine[]>(invoice?.lineItems.map((line) => ({ description: line.description, quantity: String(line.quantity), unitPrice: String(line.unitPrice) })) || [freshLine()]);
  const [payment, setPayment] = React.useState({ method: "cash", amount: "", date: today(), notes: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  async function downloadPdf() {
    if (!invoice) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<PdfResult>(`/invoices/${invoice.id}/pdf`, { method: "POST" });
      const response = await fetch(new URL(result.downloadUrl, apiUrl).toString(), { headers: { Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` } });
      if (!response.ok) throw new Error("Unable to download invoice PDF");
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (pdfError) { setError(pdfError instanceof Error ? pdfError.message : "Unable to download invoice PDF"); } finally { setBusy(false); }
  }
  React.useEffect(() => { activeInvoicePdfDownload = () => void downloadPdf(); activeInvoiceDelete = () => void deleteInvoice(); return () => { activeInvoicePdfDownload = null; activeInvoiceDelete = null; }; }, [invoice?.id]);
  const availableJobs = jobs.filter((job) => job.customer.id === customerId);
  const availableClaims = claims.filter((claim) => claim.customer.id === customerId);
  const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
  const tax = subtotal * Number(taxRate || 0) / 100;
  const total = subtotal + tax;
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await request(mode === "create" ? "/invoices" : `/invoices/${invoice?.id}`, { method: mode === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, jobId: jobId || undefined, claimId: claimId || undefined, invoiceNumber: number || undefined, issueDate, dueDate: dueDate || undefined, taxRate: Number(taxRate || 0), lineItems: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) })) }) }); await onSaved(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save invoice"); } finally { setBusy(false); } }
  async function recordPayment(event: React.FormEvent) { event.preventDefault(); if (!invoice) return; setBusy(true); setError(""); try { await request(`/invoices/${invoice.id}/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payment, amount: Number(payment.amount) }) }); await onSaved(); } catch (paymentError) { setError(paymentError instanceof Error ? paymentError.message : "Unable to record payment"); } finally { setBusy(false); } }
  async function deleteInvoice() { if (!invoice || !window.confirm(`Delete invoice ${invoice.invoiceNumber}? This cannot be undone.`)) return; setBusy(true); setError(""); try { await request(`/invoices/${invoice.id}`, { method: "DELETE" }); await onSaved(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete invoice"); } finally { setBusy(false); } }
  function updateLine(index: number, key: keyof FormLine, value: string) { setLines(lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line)); }
  function addPresetLines(items: CollisionPresetItem[]) {
    const presetLines: FormLine[] = items.map((item) => ({ description: item.description, quantity: "1", unitPrice: item.unitPrice ? String(item.unitPrice) : "" }));
    const onlyBlankLine = lines.length === 1 && !lines[0].description && !lines[0].unitPrice;
    setLines(onlyBlankLine ? presetLines : [...lines, ...presetLines]);
  }
  return <div className="modal-backdrop" onClick={onClose}><form className="modal invoice-modal" onSubmit={mode === "payment" ? recordPayment : mode === "detail" ? (event) => { event.preventDefault(); onClose(); } : save} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">{mode === "create" ? "Receivable setup" : "Invoice record"}</p><h2>{mode === "create" ? "Create invoice" : invoice?.invoiceNumber || "Invoice"}</h2></div><button type="button" className="close-button" onClick={onClose}><span aria-hidden="true">×</span></button></div>{error && <div className="error-banner">{error}</div>}{mode === "detail" && invoice ? <InvoiceDetail invoice={invoice} onPayment={onPayment} request={request} apiUrl={apiUrl} /> : mode === "payment" && invoice ? <PaymentForm payment={payment} setPayment={setPayment} balance={invoice.balanceDue} /> : <><div className="invoice-form-grid"><label>Existing customer<select required value={customerId} onChange={(event) => { setCustomerId(event.target.value); setJobId(""); setClaimId(""); }}><option value="">Select customer</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.firstName} {customer.lastName}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}</select></label><label>Invoice number<input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Auto-generated if blank" /></label><label>Issue date<input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label><label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><label>Linked job<select value={jobId} onChange={(event) => { setJobId(event.target.value); const job = availableJobs.find((item) => item.id === event.target.value); if (job?.claimId) setClaimId(job.claimId); }} disabled={!customerId}><option value="">No linked job</option>{availableJobs.map((job) => <option value={job.id} key={job.id}>{job.jobNumber}</option>)}</select></label><label>Linked claim<select value={claimId} onChange={(event) => setClaimId(event.target.value)} disabled={!customerId}><option value="">No linked claim</option>{availableClaims.map((claim) => <option value={claim.id} key={claim.id}>{claim.claimNumber || "Unnumbered claim"}</option>)}</select></label><label>Tax rate (%)<input min="0" step="0.01" type="number" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></label></div><div className="invoice-lines"><div className="records-section-heading"><h4>Line items</h4><div className="estimate-actions"><button type="button" className="text-button" onClick={() => setPresetsOpen(true)}>Select from library</button><button type="button" className="text-button" onClick={() => setLines([...lines, freshLine()])}>Add line +</button></div></div><LineItemPresetPicker open={presetsOpen} onClose={() => setPresetsOpen(false)} onAdd={addPresetLines} />{lines.map((line, index) => <div className="invoice-line" key={index}><input required placeholder="Description" value={line.description} onChange={(event) => updateLine(index, "description", event.target.value)} /><input required min="0.01" step="0.01" type="number" placeholder="Qty" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /><input required min="0" step="0.01" type="number" placeholder="Unit price" value={line.unitPrice} onChange={(event) => updateLine(index, "unitPrice", event.target.value)} /><strong>{money(Number(line.quantity || 0) * Number(line.unitPrice || 0))}</strong>{lines.length > 1 && <button type="button" className="remove-line" onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))}>×</button>}</div>)}</div><div className="invoice-totals"><span>Subtotal <b>{money(subtotal)}</b></span><span>Tax <b>{money(tax)}</b></span><strong>Total <b>{money(total)}</b></strong></div></>}{mode === "detail" && invoice && <p className="bookkeeping-note">Payments recorded here automatically populate Bookkeeping as income.</p>}<button className="orange-button submit-button" disabled={busy}>{busy ? "Saving..." : mode === "payment" ? "Record payment" : mode === "create" ? "Create invoice" : "Close"}</button></form></div>;
}

function InvoiceDetail({ invoice, onPayment, request, apiUrl }: { invoice: Invoice; onPayment: () => void; request: Request; apiUrl: string }) { return <><div className="invoice-detail-grid"><div><span>Customer</span><strong>{invoice.customer.firstName} {invoice.customer.lastName}</strong></div><div><span>Status</span><strong className={`status-pill ${invoice.status === "paid" ? "green" : "orange"}`}>{invoice.status}</strong></div><div><span>Issue date</span><strong>{date(invoice.issueDate)}</strong></div><div><span>Due date</span><strong>{date(invoice.dueDate)}</strong></div><div><span>Total</span><strong>{money(invoice.total)}</strong></div><div><span>Balance</span><strong className={invoice.balanceDue ? "finance-expense" : "finance-income"}>{money(invoice.balanceDue)}</strong></div></div><div className="records-section"><div className="records-section-heading"><h4>Payments</h4><div className="invoice-actions"><button type="button" className="secondary-button" onClick={() => activeInvoicePdfDownload?.()}>Download invoice PDF</button><button type="button" className="orange-button" onClick={onPayment}>Record payment</button><button type="button" className="danger-button" onClick={() => activeInvoiceDelete?.()}>Delete invoice</button></div></div>{invoice.payments.length ? invoice.payments.map((payment) => <div className="record-summary" key={payment.id}><strong>{money(payment.amount)} · {payment.method.replace("_", " ")}</strong><small>{date(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small></div>) : <p className="records-muted">No payments recorded yet.</p>}</div><InvoiceReceipts invoiceId={invoice.id} initialDocuments={invoice.documents || []} request={request} apiUrl={apiUrl} /></>; }

function InvoiceReceipts({ invoiceId, initialDocuments, request, apiUrl }: { invoiceId: string; initialDocuments: InvoiceDocument[]; request: Request; apiUrl: string }) {
  const [documents, setDocuments] = React.useState<InvoiceDocument[]>(initialDocuments);
  const [file, setFile] = React.useState<File | null>(null);
  const [description, setDescription] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => { setDocuments(initialDocuments); }, [invoiceId]);
  async function uploadReceipt(event: React.FormEvent) {
    event.preventDefault();
    if (!file) { setError("Choose a receipt file first."); return; }
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("documentType", "receipt");
      if (description) body.append("description", description);
      const result = await request<{ documents: InvoiceDocument[] }>(`/invoices/${invoiceId}/documents`, { method: "POST", body });
      setDocuments([...result.documents, ...documents]);
      setFile(null);
      setDescription("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to attach receipt");
    } finally {
      setUploading(false);
    }
  }
  async function downloadReceipt(receipt: InvoiceDocument) {
    try {
      const response = await fetch(new URL(`/invoices/${invoiceId}/documents/${receipt.id}/download`, apiUrl).toString(), { headers: { Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` } });
      if (!response.ok) throw new Error("Unable to download receipt");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = receipt.fileName;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download receipt");
    }
  }
  async function deleteReceipt(documentId: string) {
    if (!window.confirm("Remove this receipt? This cannot be undone.")) return;
    setError("");
    try {
      await request(`/invoices/${invoiceId}/documents/${documentId}`, { method: "DELETE" });
      setDocuments(documents.filter((item) => item.id !== documentId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to remove receipt");
    }
  }
  return <div className="records-section">
    <div className="records-section-heading"><h4>Receipts</h4></div>
    {error && <div className="error-banner">{error}</div>}
    <form className="receipt-upload-form" onSubmit={uploadReceipt}>
      <input type="file" accept="image/*,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      <input placeholder="Description (optional)" value={description} onChange={(event) => setDescription(event.target.value)} />
      <button type="submit" className="orange-button" disabled={uploading}>{uploading ? "Attaching..." : "Attach receipt"}</button>
    </form>
    {documents.length ? documents.map((receipt) => <div className="record-summary" key={receipt.id}><strong>{receipt.fileName}</strong><small>{receipt.description ? `${receipt.description} · ` : ""}{new Date(receipt.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small><div className="invoice-actions"><button type="button" className="secondary-button" onClick={() => void downloadReceipt(receipt)}>Download</button><button type="button" className="danger-button" onClick={() => void deleteReceipt(receipt.id)}>Remove</button></div></div>) : <p className="records-muted">No receipts attached yet.</p>}
  </div>;
}
function PaymentForm({ payment, setPayment, balance }: { payment: { method: string; amount: string; date: string; notes: string }; setPayment: React.Dispatch<React.SetStateAction<{ method: string; amount: string; date: string; notes: string }>>; balance: number }) { return <div className="invoice-form-grid"><label>Amount<input required max={balance} min="0.01" step="0.01" type="number" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></label><label>Method<select value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })}>{methods.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Date<input required type="date" value={payment.date} onChange={(event) => setPayment({ ...payment, date: event.target.value })} /></label><label>Notes<input value={payment.notes} onChange={(event) => setPayment({ ...payment, notes: event.target.value })} placeholder="Optional note" /></label><p className="records-muted">Remaining balance: <strong>{money(balance)}</strong></p></div>; }
function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><span>$</span></div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }
function EmptyInvoice({ text, action }: { text: string; action?: () => void }) { return <div className="empty-state">{text}{action && <button className="orange-button claim-empty-action" onClick={action}>Create invoice</button>}</div>; }