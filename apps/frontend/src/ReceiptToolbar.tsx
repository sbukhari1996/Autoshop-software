import React from "react";
import { collectValues, downloadHtml, RECEIPT_LABELS, ReceiptKind, ReceiptValues, sendToFrame, snapshotHtml } from "./receiptFrame";

export type SavedRef = { id: string; title: string };
export type RequestFn = <T>(path: string, options?: RequestInit) => Promise<T>;

// Both receipt templates name the customer and vehicle fields "cname" and "veh".
function describe(values: ReceiptValues) {
  return { customerName: String(values.cname || "").trim(), vehicleLabel: String(values.veh || "").trim() };
}

function autoName(kind: ReceiptKind, values: ReceiptValues) {
  const { customerName } = describe(values);
  return `${RECEIPT_LABELS[kind]} receipt · ${customerName || "No customer"} · ${new Date().toLocaleDateString("en-US")}`;
}

// Save, download, print and new-receipt controls shared by the towing and storage receipt windows.
export function ReceiptToolbar({
  kind,
  frameRef,
  saved,
  request,
  onSaved,
  onNew,
}: {
  kind: ReceiptKind;
  frameRef: React.RefObject<HTMLIFrameElement>;
  saved: SavedRef | null;
  request: RequestFn;
  onSaved: (saved: SavedRef) => void;
  onNew: () => void;
}) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  // A saved receipt shows its own name; a new receipt starts blank and gets a generated name.
  React.useEffect(() => {
    setName(saved?.title || "");
  }, [saved?.id]);

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : failure });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    return run(async () => {
      if (!frameRef.current) return;
      const values = await collectValues(frameRef.current);
      const title = name.trim() || autoName(kind, values);
      const payload = { title, ...describe(values), values };
      const row = saved
        ? await request<SavedRef>(`/receipts/${saved.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await request<SavedRef>("/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...payload }) });
      onSaved({ id: row.id, title: row.title });
      setName(row.title);
      setMessage({ tone: "ok", text: saved ? "Changes saved." : "Saved to Saved Receipts." });
    }, "Unable to save the receipt");
  }

  function download() {
    return run(async () => {
      if (!frameRef.current) return;
      const values = await collectValues(frameRef.current);
      const html = await snapshotHtml(frameRef.current, kind);
      downloadHtml(html, name.trim() || autoName(kind, values));
    }, "Unable to download the receipt");
  }

  return (
    <>
      <div className="tr-controls receipt-save-row">
        <label className="tr-field">
          <span>Receipt name</span>
          <input type="text" value={name} placeholder="Leave blank to name it automatically" maxLength={200} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="tr-field">
          <span>{saved ? "Editing a saved receipt" : "New receipt"}</span>
          <div className="document-actions">
            <button type="button" className="orange-button" disabled={busy} onClick={() => void save()}>
              {busy ? "Working..." : saved ? "Save changes" : "Save receipt"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void download()}>Download</button>
            <button type="button" className="secondary-button" onClick={() => sendToFrame(frameRef.current, { type: `${kind}-print` })}>Print</button>
            {saved && <button type="button" className="secondary-button" disabled={busy} onClick={onNew}>New receipt</button>}
          </div>
        </div>
      </div>
      {message && <div className={`sr-banner ${message.tone === "ok" ? "sr-ok" : "sr-warn"}`} role="status">{message.text}</div>}
    </>
  );
}
