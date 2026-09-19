import React from "react";
import { LineItemPresetPicker } from "./LineItemPresetPicker";
import type { CollisionPresetItem } from "./collisionLineItemPresets";

type Job = {
  id: string;
  jobNumber: string;
  customer: { firstName: string; lastName: string; address?: string | null };
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    vin?: string | null;
    licensePlate?: string | null;
  } | null;
};
type Line = {
  section: string;
  operation: string;
  description: string;
  partNumber: string;
  quantity: string;
  unitPrice: string;
  laborHours: string;
  paintHours: string;
};
type WalkIn = {
  customerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  bodyClass: string;
  vin: string;
  license: string;
  vehicleState: string;
  registration: string;
};
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const newLine = (): Line => ({
  section: "FRONT DOOR",
  operation: "Rpr",
  description: "",
  partNumber: "",
  quantity: "1",
  unitPrice: "",
  laborHours: "",
  paintHours: "",
});
const money = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyWalkIn: WalkIn = {
  customerName: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  year: "",
  make: "",
  model: "",
  trim: "",
  bodyClass: "",
  vin: "",
  license: "",
  vehicleState: "",
  registration: "",
};

export function EstimateBuilder({
  jobs,
  request,
  onSaved,
}: {
  jobs: Job[];
  request: Request;
  onSaved: () => Promise<void>;
}) {
  const [jobId, setJobId] = React.useState("");
  const [source, setSource] = React.useState<"existing" | "walkin">("existing");
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [walkIn, setWalkIn] = React.useState<WalkIn>(emptyWalkIn);
  const [vinLoading, setVinLoading] = React.useState(false);
  const [vinMessage, setVinMessage] = React.useState("");
  const [number, setNumber] = React.useState("");
  const [damage, setDamage] = React.useState("");
  const [taxRate, setTaxRate] = React.useState("8.875");
  const [bodyRate, setBodyRate] = React.useState("65");
  const [paintRate, setPaintRate] = React.useState("65");
  const [supplyRate, setSupplyRate] = React.useState("38");
  const [lines, setLines] = React.useState<Line[]>([newLine()]);
  const [error, setError] = React.useState("");
  const [savedEstimateId, setSavedEstimateId] = React.useState("");
  const [downloading, setDownloading] = React.useState(false);
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  const selectedJob = jobs.find((job) => job.id === jobId);
  const customerName =
    source === "walkin"
      ? walkIn.customerName || "Walk-in customer"
      : selectedJob
        ? `${selectedJob.customer.firstName} ${selectedJob.customer.lastName}`
        : "Select a customer";
  const customerAddress =
    source === "walkin"
      ? [
          walkIn.address,
          [walkIn.city, walkIn.state, walkIn.zip].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join("\n")
      : selectedJob?.customer.address || "";
  const vehicleName =
    source === "walkin"
      ? [walkIn.year, walkIn.make, walkIn.model, walkIn.trim]
          .filter(Boolean)
          .join(" ") || "Not specified"
      : selectedJob?.vehicle
        ? [
            selectedJob.vehicle.year,
            selectedJob.vehicle.make,
            selectedJob.vehicle.model,
          ]
            .filter(Boolean)
            .join(" ")
        : "Not specified";
  const vehicleVin =
    source === "walkin" ? walkIn.vin : selectedJob?.vehicle?.vin || "N/A";
  const vehicleLicense =
    source === "walkin"
      ? `${walkIn.license}${walkIn.vehicleState ? ` (${walkIn.vehicleState})` : ""}`
      : selectedJob?.vehicle?.licensePlate || "N/A";
  const parts = lines.reduce(
    (sum, line) =>
      sum + Number(line.quantity || 0) * Number(line.unitPrice || 0),
    0,
  );
  const bodyHours = lines.reduce(
    (sum, line) => sum + Number(line.laborHours || 0),
    0,
  );
  const paintHours = lines.reduce(
    (sum, line) => sum + Number(line.paintHours || 0),
    0,
  );
  const subtotal =
    parts +
    bodyHours * Number(bodyRate || 0) +
    paintHours * (Number(paintRate || 0) + Number(supplyRate || 0));
  const tax = (subtotal * Number(taxRate || 0)) / 100;
  const total = subtotal + tax;
  const updateLine = (index: number, key: keyof Line, value: string) =>
    setLines(
      lines.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    );
  function addPresetLines(items: CollisionPresetItem[]) {
    const presetLines: Line[] = items.map((item) => ({
      section: item.category,
      operation: item.operation,
      description: item.description,
      partNumber: "",
      quantity: "1",
      unitPrice: item.unitPrice ? String(item.unitPrice) : "",
      laborHours: item.laborHours ? String(item.laborHours) : "",
      paintHours: item.paintHours ? String(item.paintHours) : "",
    }));
    const onlyBlankLine =
      lines.length === 1 && !lines[0].description && !lines[0].unitPrice;
    setLines(onlyBlankLine ? presetLines : [...lines, ...presetLines]);
  }
  const updateWalkIn = (key: keyof WalkIn, value: string) =>
    setWalkIn({ ...walkIn, [key]: value });
  async function decodeVin() {
    const vin = walkIn.vin.trim();
    if (!vin) {
      setVinMessage("Enter a VIN first.");
      return;
    }
    setVinLoading(true);
    setVinMessage("");
    try {
      const response = await fetch(`${API_URL}/vin/${encodeURIComponent(vin)}`);
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "VIN could not be decoded");
      setWalkIn({
        ...walkIn,
        vin: result.vin,
        year: result.year,
        make: result.make,
        model: result.model,
        trim: result.trim,
        bodyClass: result.bodyClass,
      });
      setVinMessage(
        `Decoded by NHTSA${result.bodyClass ? ` · ${result.bodyClass}` : ""}`,
      );
    } catch (decodeError) {
      setVinMessage(
        decodeError instanceof Error
          ? decodeError.message
          : "VIN could not be decoded",
      );
    } finally {
      setVinLoading(false);
    }
  }
  async function save() {
    if (!jobId || source === "walkin") {
      setError(
        "Walk-in estimates are print-only until a repair job is created.",
      );
      return;
    }
    try {
      const response = await fetch(`${API_URL}/estimates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}`,
        },
        body: JSON.stringify({
          jobId,
          estimateNumber: number,
          damageSummary: damage,
          taxRate,
          bodyRate,
          paintRate,
          supplyRate,
          lineItems: lines.map((line) => ({
            ...line,
            quantity: Number(line.quantity || 0),
            unitPrice: Number(line.unitPrice || 0),
            laborHours: Number(line.laborHours || 0),
            paintHours: Number(line.paintHours || 0),
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to save estimate");
      setSavedEstimateId(result.id);
      await onSaved();
      setError("Estimate saved successfully.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save estimate",
      );
    }
  }
  async function downloadEstimate() {
    if (!savedEstimateId) { setError("Save this customer estimate first, then download the PDF."); return; }
    setDownloading(true); setError("");
    try {
      const response = await fetch(`${API_URL}/estimates/${savedEstimateId}/pdf`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` } });
      if (!response.ok) throw new Error("Unable to download estimate PDF");
      const blobUrl = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = blobUrl; link.download = `${number || "estimate"}.pdf`; link.click(); URL.revokeObjectURL(blobUrl);
    } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : "Unable to download estimate PDF"); } finally { setDownloading(false); }
  }
  async function deleteEstimate() {
    if (!savedEstimateId || !window.confirm("Delete this saved estimate? This cannot be undone.")) return;
    setError("");
    try {
      await request(`/estimates/${savedEstimateId}`, { method: "DELETE" });
      setSavedEstimateId("");
      await onSaved();
      setError("Saved estimate deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete estimate");
    }
  }
  const field = (key: keyof WalkIn, label: string, placeholder: string) => (
    <label>
      {label}
      <input
        value={walkIn[key]}
        onChange={(event) => updateWalkIn(key, event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
  return (
    <div className="estimate-builder">
      <div className="estimate-builder-toolbar">
        <div>
          <p className="eyebrow">Estimate of record</p>
          <h2>Build repair estimate</h2>
          <p>
            Add customer and vehicle details, then add each repair operation.
          </p>
        </div>
        <div className="estimate-actions">
          <button className="secondary-button" onClick={() => window.print()}>
            Print estimate
          </button>
          <button className="secondary-button" onClick={() => void downloadEstimate()} disabled={downloading || source === "walkin"} title={source === "walkin" ? "Walk-in estimates can be printed until a customer/job is created" : undefined}>
            {downloading ? "Preparing PDF..." : "Download estimate PDF"}
          </button>
          <button
            className="orange-button"
            onClick={save}
            disabled={source === "walkin"}
          >
            Save estimate
          </button>
          {savedEstimateId && source !== "walkin" && <button className="danger-button" onClick={() => void deleteEstimate()}>Delete saved estimate</button>}
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <section className="estimate-controls">
        <div className="estimate-source-control">
          <span>Customer &amp; vehicle</span>
          <button className="source-button" onClick={() => setSourceOpen(true)}>
            {source === "walkin"
              ? customerName
              : selectedJob
                ? `${selectedJob.customer.firstName} ${selectedJob.customer.lastName}`
                : "Choose existing or walk-in"}
            <b>Change</b>
          </button>
        </div>
        <label>
          Estimate number
          <input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="EST-2026-001"
          />
        </label>
        <label>
          Tax %
          <input
            type="number"
            step="0.001"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
          />
        </label>
        <label>
          Body labor / hr
          <input
            type="number"
            value={bodyRate}
            onChange={(event) => setBodyRate(event.target.value)}
          />
        </label>
        <label>
          Paint labor / hr
          <input
            type="number"
            value={paintRate}
            onChange={(event) => setPaintRate(event.target.value)}
          />
        </label>
        <label>
          Paint supplies / hr
          <input
            type="number"
            value={supplyRate}
            onChange={(event) => setSupplyRate(event.target.value)}
          />
        </label>
        <label className="wide-control">
          Damage summary
          <input
            value={damage}
            onChange={(event) => setDamage(event.target.value)}
            placeholder="Front Door, Rear Door, Quarter Panel (Left Side) & Rear Bumper"
          />
        </label>
      </section>
      {sourceOpen && (
        <div className="modal-backdrop" onClick={() => setSourceOpen(false)}>
          <section
            className="modal source-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Estimate identity</p>
                <h2>Customer &amp; vehicle details</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setSourceOpen(false)}
              >
                x
              </button>
            </div>
            <div className="source-tabs">
              <button
                type="button"
                className={
                  source === "existing" ? "source-tab active" : "source-tab"
                }
                onClick={() => setSource("existing")}
              >
                Existing customer
              </button>
              <button
                type="button"
                className={
                  source === "walkin" ? "source-tab active" : "source-tab"
                }
                onClick={() => setSource("walkin")}
              >
                Walk-in estimate
              </button>
            </div>
            {source === "existing" ? (
              <label>
                Customer and repair job
                <select
                  value={jobId}
                  onChange={(event) => setJobId(event.target.value)}
                >
                  <option value="">Select customer and vehicle</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.customer.firstName} {job.customer.lastName} ·{" "}
                      {job.jobNumber}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="walkin-fields">
                <p className="form-section-label">CUSTOMER</p>
                {field("customerName", "Customer name", "Ahmed, Farhan S.")}
                {field("address", "Street address", "1409 79th St")}
                <div className="form-row">
                  {field("city", "City", "North Bergen")}
                  {field("state", "State", "NJ")}
                  {field("zip", "ZIP", "07047")}
                </div>
                <p className="form-section-label">VEHICLE</p>
                <div className="vin-row">
                  {field("vin", "VIN", "4T1G11AK7MU425615")}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={decodeVin}
                    disabled={vinLoading}
                  >
                    {vinLoading ? "Decoding..." : "Decode VIN"}
                  </button>
                </div>
                {vinMessage && (
                  <small
                    className={
                      vinMessage.startsWith("Decoded")
                        ? "vin-success"
                        : "vin-error"
                    }
                  >
                    {vinMessage}
                  </small>
                )}
                <div className="form-row">
                  {field("year", "Year", "2021")}
                  {field("make", "Make", "TOYOTA")}
                  {field("model", "Model", "Camry")}
                </div>
                <div className="form-row">
                  {field("trim", "Trim / body", "SE 4D SDN")}
                  {field("license", "License", "P83SJP")}
                  {field("vehicleState", "State", "NJ")}
                </div>
                {field("registration", "Registration good thru", "05/2027")}
              </div>
            )}
            <button
              type="button"
              className="orange-button"
              onClick={() => setSourceOpen(false)}
            >
              Use these details
            </button>
          </section>
        </div>
      )}
      <section className="estimate-editor surface">
        <div className="surface-heading">
          <div>
            <h2>Repair operations</h2>
            <p>Use sections to group the estimate like the sample.</p>
          </div>
          <div className="estimate-actions">
            <button
              className="secondary-button"
              onClick={() => setPresetsOpen(true)}
            >
              Select from line item library
            </button>
            <button
              className="secondary-button"
              onClick={() => setLines([...lines, newLine()])}
            >
              + Add line item
            </button>
          </div>
        </div>
        <LineItemPresetPicker
          open={presetsOpen}
          onClose={() => setPresetsOpen(false)}
          onAdd={addPresetLines}
        />
        <div className="estimate-line-table">
          <div className="estimate-line-head">
            <span>Section</span>
            <span>Op</span>
            <span>Description</span>
            <span>Part #</span>
            <span>Qty</span>
            <span>Price</span>
            <span>Labor</span>
            <span>Paint</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <div className="estimate-line" key={index}>
              <input
                value={line.section}
                onChange={(event) =>
                  updateLine(index, "section", event.target.value)
                }
              />
              <input
                value={line.operation}
                onChange={(event) =>
                  updateLine(index, "operation", event.target.value)
                }
              />
              <input
                value={line.description}
                onChange={(event) =>
                  updateLine(index, "description", event.target.value)
                }
                placeholder="Repair description"
              />
              <input
                value={line.partNumber}
                onChange={(event) =>
                  updateLine(index, "partNumber", event.target.value)
                }
              />
              <input
                type="number"
                value={line.quantity}
                onChange={(event) =>
                  updateLine(index, "quantity", event.target.value)
                }
              />
              <input
                type="number"
                step="0.01"
                value={line.unitPrice}
                onChange={(event) =>
                  updateLine(index, "unitPrice", event.target.value)
                }
              />
              <input
                type="number"
                step="0.01"
                value={line.laborHours}
                onChange={(event) =>
                  updateLine(index, "laborHours", event.target.value)
                }
              />
              <input
                type="number"
                step="0.01"
                value={line.paintHours}
                onChange={(event) =>
                  updateLine(index, "paintHours", event.target.value)
                }
              />
              <button
                className="remove-line"
                onClick={() =>
                  setLines(lines.filter((_, lineIndex) => lineIndex !== index))
                }
              >
                x
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="estimate-preview">
        <div className="estimate-paper">
          <header className="paper-header">
            <h1>MASTERCRAFT AUTO REPAIR &amp; COLLISION</h1>
            <p>
              38-21 23rd Street, Long Island City, NY 11101 | Tel: 718-578-4563
              / 718-603-0412 | shop@mastercraftautony.com
            </p>
            <p>
              www.mastercraftautony.com | Recognized By All Insurance Companies
            </p>
          </header>
          <h2 className="paper-title">ESTIMATE OF RECORD</h2>
          <div className="paper-meta">
            <span>Estimate No: {number || "DRAFT"}</span>
            <span>Date Issued: {new Date().toLocaleDateString()}</span>
          </div>
          <div className="paper-info">
            <div>
              <strong>CUSTOMER</strong>
              <span>{customerName}</span>
              <span className="paper-address">{customerAddress}</span>
            </div>
            <div>
              <strong>VEHICLE</strong>
              <span>{vehicleName}</span>
              <span>
                VIN: {vehicleVin || "N/A"} | License: {vehicleLicense || "N/A"}
                {source === "walkin" && walkIn.registration
                  ? ` | Registration good thru: ${walkIn.registration}`
                  : ""}
              </span>
            </div>
          </div>
          {damage && (
            <p className="paper-damage">
              <strong>DAMAGE:</strong> {damage}
            </p>
          )}
          <table className="paper-lines">
            <thead>
              <tr>
                <th>Section / Operation</th>
                <th>Description</th>
                <th>Part Number</th>
                <th>Qty</th>
                <th>Price $</th>
                <th>Labor</th>
                <th>Paint</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    {line.section}
                    <small>{line.operation}</small>
                  </td>
                  <td>{line.description || "—"}</td>
                  <td>{line.partNumber || "—"}</td>
                  <td>{line.quantity || "—"}</td>
                  <td>
                    {line.unitPrice ? money(Number(line.unitPrice)) : "—"}
                  </td>
                  <td>{line.laborHours || "—"}</td>
                  <td>{line.paintHours || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="paper-totals">
            <div>
              Parts <strong>{money(parts)}</strong>
            </div>
            <div>
              Body Labor ({bodyHours.toFixed(1)} hrs @ {money(Number(bodyRate))}{" "}
              / hr) <strong>{money(bodyHours * Number(bodyRate))}</strong>
            </div>
            <div>
              Paint Labor ({paintHours.toFixed(1)} hrs @{" "}
              {money(Number(paintRate))} / hr){" "}
              <strong>{money(paintHours * Number(paintRate))}</strong>
            </div>
            <div>
              Paint Supplies ({paintHours.toFixed(1)} hrs @{" "}
              {money(Number(supplyRate))} / hr){" "}
              <strong>{money(paintHours * Number(supplyRate))}</strong>
            </div>
            <div className="paper-subtotal">
              Subtotal <strong>{money(subtotal)}</strong>
            </div>
            <div>
              Sales Tax ({taxRate}%) <strong>{money(tax)}</strong>
            </div>
            <div className="paper-total">
              TOTAL COST OF REPAIRS <strong>{money(total)}</strong>
            </div>
          </div>
          <p className="paper-disclaimer">
            This is an estimate only. Final charges may vary based on additional
            damage found during teardown, parts availability, or supplemental
            findings. This estimate is valid for 30 days from the date above.
          </p>
          <div className="signatures">
            <span>Customer Signature: __________________________</span>
            <span>Date: ______________</span>
          </div>
          <footer>
            THANK YOU FOR CHOOSING MASTERCRAFT AUTO REPAIR AND COLLISION!
            <small>
              38-21 23rd St, Long Island City, NY 11101 · 718-578-4563 ·
              www.mastercraftautony.com
            </small>
          </footer>
        </div>
      </section>
    </div>
  );
}
