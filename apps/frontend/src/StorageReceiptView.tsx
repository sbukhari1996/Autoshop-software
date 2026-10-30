import React from "react";
import "./TowingReceiptView.css";
import "./StorageReceiptView.css";
import { ReceiptValues, receiptTemplate, sendToFrame } from "./receiptFrame";
import { ReceiptToolbar, RequestFn, SavedRef } from "./ReceiptToolbar";

const storageTemplate = receiptTemplate("storage");

// A storage receipt is for a vehicle held after it was declared a total loss. The insurer pays storage
// only after more than GRACE_DAYS days in storage.
export const STORAGE_GRACE_DAYS = 7;

export type StorageJob = {
  id: string;
  jobNumber: string;
  status: string;
  arrivalDate?: string | null;
  totalLoss?: boolean;
  customer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  };
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    color?: string | null;
    vin: string | null;
    licensePlate: string | null;
    licenseState?: string | null;
  } | null;
  claim?: {
    claimNumber?: string | null;
    customerClaimNumber?: string | null;
    customerPolicyNumber?: string | null;
    insuranceCompany?: string | null;
    adjusterName?: string | null;
    adjusterPhone?: string | null;
  } | null;
};

type BillTo = "insurance" | "customer" | "shop";

type Prefill = {
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  insurer?: string;
  policyNumber?: string;
  adjuster?: string;
  adjusterPhone?: string;
  claimNumber?: string;
  stockNo?: string;
  vehicle?: string;
  vin?: string;
  plate?: string;
  arrivalDate?: string;
  totalLoss?: boolean;
  billTo?: BillTo;
  shopName?: string;
  shopAddress?: string;
};

const SHOP_NAME = "Mastercraft Auto Repair & Collision";
const SHOP_ADDRESS = "38-21 23rd St, Long Island City, NY, 11101";

