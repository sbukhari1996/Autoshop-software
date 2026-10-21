// Live, paper-style preview of an invoice. Mirrors the printed PDF layout so what you see here is what prints.

export type InvoicePreviewData = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  billTo: { name: string; address?: string | null; phone?: string | null; email?: string | null };
  vehicle: string;
  vin?: string;
  plate?: string;
  lines: { description: string; quantity: number; unitPrice: number }[];
  taxRate: number;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid?: number;
};

const money = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (value: string) => {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString("en-US");
};

export function InvoicePreview({ data }: { data: InvoicePreviewData }) {
  const balance = Math.max(0, data.total - (data.amountPaid || 0));
  const billLines = [data.billTo.address, data.billTo.phone, data.billTo.email].filter(Boolean) as string[];
  const vehicleLines = [data.vehicle, data.vin && `VIN ${data.vin}`, data.plate && `Plate ${data.plate}`].filter(Boolean) as string[];
  return (
    <article className="inv-paper inv-print-target" aria-label="Invoice preview">
      <div className="inv-paper-band" />
      <header className="inv-paper-head">
        <div className="inv-brand">
          <strong>MASTERCRAFT AUTO REPAIR &amp; COLLISION</strong>
          <small>38-21 23rd Street, Long Island City, NY 11101</small>
          <small>718-603-0412 · 718-578-4563 · shop@mastercraftautony.com</small>
        </div>
        <div className="inv-title">
          <h3>INVOICE</h3>
          <dl>
            <dt>Invoice no.</dt><dd>{data.invoiceNumber || "Auto-generated"}</dd>
            <dt>Issue date</dt><dd>{shortDate(data.issueDate) || "—"}</dd>
            <dt>Due date</dt><dd>{shortDate(data.dueDate) || "—"}</dd>
          </dl>
        </div>
      </header>

      <div className="inv-billing">
        <div>
          <span className="inv-caps">Bill to</span>
          <strong>{data.billTo.name || "Customer name"}</strong>
          {billLines.map((line) => <small key={line}>{line}</small>)}
        </div>
        <div>
          <span className="inv-caps">Vehicle</span>
          {vehicleLines.length ? vehicleLines.map((line) => <strong key={line}>{line}</strong>) : <small>No vehicle details</small>}
        </div>
      </div>

      <table className="inv-table">
        <thead>
          <tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {data.lines.length ? data.lines.map((line, index) => (
            <tr key={index}>
              <td>{line.description || <span className="inv-placeholder">Untitled line item</span>}</td>
              <td className="num">{line.quantity || 0}</td>
              <td className="num">{money(line.unitPrice || 0)}</td>
              <td className="num">{money((line.quantity || 0) * (line.unitPrice || 0))}</td>
            </tr>
          )) : <tr><td colSpan={4} className="inv-placeholder">Add a line item to see it here</td></tr>}
        </tbody>
      </table>

      <div className="inv-totals">
        <div><span>Subtotal</span><b>{money(data.subtotal)}</b></div>
        <div><span>Sales tax ({data.taxRate || 0}%)</span><b>{money(data.tax)}</b></div>
        <div className="inv-grand"><span>Total cost of repairs</span><b>{money(data.total)}</b></div>
        {data.amountPaid !== undefined && <>
          <div><span>Amount paid</span><b>{money(data.amountPaid)}</b></div>
          <div className="inv-balance"><span>Balance due</span><b>{money(balance)}</b></div>
        </>}
      </div>

      <footer className="inv-foot">Thank you for choosing Mastercraft Auto Repair &amp; Collision.</footer>
    </article>
  );
}
