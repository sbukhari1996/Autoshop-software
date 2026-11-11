import React from "react";
import "./PartsArrivalsView.css";

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;

export const partStatusLabels: Record<string, string> = {
  not_ordered: "Not ordered",
  ordered: "Ordered",
  waiting_delivery: "Waiting for delivery",
  arrived: "Arrived",
  arrived_wrong: "Arrived wrong",
  returned: "Returned",
};

type JobPart = {
  id: string;
  partName: string;
  partNumber: string | null;
  quantity: number;
  status: string;
  vendorName: string | null;
  vendorPhone: string | null;
  poNumber: string | null;
  quoteNumber: string | null;
  invoiceNumber: string | null;
  expectedDate: string | null;
};

type Arrival = JobPart & {
  job: {
    id: string;
    jobNumber: string;
    customer: { firstName: string; lastName: string };
    vehicle: { year: number | null; make: string | null; model: string | null } | null;
  };
};

const json = { "Content-Type": "application/json" };

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function localDayKey(offset: number) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function dayLabel(offset: number, key: string) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function partLine(part: JobPart) {
  return [part.partNumber, part.vendorName, part.vendorPhone].filter(Boolean).join(" · ");
}

function referenceLine(part: JobPart) {
  return [part.poNumber && `PO ${part.poNumber}`, part.quoteNumber && `Quote ${part.quoteNumber}`, part.invoiceNumber && `Invoice ${part.invoiceNumber}`]
    .filter(Boolean)
    .join(" · ");
}

type PartValues = {
  partName: string;
  partNumber: string;
  quantity: string;
  status: string;
  vendorName: string;
  vendorPhone: string;
  poNumber: string;
  quoteNumber: string;
  invoiceNumber: string;
  expectedDate: string;
};

const blankPart: PartValues = { partName: "", partNumber: "", quantity: "1", status: "not_ordered", vendorName: "", vendorPhone: "", poNumber: "", quoteNumber: "", invoiceNumber: "", expectedDate: "" };

function valuesOf(part: JobPart): PartValues {
  return {
    partName: part.partName,
    partNumber: part.partNumber || "",
    quantity: String(part.quantity),
    status: part.status,
    vendorName: part.vendorName || "",
    vendorPhone: part.vendorPhone || "",
    poNumber: part.poNumber || "",
    quoteNumber: part.quoteNumber || "",
    invoiceNumber: part.invoiceNumber || "",
    expectedDate: part.expectedDate ? part.expectedDate.slice(0, 10) : "",
  };
}

function PartFields({ values, onChange }: { values: PartValues; onChange: (next: PartValues) => void }) {
  const input = (key: keyof PartValues, placeholder: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input placeholder={placeholder} aria-label={placeholder} value={values[key]} onChange={(event) => onChange({ ...values, [key]: event.target.value })} {...props} />
  );
  return (
    <>
      {input("partName", "Part name", { required: true })}
      {input("partNumber", "Part #")}
      {input("quantity", "Qty", { type: "number", min: 1 })}
      <select aria-label="Part status" value={values.status} onChange={(event) => onChange({ ...values, status: event.target.value })}>
        {Object.entries(partStatusLabels).map(([value, label]) => (
          <option value={value} key={value}>{label}</option>
        ))}
      </select>
      {input("vendorName", "Vendor")}
      {input("vendorPhone", "Vendor phone")}
      {input("poNumber", "PO #")}
      {input("quoteNumber", "Quote #")}
      {input("invoiceNumber", "Invoice #")}
      {input("expectedDate", "Expected delivery", { type: "date" })}
    </>
  );
}

