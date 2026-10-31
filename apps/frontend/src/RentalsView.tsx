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
            <tr><th>Agreement</th><th>Customer</th><th>Car</th><th>Dates</th><th>Total</th><th>Status</th><th>Invoice</th><th>Copy</th></tr>
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
                <td data-label="Copy"><button type="button" className="secondary-button rental-print" onClick={(event) => { event.stopPropagation(); openAgreement(item); }}>Print / PDF</button></td>
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

// Shop details printed on every agreement. Fill these in once.
const SHOP = { name: "Mastercraft Auto Repair & Collision", address: "3821 23rd St", cityLine: "Long Island City, NY 11101", phone: "718-578-4563", email: "shop@mastercraftautony.com", county: "Queens" };

// Printable loan and rental agreement in a new tab. Print dialog > Save as PDF gives the download.
// shortcut: wording is a drafted template, have a New York attorney review before use.
function openAgreement(a: Agreement) {
  const car = a.rentalCar;
  const carLine = [car.year, car.make, car.model, car.color].filter(Boolean).join(" ");
  const plate = [car.licensePlate, car.licenseState].filter(Boolean).join(" ");
  const billedTo = a.insuranceCompany ? `Insurance company: ${escapeHtml(a.insuranceCompany)}` : "Renter (customer pays)";
  const row = (label: string, value: string | number | null | undefined) => `<tr><th>${label}</th><td>${escapeHtml(value ?? "")}</td></tr>`;
  const fill = (label: string) => `<tr><th>${label}</th><td class="fill"></td></tr>`;
  const clause = (no: string, text: string) => `<p class="c"><b>${no}</b>&nbsp; ${text}</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(a.agreementNumber)} Vehicle Loan and Rental Agreement</title>
<style>
@page { size: Letter; margin: 0.7in 0.75in 0.9in; @bottom-left { content: "${escapeHtml(a.agreementNumber)} · ${SHOP.name}"; font: 8.5pt Arial, sans-serif; color: #333; } @bottom-right { content: "Renter initials: ________   Page " counter(page) " of " counter(pages); font: 8.5pt Arial, sans-serif; color: #333; } }
body { font-family: "Times New Roman", Times, Georgia, serif; color: #111; font-size: 11pt; line-height: 1.38; margin: 0; }
.bar { margin: 16px; font: 14px Arial, sans-serif; }
.bar button { padding: 8px 16px; font-size: 14px; }
.letterhead { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; }
.letterhead .shop { font-size: 17pt; font-weight: bold; letter-spacing: .04em; text-transform: uppercase; }
.letterhead .addr { font-size: 9.5pt; color: #333; margin-top: 2px; }
h1 { font-size: 15pt; text-align: center; letter-spacing: .08em; margin: 14px 0 2px; }
.meta { text-align: center; font-size: 10pt; margin-bottom: 10px; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 6px; border-bottom: 1px solid #555; padding-bottom: 2px; page-break-after: avoid; }
table { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin-bottom: 4px; }
th { text-align: left; font-weight: bold; width: 30%; padding: 3px 8px 3px 0; vertical-align: top; }
td { padding: 3px 0; border-bottom: 1px dotted #888; vertical-align: top; }
td.fill { height: 18px; }
.two { display: flex; gap: 22px; }
.two > div { flex: 1; }
p.c { text-align: justify; margin: 0 0 6px 0; }
p.c b { font-weight: bold; }
.box { border: 1px solid #111; padding: 8px 10px; font-size: 10.5pt; margin: 8px 0; }
.check p { margin: 4px 0 4px 0; text-align: justify; }
.check span { display: inline-block; width: 13px; height: 13px; border: 1px solid #111; margin-right: 8px; vertical-align: -2px; }
.sig { display: flex; gap: 28px; margin-top: 28px; page-break-inside: avoid; }
.sig > div { flex: 1; }
.sig .line { border-top: 1px solid #111; padding-top: 3px; font-size: 10pt; }
.sig .space { height: 30px; }
.keep { page-break-inside: avoid; }
@media print { .bar { display: none; } }
@media screen { body { max-width: 8.5in; margin: 0 auto 60px; padding: 0 0.5in; box-sizing: border-box; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="letterhead"><div class="shop">${escapeHtml(SHOP.name)}</div><div class="addr">${escapeHtml(SHOP.address)} · ${escapeHtml(SHOP.cityLine)}<br>Tel. ${escapeHtml(SHOP.phone)} · ${escapeHtml(SHOP.email)}</div></div>
<h1>VEHICLE LOAN AND RENTAL AGREEMENT</h1>
<div class="meta">Agreement No. <b>${escapeHtml(a.agreementNumber)}</b> &nbsp;·&nbsp; Issued ${dateText(a.createdAt)} &nbsp;·&nbsp; Status: ${escapeHtml(AGREEMENT_STATUS[a.status]?.label ?? a.status)}</div>

<p class="c">This Vehicle Loan and Rental Agreement (the &ldquo;Agreement&rdquo;) is made between ${escapeHtml(SHOP.name)} (the &ldquo;Shop&rdquo;) and the person named below (the &ldquo;Renter&rdquo;). The Shop lends the vehicle described below (the &ldquo;Vehicle&rdquo;) to the Renter on the terms of this Agreement.</p>

<h2>1. Parties, Vehicle and Rental Period</h2>
<div class="two">
<div><table>${row("Renter", a.customerName)}${row("Phone", a.customerPhone)}${row("Email", a.customerEmail)}${row("Address", a.customerAddress)}</table></div>
<div><table>${row("Claim number", a.claimNumber)}${row("Insurance company", a.insuranceCompany)}${row("Adjuster", a.adjusterName)}${row("Adjuster phone", a.adjusterPhone)}${row("Adjuster email", a.adjusterEmail)}${fill("Days authorized by insurer")}</table></div>
</div>
<table>${row("Vehicle", `${car.name}${carLine ? ", " + carLine : ""}`)}${row("License plate", plate)}${row("VIN", car.vin)}
${row("Pick-up date", dateText(a.startDate))}${row("Return date", dateText(a.endDate))}${row("Days rented", a.days)}${row("Billed to", billedTo)}</table>

<h2>2. Insurance Authorization and Renter Responsibility</h2>
${clause("2.1", "The Shop lends the Vehicle while the Renter&rsquo;s own vehicle is being repaired at the Shop, for the Rental Period above. The Renter may keep the Vehicle only for the period described in this Agreement.")}
${clause("2.2", "If the Renter&rsquo;s insurance company authorizes a loan or rental, the Shop may bill that company at the daily rate shown in Section 3 for the number of days it authorizes. An authorization does not limit the Renter&rsquo;s obligations under this Agreement.")}
${clause("2.3", "<b>Any day beyond the number of days the insurance company authorizes, and any amount the insurance company does not pay, is the Renter&rsquo;s personal responsibility.</b> The Renter agrees to pay those charges at the daily rate, plus applicable sales tax, when the Shop issues an invoice.")}
${clause("2.4", "The Renter understands that an insurance company may stop authorizing a rental at any time, and that the Renter remains responsible for all charges after that date.")}

<h2>3. Charges, Billing and Payment</h2>
${clause("3.1", `The daily rate for this Agreement is <b>$${a.dailyRate.toFixed(2)}</b> per day. Each day or part of a day counts as one day. Sales tax is applied to the whole rental total at ${a.taxRate}%. The rental total on this Agreement is <b>$${a.total.toFixed(2)}</b>, including tax, before any fees under Sections 4 through 7.`)}
${clause("3.2", "Charges are billed to the party shown in Section 1. Where charges are billed to an insurance company, the Renter remains liable for any part the company does not pay.")}
${clause("3.3", "Invoices are due on receipt unless the Shop states otherwise in writing. Late payments may be charged interest at the maximum rate permitted by New York law.")}
${clause("3.4", "The Renter authorizes the Shop to charge the Renter&rsquo;s payment method on file for any amount due under this Agreement that is not paid when due.")}
${clause("3.5", "The rate on this Agreement may be changed only by a written amendment signed by both parties before the Vehicle is released.")}

<h2>4. Return of Vehicle and Holding Over</h2>
${clause("4.1", "The Renter must return the Vehicle to the Shop on the Return Date, at the Shop&rsquo;s place of business, with all keys, documents and accessories.")}
${clause("4.2", "When the Renter&rsquo;s repairs are complete, the Shop may ask the Renter to return the Vehicle within twenty-four (24) hours after notice by telephone, voicemail, text message, email or in person. Notice sent to the contact information in Section 1 is sufficient.")}
${clause("4.3", "If the Vehicle is kept after the Return Date or after the notice period in Section 4.2, each additional day is charged at the daily rate. The Renter remains responsible for the Vehicle during that time, including for any loss, damage or theft.")}
${clause("4.4", "If the Vehicle is not returned when required, the Renter agrees to pay the Shop&rsquo;s reasonable costs to recover it, including towing, storage and attorney&rsquo;s fees.")}

<h2>5. Use of the Vehicle</h2>
${clause("5.1", "Only the Renter, or a driver approved in writing by the Shop, may drive the Vehicle.")}
${clause("5.2", "The Renter shall not sublet, lend, rent or allow anyone else to possess or use the Vehicle; use the Vehicle for hire, towing, racing, speed contests or off-road driving; carry more passengers than seats or any hazardous material; or drive the Vehicle outside the State of New York without the Shop&rsquo;s written consent.")}
${clause("5.3", "The Renter shall not operate the Vehicle while under the influence of alcohol, cannabis, narcotics or any other substance that impairs driving.")}
${clause("5.4", "The Renter shall obey all traffic, parking and other laws. The Renter is responsible for all parking tickets, traffic violations, tolls, fines and impound fees assigned to the Vehicle while it is in the Renter&rsquo;s possession.")}

<h2>6. Driver Qualifications</h2>
${clause("6.1", "The driver must be at least twenty-six (26) years old, hold a valid driver&rsquo;s license for this class of vehicle, and present that license at pick-up.")}
${clause("6.2", "The Renter confirms that the information about the Renter and the Renter&rsquo;s insurance in this Agreement is accurate, and will tell the Shop promptly of any change.")}

<h2>7. Care, Fuel, Cleaning and Keys</h2>
${clause("7.1", "The Renter shall keep the Vehicle in good condition, lock it when unattended, and protect it from loss or damage.")}
${clause("7.2", "<b>Smoking is prohibited in the Vehicle.</b> A cleaning fee of <b>$125.00</b> applies to smoke odor or smoking residue. The Renter is also responsible for any cleaning or repair cost above that amount.")}
${clause("7.3", "The Renter shall return the Vehicle with the same fuel level recorded at pick-up in Section 8. For each quarter tank of fuel needed to restore that level, the Renter shall pay a <b>$20.00</b> fuel service charge plus the cost of the fuel.")}
${clause("7.4", "The Renter shall not remove, alter, or add any equipment, accessory or sticker to the Vehicle.")}
${clause("7.5", "The Renter is responsible for any lost, stolen or damaged keys or key fobs, including the cost of replacing or reprogramming them.")}

<h2>8. Vehicle Condition Report</h2>
<p class="c">The Renter and the Shop have recorded the Vehicle&rsquo;s condition below. The Renter accepts the Vehicle in the condition recorded at pick-up, and any damage not recorded there will be presumed to have occurred during the rental.</p>
<table>${fill("Mileage out")}${fill("Mileage in")}${row("Fuel out", a.fuelOut)}${fill("Fuel in")}${row("Condition out", a.conditionOut)}${fill("Condition in")}${row("Damage noted at pick-up", a.damageNotes)}${fill("Damage noted at return")}</table>

<h2>9. Insurance; Responsibility for Damage and Loss</h2>
${clause("9.1", "The Renter&rsquo;s own automobile insurance is primary for the Vehicle while it is in the Renter&rsquo;s possession. The Renter certifies that the Renter carries motor vehicle liability insurance meeting New York requirements, and that the Renter&rsquo;s policy covers the Renter while driving a loaned vehicle, to the extent the policy permits.")}
${clause("9.2", "<b>The Renter is responsible for all damage to the Vehicle, regardless of fault,</b> including collision, theft, vandalism, weather, glass and undercarriage damage. This responsibility applies to the extent the Vehicle&rsquo;s damage is not paid by an insurance company that accepts the claim. The Renter is responsible for all deductibles and for any repair the insurance company does not pay.")}
${clause("9.3", "If the Vehicle is lost, stolen, destroyed, or cannot be returned for any reason, the Renter shall pay the Vehicle&rsquo;s market value on the date of loss, the value of any missing accessories, and the Shop&rsquo;s reasonable loss-of-use charge at the daily rate for the period the Vehicle is unavailable.")}
${clause("9.4", "The Shop provides no warranty, express or implied, about the Vehicle. Any insurance maintained by the Shop is excess over, and does not replace, the Renter&rsquo;s insurance and does not cover the Renter&rsquo;s liability.")}

<h2>10. Accidents and Reporting</h2>
${clause("10.1", "The Renter must notify the Shop within <b>twelve (12) hours</b> of any accident, theft, vandalism, fire or other damage involving the Vehicle, and must provide the Shop a full written report.")}
${clause("10.2", "The Renter shall report any accident to the police and the New York Department of Motor Vehicles when required by the New York Vehicle and Traffic Law, and shall give the Shop a copy of each report.")}
${clause("10.3", "The Renter shall not admit fault, make any settlement, or waive any claim concerning the Vehicle without the Shop&rsquo;s prior written consent, except where the law requires otherwise.")}
${clause("10.4", "The Renter shall cooperate with the Shop and any insurance company in investigating and resolving any claim involving the Vehicle.")}

<h2>11. Indemnification</h2>
${clause("11.1", "To the fullest extent permitted by law, the Renter shall defend, indemnify and hold harmless the Shop, and its owners, employees and agents, from all claims, demands, suits, judgments, losses, damages, fines, penalties, attorney&rsquo;s fees and costs arising from the possession, use, operation, storage or condition of the Vehicle while it is in the Renter&rsquo;s possession or control, including claims for bodily injury or property damage. This obligation does not apply to the extent a loss is caused by the Shop&rsquo;s gross negligence or willful misconduct.")}

<h2>12. Default and Remedies</h2>
${clause("12.1", "The Renter is in default if the Renter fails to pay any amount when due, fails to return the Vehicle when required, breaks any term of this Agreement, or gives false information to the Shop.")}
${clause("12.2", "After a default, the Shop may demand return of the Vehicle, end the rental, and use any remedy available under New York law, including recovery of the Vehicle.")}
${clause("12.3", "To the extent permitted by law, the Renter shall pay the Shop&rsquo;s reasonable attorney&rsquo;s fees, collection costs and court costs incurred in enforcing this Agreement.")}
${clause("12.4", "The Shop&rsquo;s rights are cumulative. A delay in enforcing any right is not a waiver of that right.")}

<h2>13. Governing Law and Venue</h2>
${clause("13.1", "This Agreement is governed by the laws of the State of New York.")}
${clause("13.2", `Any legal action arising from this Agreement shall be brought in the courts located in ${escapeHtml(SHOP.county)} County, New York, and the parties consent to the jurisdiction of those courts.`)}

<h2>14. General Terms</h2>
${clause("14.1", "This Agreement, together with any invoice issued under it, is the entire agreement about the rental of the Vehicle and replaces any prior discussion about it.")}
${clause("14.2", "This Agreement may be changed only in a writing signed by both parties. If any provision is found unenforceable, the rest of this Agreement remains in effect, and that provision applies to the maximum extent permitted by law.")}
${clause("14.3", "Notices to the Renter may be sent to the contact information in Section 1. The Renter shall tell the Shop in writing of any change of address, telephone number or email.")}
${clause("14.4", "A photocopy, scan or electronic signature of this Agreement has the same effect as the original. Sections 9 through 14 survive the return of the Vehicle.")}

<div class="keep">
<h2>15. Acknowledgment and Consent</h2>
<div class="check">
<p><span></span>I have read this Agreement, I understand it, and I agree to all of its terms.</p>
<p><span></span>I understand that any day beyond the insurance-authorized period, and any amount the insurance company does not pay, is my personal responsibility (Section 2).</p>
<p><span></span>I understand that I am responsible for damage to the Vehicle regardless of fault, to the extent it is not paid by insurance (Section 9).</p>
<p><span></span>I have had the opportunity to consult an attorney before signing, and I sign this Agreement voluntarily.</p>
</div>
<div class="sig">
<div><div class="space"></div><div class="line">Renter signature</div></div>
<div><div class="space"></div><div class="line">Printed name</div></div>
<div><div class="space"></div><div class="line">Date</div></div>
</div>
<div class="sig">
<div><div class="space"></div><div class="line">Shop representative signature</div></div>
<div><div class="space"></div><div class="line">Printed name and title</div></div>
<div><div class="space"></div><div class="line">Date</div></div>
</div>
</div>

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
