import React from "react";
import receiptHtml from "./assets/towing-receipt.html?raw";
import "./TowingReceiptView.css";

type CustomerRecord = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

type VehicleRecord = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  color?: string | null;
  vin: string | null;
  licensePlate: string | null;
  licenseState?: string | null;
  customer: CustomerRecord;
};

type BillTo = "shop" | "customer";

type PrefillValues = {
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  vehicle?: string;
  vin?: string;
  plate?: string;
  billTo?: BillTo;
};

function customerAddress(customer: CustomerRecord) {
  const cityLine = [customer.city, [customer.state, customer.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [customer.address, cityLine].filter(Boolean).join(", ");
}

function customerValues(customer: CustomerRecord): PrefillValues {
  return {
    customerName: `${customer.firstName} ${customer.lastName}`.trim(),
    customerPhone: customer.phone || "",
    customerAddress: customerAddress(customer),
  };
}

function vehicleValues(vehicle: VehicleRecord): PrefillValues {
  return {
    vehicle: [vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" "),
    vin: vehicle.vin ? vehicle.vin.slice(-6).toUpperCase() : "",
    plate: [vehicle.licensePlate, vehicle.licenseState].filter(Boolean).join(" / "),
  };
}

function vehicleLabel(vehicle: VehicleRecord) {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle";
  const plate = vehicle.licensePlate ? ` · ${vehicle.licensePlate}` : "";
  return `${name}${plate} — ${vehicle.customer.firstName} ${vehicle.customer.lastName}`;
}

export function TowingReceiptView({ customers, vehicles }: { customers: CustomerRecord[]; vehicles: VehicleRecord[] }) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [customerId, setCustomerId] = React.useState("");
  const [vehicleId, setVehicleId] = React.useState("");
  const [billTo, setBillTo] = React.useState<BillTo>("shop");

  const customer = customers.find((item) => item.id === customerId) || null;
  const vehicle = vehicles.find((item) => item.id === vehicleId) || null;
  const visibleVehicles = customerId ? vehicles.filter((item) => item.customer?.id === customerId) : vehicles;

  const post = (message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(message, "*");
  };
  const sendPrefill = (values: PrefillValues) => post({ type: "towing-prefill", values });

  function chooseCustomer(id: string) {
    setCustomerId(id);
    if (vehicle && vehicle.customer?.id !== id) setVehicleId("");
    const next = customers.find((item) => item.id === id);
    if (next) sendPrefill({ ...customerValues(next), billTo });
  }

  function chooseVehicle(id: string) {
    setVehicleId(id);
    const next = vehicles.find((item) => item.id === id);
    if (!next) return;
    if (next.customer?.id !== customerId) {
      setCustomerId(next.customer.id);
      sendPrefill({ ...customerValues(next.customer), billTo });
    }
    sendPrefill(vehicleValues(next));
  }

  function chooseBillTo(next: BillTo) {
    setBillTo(next);
    const values: PrefillValues = { billTo: next };
    if (customer) Object.assign(values, customerValues(customer));
    sendPrefill(values);
  }

  // Once the receipt has loaded, send whatever is already selected.
  function handleFrameLoad() {
    const values: PrefillValues = { billTo };
    if (customer) Object.assign(values, customerValues(customer));
    if (vehicle) Object.assign(values, vehicleValues(vehicle));
    sendPrefill(values);
  }

  return (
    <section className="tr-workspace">
      <div className="tr-toolbar surface">
        <div className="tr-toolbar-head">
          <div>
            <p className="eyebrow">Towing receipts</p>
            <h2>Print a towing receipt</h2>
            <p className="subheading">
              Pull the customer and vehicle from your records, or choose "Enter manually" and type them on the receipt.
              Everything on the receipt stays editable.
            </p>
          </div>
          <button type="button" className="orange-button" onClick={() => post({ type: "towing-print" })}>
            Print receipt
          </button>
        </div>
        <div className="tr-controls">
          <label className="tr-field">
            <span>Customer</span>
            <select value={customerId} onChange={(event) => chooseCustomer(event.target.value)}>
              <option value="">Enter manually</option>
              {customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.firstName} {item.lastName}
                  {item.phone ? ` · ${item.phone}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="tr-field">
            <span>Vehicle</span>
            <select value={vehicleId} onChange={(event) => chooseVehicle(event.target.value)}>
              <option value="">Enter manually</option>
              {visibleVehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {vehicleLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <div className="tr-field">
            <span>Bill to</span>
            <div className="tr-segment" role="group" aria-label="Bill to">
              <button type="button" className={billTo === "shop" ? "active" : ""} aria-pressed={billTo === "shop"} onClick={() => chooseBillTo("shop")}>
                Shop
              </button>
              <button type="button" className={billTo === "customer" ? "active" : ""} aria-pressed={billTo === "customer"} onClick={() => chooseBillTo("customer")}>
                Customer
              </button>
            </div>
          </div>
        </div>
      </div>
      <iframe
        ref={frameRef}
        className="tr-frame"
        title="Towing receipt"
        srcDoc={receiptHtml}
        sandbox="allow-scripts allow-modals"
        onLoad={handleFrameLoad}
      />
    </section>
  );
}