export function JobPartsPanel({ jobId, request }: { jobId: string; request: Request }) {
  const [parts, setParts] = React.useState<JobPart[]>([]);
  const [form, setForm] = React.useState(blankPart);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValues, setEditValues] = React.useState(blankPart);
  const [error, setError] = React.useState("");

  async function load() {
    setParts(await request<JobPart[]>(`/jobs/${jobId}/parts`));
  }
  React.useEffect(() => {
    load().catch((loadError) => setError(errorText(loadError, "Unable to load parts")));
  }, [jobId]);

  // Returns true when the change saved, so the caller can close its form.
  async function run(action: () => Promise<unknown>, fallback: string) {
    setError("");
    try {
      await action();
      await load();
      return true;
    } catch (actionError) {
      setError(errorText(actionError, fallback));
      return false;
    }
  }

  function changePart(part: JobPart, changes: Record<string, unknown>) {
    return run(() => request(`/parts/${part.id}`, { method: "PATCH", headers: json, body: JSON.stringify(changes) }), "Unable to update part");
  }

  async function addPart(event: React.FormEvent) {
    event.preventDefault();
    if (await run(() => request(`/jobs/${jobId}/parts`, { method: "POST", headers: json, body: JSON.stringify(form) }), "Unable to add part")) setForm(blankPart);
  }

  async function saveEdit(part: JobPart) {
    if (await run(() => request(`/parts/${part.id}`, { method: "PATCH", headers: json, body: JSON.stringify(editValues) }), "Unable to save part")) setEditingId(null);
  }

  return (
    <div className="operation-section parts-panel">
      <h3>Parts needed</h3>
      {error && <p className="vin-error">{error}</p>}
      {parts.length ? (
        parts.map((part) =>
          editingId === part.id ? (
            <form className="parts-form part-edit" key={part.id} onSubmit={(event) => { event.preventDefault(); void saveEdit(part); }}>
              <PartFields values={editValues} onChange={setEditValues} />
              <button className="text-button">Save part</button>
              <button type="button" className="secondary-button compact" onClick={() => setEditingId(null)}>Cancel</button>
            </form>
          ) : (
            <div className="part-row" key={part.id}>
              <div className="part-main">
                <strong>{part.quantity} × {part.partName}</strong>
                {partLine(part) && <small>{partLine(part)}</small>}
                {referenceLine(part) && <small>{referenceLine(part)}</small>}
              </div>
              <div className="part-controls">
                <select value={part.status} aria-label="Part status" onChange={(event) => void changePart(part, { status: event.target.value })}>
                  {Object.entries(partStatusLabels).map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
                <input
                  type="date"
                  aria-label="Expected delivery"
                  value={part.expectedDate ? part.expectedDate.slice(0, 10) : ""}
                  onChange={(event) => void changePart(part, { expectedDate: event.target.value || null })}
                />
                <button type="button" className="secondary-button compact" onClick={() => { setEditValues(valuesOf(part)); setEditingId(part.id); }}>Edit</button>
                <button
                  type="button"
                  className="danger-button compact-danger"
                  onClick={() => {
                    if (window.confirm(`Delete "${part.partName}"?`)) void run(() => request(`/parts/${part.id}`, { method: "DELETE" }), "Unable to delete part");
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ),
        )
      ) : (
        <p className="table-subtext">No parts listed for this car yet.</p>
      )}
      <form className="parts-form" onSubmit={addPart}>
        <PartFields values={form} onChange={setForm} />
        <button className="text-button">Add part</button>
      </form>
    </div>
  );
}

export function PartsArrivalsView({ request }: { request: Request }) {
  const [days] = React.useState(() => Array.from({ length: 7 }, (_, offset) => ({ offset, key: localDayKey(offset) })));
  const [arrivals, setArrivals] = React.useState<Arrival[]>([]);
  const [error, setError] = React.useState("");

  async function load() {
    setError("");
    try {
      setArrivals(await request<Arrival[]>(`/parts/arrivals?from=${days[0].key}&to=${days[days.length - 1].key}`));
    } catch (loadError) {
      setError(errorText(loadError, "Unable to load arrivals"));
    }
  }
  React.useEffect(() => {
    void load();
  }, []);

  return (
    <section className="parts-arrivals">
      <header className="parts-arrivals-head">
        <div>
          <p className="eyebrow">Next 7 days</p>
          <h2>Parts arriving</h2>
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <div className="arrivals-scroll">
        {days.map((day) => {
          const dayParts = arrivals.filter((part) => part.expectedDate?.slice(0, 10) === day.key);
          const cars = new Map<string, Arrival[]>();
          for (const part of dayParts) cars.set(part.job.id, [...(cars.get(part.job.id) || []), part]);
          return (
            <div className="arrival-day" key={day.key}>
              <div className={day.offset === 0 ? "arrival-divider today" : "arrival-divider"} role="separator">
                <span>{dayLabel(day.offset, day.key)}</span>
                <small>{cars.size ? `${cars.size} car${cars.size === 1 ? "" : "s"} · ${dayParts.length} part${dayParts.length === 1 ? "" : "s"}` : "Nothing due"}</small>
              </div>
              {[...cars.values()].map((carParts) => {
                const car = carParts[0];
                const vehicle = car.job.vehicle;
                return (
                  <article className="arrival-car" key={car.job.id}>
                    <header>
                      <strong>{[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle pending"}</strong>
                      <small>{car.job.customer.firstName} {car.job.customer.lastName} · {car.job.jobNumber}</small>
                    </header>
                    <ul>
                      {carParts.map((part) => (
                        <li key={part.id}>
                          <span>{part.quantity} × {part.partName}</span>
                          <small>{[part.vendorName, part.partNumber].filter(Boolean).join(" · ")}</small>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
