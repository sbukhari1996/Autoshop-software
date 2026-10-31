import React from "react";
import "./RentalsView.css";

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
type RentalCar = { id: string; name: string; vin: string | null; licensePlate: string | null; licenseState: string | null; year: number | null; make: string | null; model: string | null; color: string | null; dailyRate: number; status: string; notes: string | null };
type Agreement = {
  id: string; agreementNumber: string; rentalCarId: string; claimId: string | null; customerId: string | null; invoiceId: string | null; status: string;
  customerName: string; customerPhone: string | null; customerEmail: string | null; customerAddress: string | null;
  insuranceCompany: string | null; claimNumber: string | null; adjusterName: string | null; adjusterPhone: string | null; adjusterEmail: string | null;
  startDate: string; endDate: string; days: number; dailyRate: number; subtotal: number; taxRate: number; tax: number; total: number;
  mileageOut: number | null; mileageIn: number | null; fuelOut: string | null; fuelIn: string | null; conditionOut: string | null; conditionIn: string | null; damageNotes: string | null; notes: string | null;
  createdAt: string; rentalCar: RentalCar;
};
// The parts of a claim and customer this screen reads. Names match the claims and customers the app already loads.
type ClaimLike = { id: string; claimNumber: string | null; insuranceCompany: string | null; adjusterName?: string | null; adjusterPhone?: string | null; adjusterEmail?: string | null; customerId?: string; customer: { id: string; firstName: string; lastName: string; phone: string | null; email?: string | null; address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null } };

const AGREEMENT_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "rental-status-draft" },
  sent: { label: "Sent for signing", className: "rental-status-sent" },
  signed: { label: "Signed", className: "rental-status-signed" },
  returned: { label: "Returned", className: "rental-status-returned" },
};
const CAR_STATUS: Record<string, string> = { available: "Available", in_repair: "In repair", out_of_service: "Out of service" };
const FUEL = ["Full", "3/4", "1/2", "1/4"];
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dateText = (value: string) => new Date(value).toLocaleDateString("en-US");
const JSON_HEADERS = { "Content-Type": "application/json" };
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const dayCount = (start: string, end: string) => (start && end ? Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000)) : 0);