// "2026-08-07" or a full ISO timestamp -> local calendar date (no timezone shift).
function calendarDate(value?: string | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function daysInStorage(arrival?: string | null, end: Date = todayDate()): number | null {
  const start = calendarDate(arrival);
  if (!start) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

export function storageEligibility(job: Pick<StorageJob, "arrivalDate" | "totalLoss">) {
  const days = daysInStorage(job.arrivalDate);
  if (days === null) return { days, eligible: false, tone: "warn" as const, message: "Set the arrival date to check eligibility." };
  if (!job.totalLoss) return { days, eligible: false, tone: "warn" as const, message: "Not eligible yet: the vehicle is not declared a total loss." };
  if (days <= STORAGE_GRACE_DAYS) {
    return { days, eligible: false, tone: "warn" as const, message: `Not eligible yet: ${days} days in storage. Storage is billed after more than ${STORAGE_GRACE_DAYS} days.` };
  }
  return { days, eligible: true, tone: "ok" as const, message: `Eligible: declared a total loss and in storage ${days} days. Bill storage to the insurer.` };
}

function customerAddress(customer: StorageJob["customer"]) {
  const cityLine = [customer.city, [customer.state, customer.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [customer.address, cityLine].filter(Boolean).join(", ");
}

function vehicleText(vehicle: StorageJob["vehicle"]) {
  if (!vehicle) return "";
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");
}

function jobLabel(job: StorageJob) {
  const name = `${job.customer.firstName} ${job.customer.lastName}`.trim();
  const car = vehicleText(job.vehicle) || "Vehicle";
  const loss = job.totalLoss ? " · total loss" : "";
  return `${job.jobNumber} · ${car} · ${name}${loss}`;
}

function fullPrefill(job: StorageJob, billTo: BillTo): Prefill {
  const plate = [job.vehicle?.licensePlate, job.vehicle?.licenseState].filter(Boolean).join(" / ");
  return {
    customerName: `${job.customer.firstName} ${job.customer.lastName}`.trim(),
    customerPhone: job.customer.phone || "",
    customerAddress: customerAddress(job.customer),
    insurer: job.claim?.insuranceCompany || "",
    policyNumber: job.claim?.customerPolicyNumber || "",
    adjuster: job.claim?.adjusterName || "",
    adjusterPhone: job.claim?.adjusterPhone || "",
    claimNumber: job.claim?.customerClaimNumber || job.claim?.claimNumber || "",
    stockNo: job.jobNumber,
    vehicle: vehicleText(job.vehicle),
    vin: job.vehicle?.vin ? job.vehicle.vin.slice(-6).toUpperCase() : "",
    plate,
    arrivalDate: job.arrivalDate ? job.arrivalDate.slice(0, 10) : "",
    totalLoss: Boolean(job.totalLoss),
    billTo,
    shopName: SHOP_NAME,
    shopAddress: SHOP_ADDRESS,
  };
}


export function StorageReceiptView({
  jobs,
  request,
  onRefresh,
  openRequest,
  onOpenHandled,
}: {
  jobs: StorageJob[];
  request: RequestFn;
  onRefresh: () => Promise<void>;
  openRequest: { id: string } | null;
  onOpenHandled: () => void;
}) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [jobId, setJobId] = React.useState("");
  const [billTo, setBillTo] = React.useState<BillTo>("insurance");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState<SavedRef | null>(null);
  const [frameKey, setFrameKey] = React.useState(0);
  // Values of a saved receipt, put back into the form once the frame has loaded.
  const restoreRef = React.useRef<ReceiptValues | null>(null);

  // Total-loss vehicles first, then the rest.
  const ordered = React.useMemo(
    () => [...jobs].sort((a, b) => Number(Boolean(b.totalLoss)) - Number(Boolean(a.totalLoss)) || a.jobNumber.localeCompare(b.jobNumber)),
    [jobs],
  );
  const job = ordered.find((item) => item.id === jobId) || null;
  const eligibility = job ? storageEligibility(job) : null;

  const sendPrefill = (values: Prefill) => sendToFrame(frameRef.current, { type: "storage-prefill", values });

  // Opening a saved storage receipt from the Saved Receipts window.
  React.useEffect(() => {
    if (!openRequest) return;
    void (async () => {
      try {
        const row = await request<SavedRef & { values: ReceiptValues }>(`/receipts/${openRequest.id}`);
        restoreRef.current = row.values;
        setSaved({ id: row.id, title: row.title });
        setJobId("");
        setError("");
        setFrameKey((key) => key + 1);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to open the receipt");
      } finally {
        onOpenHandled();
      }
    })();
  }, [openRequest?.id]);

  function startNew() {
    restoreRef.current = null;
    setSaved(null);
    setJobId("");
    setError("");
    setFrameKey((key) => key + 1);
  }

  function chooseJob(id: string) {
    setJobId(id);
    setError("");
    const next = ordered.find((item) => item.id === id);
    if (next) sendPrefill(fullPrefill(next, billTo));
  }

  function pullIn() {
    if (job) sendPrefill(fullPrefill(job, billTo));
  }

  function chooseBillTo(next: BillTo) {
    setBillTo(next);
    if (job) sendPrefill({ ...fullPrefill(job, next) });
    else sendPrefill({ billTo: next, shopName: SHOP_NAME, shopAddress: SHOP_ADDRESS });
  }

  // Save the storage facts on the job, then refresh the list and the receipt's dates.
  async function saveStorage(body: { totalLoss?: boolean; arrivalDate?: string | null }) {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      await request(`/jobs/${job.id}/storage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await onRefresh();
      const nextTotalLoss = body.totalLoss ?? job.totalLoss;
      const nextArrival = body.arrivalDate !== undefined ? body.arrivalDate || "" : job.arrivalDate?.slice(0, 10) || "";
      sendPrefill({ totalLoss: Boolean(nextTotalLoss), arrivalDate: nextArrival });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save storage details");
    } finally {
      setBusy(false);
    }
  }

  // Once the receipt has loaded, put back a saved receipt's values, or send whatever is already selected.
  function handleFrameLoad() {
    if (restoreRef.current) {
      sendToFrame(frameRef.current, { type: "receipt-restore", values: restoreRef.current });
      restoreRef.current = null;
      return;
    }
    if (job) sendPrefill(fullPrefill(job, billTo));
  }

  return (
    <section className="tr-workspace">
      <div className="tr-toolbar surface">
        <div className="tr-toolbar-head">
          <div>
            <p className="eyebrow">Storage receipts</p>
            <h2>{saved ? "Editing a storage receipt" : "Storage charges for a total loss"}</h2>
            <p className="subheading">
              Choose the vehicle in storage. Its customer, insurer and claim are pulled in, and the storage days are counted from the arrival date.
              Tick the charges that apply. Storage is billed to the insurer once a total-loss vehicle is in storage more than {STORAGE_GRACE_DAYS} days.
            </p>
          </div>
        </div>

        <div className="tr-controls">
          <label className="tr-field">
            <span>Vehicle in storage</span>
            <select value={jobId} onChange={(event) => chooseJob(event.target.value)}>
              <option value="">Choose a vehicle</option>
              {ordered.map((item) => (
                <option key={item.id} value={item.id}>
                  {jobLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <div className="tr-field">
            <span>Bill to</span>
            <div className="tr-segment" role="group" aria-label="Bill to">
              {(["insurance", "customer", "shop"] as BillTo[]).map((option) => (
                <button key={option} type="button" className={billTo === option ? "active" : ""} aria-pressed={billTo === option} onClick={() => chooseBillTo(option)}>
                  {option === "insurance" ? "Insurance" : option === "customer" ? "Customer" : "Shop"}
                </button>
              ))}
            </div>
          </div>
          <div className="tr-field">
            <span>Customer and insurance</span>
            <button type="button" className="secondary-button" onClick={pullIn} disabled={!job}>
              Pull in customer and insurance
            </button>
          </div>
          <label className="tr-field">
            <span>Arrived in storage</span>
            <input
              type="date"
              value={job?.arrivalDate ? job.arrivalDate.slice(0, 10) : ""}
              disabled={!job || busy}
              onChange={(event) => void saveStorage({ arrivalDate: event.target.value || null })}
            />
          </label>
          <div className="tr-field">
            <span>Declared total loss</span>
            <div className="tr-segment" role="group" aria-label="Declared total loss">
              <button type="button" className={job?.totalLoss ? "active" : ""} aria-pressed={Boolean(job?.totalLoss)} disabled={!job || busy} onClick={() => void saveStorage({ totalLoss: true })}>
                Yes
              </button>
              <button type="button" className={job && !job.totalLoss ? "active" : ""} aria-pressed={Boolean(job && !job.totalLoss)} disabled={!job || busy} onClick={() => void saveStorage({ totalLoss: false })}>
                No
              </button>
            </div>
          </div>
        </div>

        {job && eligibility && (
          <div className={`sr-banner sr-${eligibility.tone}`} role="status">
            {eligibility.message}
            {eligibility.days !== null && <span className="sr-days"> {eligibility.days} day{eligibility.days === 1 ? "" : "s"} in storage</span>}
          </div>
        )}
        <ReceiptToolbar kind="storage" frameRef={frameRef} saved={saved} request={request} onSaved={setSaved} onNew={startNew} />
        {error && <div className="sr-banner sr-warn" role="alert">{error}</div>}
      </div>

      <iframe
        key={frameKey}
        ref={frameRef}
        className="tr-frame"
        title="Storage receipt"
        srcDoc={storageTemplate}
        sandbox="allow-scripts allow-modals"
        onLoad={handleFrameLoad}
      />
    </section>
  );
}