export function RentalsView({ claims, request }: { claims: ClaimLike[]; request: Request }) {
  const [cars, setCars] = React.useState<RentalCar[]>([]);
  const [agreements, setAgreements] = React.useState<Agreement[]>([]);
  const [editing, setEditing] = React.useState<Agreement | "new" | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const [carRows, agreementRows] = await Promise.all([request<RentalCar[]>("/rental-cars"), request<Agreement[]>("/rental-agreements")]);
      setCars(carRows);
      setAgreements(agreementRows);
      setError("");
    } catch (loadError) {
      setError(errorText(loadError, "Unable to load rentals"));
    }
  }, [request]);

  React.useEffect(() => { void load(); }, [load]);

  if (editing) {
    return (
      <AgreementForm
        existing={editing === "new" ? null : editing}
        cars={cars}
        claims={claims}
        request={request}
        onDone={async (message) => { setEditing(null); setNotice(message); await load(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <section className="rental-workspace">
      {error && <div className="sr-banner sr-warn" role="alert">{error}</div>}
      {notice && <div className="sr-banner sr-ok" role="status">{notice}</div>}
      <FleetPanel cars={cars} request={request} onChanged={load} onError={setError} />
      <section className="surface rental-log">
        <div className="rental-heading">
          <div>
            <p className="eyebrow">Rental log</p>
            <h2>Rental agreements</h2>
          </div>
          <button type="button" className="orange-button" disabled={!cars.length} onClick={() => setEditing("new")}>New rental agreement</button>
        </div>
        <RentalLog agreements={agreements} onOpen={setEditing} />
      </section>
    </section>
  );
}

function FleetPanel({ cars, request, onChanged, onError }: { cars: RentalCar[]; request: Request; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", licensePlate: "", licenseState: "", vin: "", year: "", make: "", model: "", color: "", dailyRate: "" });

  async function addCar(event: React.FormEvent) {
    event.preventDefault();
    try {
      await request("/rental-cars", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(form) });
      setForm({ name: "", licensePlate: "", licenseState: "", vin: "", year: "", make: "", model: "", color: "", dailyRate: "" });
      setAdding(false);
      await onChanged();
    } catch (addError) {
      onError(errorText(addError, "Unable to add the car"));
    }
  }

  async function updateCar(car: RentalCar, change: Partial<RentalCar>) {
    try {
      await request(`/rental-cars/${car.id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(change) });
      await onChanged();
    } catch (updateError) {
      onError(errorText(updateError, "Unable to update the car"));
    }
  }

  return (
    <section className="surface rental-fleet">
      <div className="rental-heading">
        <div>
          <p className="eyebrow">Fleet</p>
          <h2>Rental cars</h2>
        </div>
        <button type="button" className="secondary-button" onClick={() => setAdding((value) => !value)}>{adding ? "Close" : "Add car"}</button>
      </div>
      {adding && (
        <form className="rental-car-form" onSubmit={addCar}>
          {(["name", "licensePlate", "licenseState", "vin", "year", "make", "model", "color", "dailyRate"] as const).map((key) => (
            <label key={key}>
              {({ name: "Car name or number", licensePlate: "License plate", licenseState: "Plate state", vin: "VIN", year: "Year", make: "Make", model: "Model", color: "Color", dailyRate: "Daily rate ($)" } as const)[key]}
              <input
                required={key === "name"}
                inputMode={key === "dailyRate" || key === "year" ? "decimal" : undefined}
                value={form[key]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            </label>
          ))}
          <button className="orange-button">Save car</button>
        </form>
      )}
      {cars.length ? (
        <div className="rental-car-list">
          {cars.map((car) => (
            <div className="rental-car" key={car.id}>
              <div>
                <strong>{car.name}</strong>
                <small>{[car.year, car.make, car.model, car.color].filter(Boolean).join(" ") || "Details not set"}{car.licensePlate ? ` · ${car.licensePlate}` : ""}</small>
              </div>
              <label>
                Status
                <select value={car.status} onChange={(event) => void updateCar(car, { status: event.target.value })}>
                  {Object.entries(CAR_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Default rate ($/day)
                <input
                  key={car.dailyRate}
                  defaultValue={car.dailyRate}
                  inputMode="decimal"
                  onBlur={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 0 && next !== car.dailyRate) void updateCar(car, { dailyRate: next });
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      ) : (
        <p className="records-muted">No cars yet. Add the cars you rent out.</p>
      )}
    </section>
  );
}

function RentalLog({ agreements, onOpen }: { agreements: Agreement[]; onOpen: (agreement: Agreement) => void }) {
  const [claimFilter, setClaimFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const shown = agreements.filter((item) => (!claimFilter || item.claimId === claimFilter) && (!statusFilter || item.status === statusFilter));
  const claimIds = Array.from(new Set(agreements.map((item) => item.claimId).filter(Boolean))) as string[];

  return (
    <>
      <div className="rental-filters">
        <label>
          Claim
          <select value={claimFilter} onChange={(event) => setClaimFilter(event.target.value)}>
            <option value="">All claims</option>
            {claimIds.map((id) => <option key={id} value={id}>{agreements.find((item) => item.claimId === id)?.claimNumber || "Unnumbered claim"}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(AGREEMENT_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
          </select>
        </label>
      </div>
      {shown.length ? (
        <table className="data-table">
          <thead>
            <tr><th>Agreement</th><th>Customer</th><th>Car</th><th>Dates</th><th>Total</th><th>Status</th><th>Invoice</th></tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.id} className="clickable-row" onClick={() => onOpen(item)}>
                <td data-label="Agreement"><strong className="mono">{item.agreementNumber}</strong></td>
                <td data-label="Customer">{item.customerName}<small className="table-subtext">{item.insuranceCompany || "Customer pays"}</small></td>
                <td data-label="Car">{item.rentalCar.name}</td>
                <td data-label="Dates">{dateText(item.startDate)} – {dateText(item.endDate)}<small className="table-subtext">{item.days} day{item.days === 1 ? "" : "s"}</small></td>
                <td data-label="Total">{money(item.total)}</td>
                <td data-label="Status"><span className={`status-pill ${AGREEMENT_STATUS[item.status]?.className ?? ""}`}>{AGREEMENT_STATUS[item.status]?.label ?? item.status}</span></td>
                <td data-label="Invoice">{item.invoiceId ? "Created" : "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="records-muted">No rental agreements match these filters.</p>
      )}
    </>
  );
}

const escapeHtml = (value: string | number | null | undefined) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));

// Printable rental agreement in a new tab. Print dialog > Save as PDF gives the download.
// shortcut: terms are a draft list, replace with the shop's final wording.
function openAgreement(a: Agreement) {
  const row = (label: string, value: string | number | null | undefined) => `<tr><th>${label}</th><td>${escapeHtml(value || "-")}</td></tr>`;
  const car = a.rentalCar;
  const carLine = [car.name, [car.year, car.make, car.model, car.color].filter(Boolean).join(" "), [car.licensePlate, car.licenseState].filter(Boolean).join(" "), car.vin ? "VIN " + car.vin : ""].filter(Boolean).join(" · ");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(a.agreementNumber)} Rental Agreement</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px;line-height:1.45}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
table{width:100%;border-collapse:collapse}th{text-align:left;width:34%;font-weight:600;padding:3px 8px 3px 0;vertical-align:top}td{padding:3px 0;vertical-align:top}
.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px}
.cols{display:flex;gap:24px}.cols>div{flex:1}
.sign{display:flex;gap:32px;margin-top:40px}.sign div{flex:1;border-top:1px solid #111;padding-top:4px}
.bar{margin-bottom:12px}button{padding:8px 16px;font-size:14px}
@media print{.bar{display:none}body{margin:16px}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="head"><div><h1>Mastercraft Auto Repair &amp; Collision</h1><div>Rental Agreement</div></div><div style="text-align:right"><strong>${escapeHtml(a.agreementNumber)}</strong><br>Status: ${escapeHtml(AGREEMENT_STATUS[a.status]?.label ?? a.status)}</div></div>
<div class="cols" style="margin-top:8px">
<div><h2>Renter</h2><table>${row("Name", a.customerName)}${row("Phone", a.customerPhone)}${row("Email", a.customerEmail)}${row("Address", a.customerAddress)}</table></div>
<div><h2>Claim and insurer</h2><table>${row("Claim number", a.claimNumber)}${row("Insurance company", a.insuranceCompany)}${row("Adjuster", a.adjusterName)}${row("Adjuster phone", a.adjusterPhone)}${row("Adjuster email", a.adjusterEmail)}</table></div>
</div>
<h2>Vehicle and rental period</h2>
<table>${row("Vehicle", carLine)}${row("Pick-up date", dateText(a.startDate))}${row("Return date", dateText(a.endDate))}${row("Days", a.days)}
${row("Mileage out / in", `${a.mileageOut ?? "-"} / ${a.mileageIn ?? "-"}`)}${row("Fuel out / in", `${a.fuelOut ?? "-"} / ${a.fuelIn ?? "-"}`)}${row("Condition out / in", `${a.conditionOut ?? "-"} / ${a.conditionIn ?? "-"}`)}${row("Damage notes", a.damageNotes)}</table>
<h2>Charges</h2>
<table>${row("Daily rate", money(a.dailyRate))}${row("Subtotal", `${money(a.subtotal)} (${a.days} days)`)}${row(`Tax (${a.taxRate}% on whole total)`, money(a.tax))}${row("Total", money(a.total))}</table>
<h2>Terms</h2>
<ol>
<li>The renter must be at least 26 years old.</li>
<li>Smoking in the vehicle carries a $125 fee.</li>
<li>A $20 fuel charge applies per quarter tank needed when the vehicle is returned.</li>
<li>The renter is responsible for lost keys.</li>
<li>[Additional Mastercraft terms to be added.]</li>
</ol>
<h2>Renter consent</h2>
<p>&#9744; I have read and agree to these terms. &nbsp; &#9744; I authorize Mastercraft to charge the rental amounts shown above.</p>
<div class="sign"><div>Renter signature</div><div>Date</div><div>Mastercraft representative</div></div>
</body></html>`;
  const win = window.open("", "_blank");
  if (!win) return; // pop-up blocked
  win.document.write(html);
  win.document.close();
}

function AgreementForm({
  existing,
  cars,
  claims,
  request,
  onDone,
  onCancel,
}: {
  existing: Agreement | null;
  cars: RentalCar[];
  claims: ClaimLike[];
  request: Request;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const base = existing;
  const [claimId, setClaimId] = React.useState(base?.claimId ?? "");
  const [form, setForm] = React.useState({
    rentalCarId: base?.rentalCarId ?? "",
    customerName: base?.customerName ?? "",
    customerPhone: base?.customerPhone ?? "",
    customerEmail: base?.customerEmail ?? "",
    customerAddress: base?.customerAddress ?? "",
    insuranceCompany: base?.insuranceCompany ?? "",
    claimNumber: base?.claimNumber ?? "",
    adjusterName: base?.adjusterName ?? "",
    adjusterPhone: base?.adjusterPhone ?? "",
    adjusterEmail: base?.adjusterEmail ?? "",
    startDate: base?.startDate.slice(0, 10) ?? today,
    endDate: base?.endDate.slice(0, 10) ?? "",
    dailyRate: base ? String(base.dailyRate) : "",
    taxRate: base ? String(base.taxRate) : "0",
    mileageOut: base?.mileageOut?.toString() ?? "",
    mileageIn: base?.mileageIn?.toString() ?? "",
    fuelOut: base?.fuelOut ?? "",
    fuelIn: base?.fuelIn ?? "",
    conditionOut: base?.conditionOut ?? "",
    conditionIn: base?.conditionIn ?? "",
    damageNotes: base?.damageNotes ?? "",
    notes: base?.notes ?? "",
    status: base?.status ?? "draft",
  });
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const availableCars = cars.filter((car) => car.status === "available" || car.id === form.rentalCarId);
  const car = cars.find((item) => item.id === form.rentalCarId);
  const days = dayCount(form.startDate, form.endDate);
  const rate = Number(form.dailyRate) || 0;
  const taxRate = Number(form.taxRate) || 0;
  const subtotal = Math.round(rate * days * 100) / 100;
  const tax = Math.round(subtotal * taxRate) / 100;
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value });

  // Picking a claim fills the customer, insurer and adjuster from the claim and its customer record.
  function pickClaim(id: string) {
    setClaimId(id);
    const claim = claims.find((item) => item.id === id);
    if (!claim) return;
    const address = [claim.customer.address, [claim.customer.city, claim.customer.state, claim.customer.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    setForm((current) => ({
      ...current,
      customerName: `${claim.customer.firstName} ${claim.customer.lastName}`.trim(),
      customerPhone: claim.customer.phone || "",
      customerEmail: claim.customer.email || "",
      customerAddress: address,
      insuranceCompany: claim.insuranceCompany || "",
      claimNumber: claim.claimNumber || "",
      adjusterName: claim.adjusterName || "",
      adjusterPhone: claim.adjusterPhone || "",
      adjusterEmail: claim.adjusterEmail || "",
    }));
  }

  function pickCar(id: string) {
    const next = cars.find((item) => item.id === id);
    setForm((current) => ({ ...current, rentalCarId: id, dailyRate: next ? String(next.dailyRate) : current.dailyRate }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = { ...form, claimId: claimId || null, customerId: claims.find((item) => item.id === claimId)?.customer.id ?? base?.customerId ?? null, dailyRate: Number(form.dailyRate), taxRate: Number(form.taxRate) || 0 };
    try {
      if (existing) {
        const { rentalCarId: _car, ...update } = payload;
        await request(`/rental-agreements/${existing.id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(update) });
        await onDone(`Saved ${existing.agreementNumber}.`);
      } else {
        const created = await request<Agreement>("/rental-agreements", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
        await onDone(`Created rental agreement ${created.agreementNumber}.`);
      }
    } catch (saveError) {
      setError(errorText(saveError, "Unable to save the agreement"));
    } finally {
      setBusy(false);
    }
  }

  async function createInvoice(billTo: "insurer" | "customer") {
    if (!existing) return;
    setBusy(true);
    setError("");
    try {
      const invoice = await request<{ invoiceNumber: string }>(`/rental-agreements/${existing.id}/invoice`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ billTo }) });
      await onDone(`Invoice ${invoice.invoiceNumber} created for ${billTo === "insurer" ? "the insurance company" : "the customer"}.`);
    } catch (invoiceError) {
      setError(errorText(invoiceError, "Unable to create the invoice"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface rental-agreement">
      <div className="rental-heading">
        <div>
          <p className="eyebrow">{existing ? existing.agreementNumber : "New agreement"}</p>
          <h2>{existing ? "Edit rental agreement" : "Car rental agreement"}</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onCancel}>Back to rentals</button>
      </div>
      {error && <div className="sr-banner sr-warn" role="alert">{error}</div>}
      <form className="rental-form" onSubmit={save}>
        <fieldset>
          <legend>Claim and insurer</legend>
          <label>Claim<select value={claimId} onChange={(event) => pickClaim(event.target.value)}><option value="">No claim</option>{claims.map((item) => <option key={item.id} value={item.id}>{item.claimNumber || "Unnumbered"} · {item.customer.firstName} {item.customer.lastName}</option>)}</select></label>
          <label>Insurance company<input value={form.insuranceCompany} onChange={set("insuranceCompany")} /></label>
          <label>Claim number<input value={form.claimNumber} onChange={set("claimNumber")} /></label>
          <label>Adjuster name<input value={form.adjusterName} onChange={set("adjusterName")} /></label>
          <label>Adjuster phone<input value={form.adjusterPhone} onChange={set("adjusterPhone")} /></label>
          <label>Adjuster email<input type="email" value={form.adjusterEmail} onChange={set("adjusterEmail")} /></label>
        </fieldset>
        <fieldset>
          <legend>Customer</legend>
          <label>Full name<input required value={form.customerName} onChange={set("customerName")} /></label>
          <label>Phone<input value={form.customerPhone} onChange={set("customerPhone")} /></label>
          <label>Email (for signing)<input type="email" value={form.customerEmail} onChange={set("customerEmail")} /></label>
          <label className="rental-wide">Address<input value={form.customerAddress} onChange={set("customerAddress")} /></label>
        </fieldset>
        <fieldset>
          <legend>Car and dates</legend>
          <label>Rental car<select required value={form.rentalCarId} disabled={Boolean(existing)} onChange={(event) => pickCar(event.target.value)}><option value="">Choose a car</option>{availableCars.map((item) => <option key={item.id} value={item.id}>{item.name}{item.licensePlate ? ` · ${item.licensePlate}` : ""}</option>)}</select></label>
          <label>Pick-up date<input required type="date" value={form.startDate} onChange={set("startDate")} /></label>
          <label>Return date<input required type="date" value={form.endDate} onChange={set("endDate")} /></label>
          <label>Daily rate ($)<input required inputMode="decimal" value={form.dailyRate} onChange={set("dailyRate")} /></label>
          <label>Tax rate (%)<input inputMode="decimal" value={form.taxRate} onChange={set("taxRate")} /></label>
          <div className="rental-totals" aria-live="polite">
            <span>{days} day{days === 1 ? "" : "s"} × {money(rate)}</span>
            <span>Subtotal {money(subtotal)}</span>
            <span>Tax {money(tax)}</span>
            <strong>Total {money(subtotal + tax)}</strong>
            <small>Tax is applied to the whole total.</small>
          </div>
        </fieldset>
        <fieldset>
          <legend>Condition and mileage</legend>
          <label>Mileage out<input inputMode="numeric" value={form.mileageOut} onChange={set("mileageOut")} /></label>
          <label>Fuel out<select value={form.fuelOut} onChange={set("fuelOut")}><option value="">Not set</option>{FUEL.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Condition out<select value={form.conditionOut} onChange={set("conditionOut")}><option value="">Not set</option><option value="no_damage">No damage</option><option value="damage">Damage noted</option></select></label>
          <label>Mileage in<input inputMode="numeric" value={form.mileageIn} onChange={set("mileageIn")} /></label>
          <label>Fuel in<select value={form.fuelIn} onChange={set("fuelIn")}><option value="">Not set</option>{FUEL.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Condition in<select value={form.conditionIn} onChange={set("conditionIn")}><option value="">Not set</option><option value="no_damage">No damage</option><option value="damage">Damage noted</option></select></label>
          <label className="rental-wide">Damage notes<textarea rows={3} value={form.damageNotes} onChange={set("damageNotes")} /></label>
          <label className="rental-wide">Internal notes<textarea rows={2} value={form.notes} onChange={set("notes")} /></label>
          <label>Status<select value={form.status} onChange={set("status")}>{Object.entries(AGREEMENT_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
        </fieldset>
        <div className="rental-actions">
          <button className="orange-button" disabled={busy}>{busy ? "Saving..." : existing ? "Save changes" : "Create agreement"}</button>
          {existing && <button type="button" className="secondary-button" onClick={() => openAgreement(existing)}>View / print agreement</button>}
        </div>
      </form>
      {existing && (
        <div className="rental-invoice">
          <h3>Invoice</h3>
          {existing.invoiceId ? <p className="records-muted">An invoice already exists for this agreement.</p> : (
            <div className="rental-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void createInvoice("insurer")}>Invoice insurance company</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void createInvoice("customer")}>Invoice customer</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
