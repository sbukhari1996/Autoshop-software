import React from "react";
import "./TowingReceiptView.css";
import { RECEIPT_LABELS, ReceiptKind, ReceiptValues, downloadHtml, renderSavedReceipt } from "./receiptFrame";
import type { RequestFn } from "./ReceiptToolbar";

type ReceiptRow = {
  id: string;
  kind: ReceiptKind;
  title: string;
  customerName: string | null;
  vehicleLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

const formatDate = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

// Every saved towing and storage receipt, with open, download and delete.
export function SavedReceiptsView({
  request,
  onOpen,
}: {
  request: RequestFn;
  onOpen: (kind: ReceiptKind, id: string) => void;
}) {
  const [rows, setRows] = React.useState<ReceiptRow[]>([]);
  const [filter, setFilter] = React.useState<"all" | ReceiptKind>("all");
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await request<ReceiptRow[]>("/receipts"));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load saved receipts");
    } finally {
      setLoading(false);
    }
  }, [request]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function download(row: ReceiptRow) {
    setBusyId(row.id);
    setError("");
    try {
      const full = await request<ReceiptRow & { values: ReceiptValues }>(`/receipts/${row.id}`);
      const html = await renderSavedReceipt(row.kind, full.values);
      downloadHtml(html, row.title);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download the receipt");
    } finally {
      setBusyId("");
    }
  }

  async function remove(row: ReceiptRow) {
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setBusyId(row.id);
    setError("");
    try {
      await request(`/receipts/${row.id}`, { method: "DELETE" });
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the receipt");
    } finally {
      setBusyId("");
    }
  }

  const shown = filter === "all" ? rows : rows.filter((row) => row.kind === filter);

  return (
    <section className="tr-workspace">
      <div className="tr-toolbar surface">
        <div className="tr-toolbar-head">
          <div>
            <p className="eyebrow">Saved receipts</p>
            <h2>Towing and storage receipts</h2>
            <p className="subheading">Every receipt you saved. Open one to edit it, download it as a file, or delete it.</p>
          </div>
        </div>
        <div className="tr-controls">
          <div className="tr-field">
            <span>Show</span>
            <div className="tr-segment" role="group" aria-label="Receipt type">
              {(["all", "towing", "storage"] as const).map((option) => (
                <button key={option} type="button" className={filter === option ? "active" : ""} aria-pressed={filter === option} onClick={() => setFilter(option)}>
                  {option === "all" ? "All" : RECEIPT_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
        </div>
        {error && <div className="sr-banner sr-warn" role="alert">{error}</div>}
      </div>

      <div className="records-section">
        <div className="records-section-heading">
          <h4>Saved receipts</h4>
          <span>{shown.length} {shown.length === 1 ? "receipt" : "receipts"}</span>
        </div>
        {loading ? (
          <p className="records-muted">Loading saved receipts...</p>
        ) : shown.length ? (
          <div className="records-list">
            {shown.map((row) => (
              <div className="record-row" key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <small>
                    {RECEIPT_LABELS[row.kind]} receipt
                    {row.customerName ? ` · ${row.customerName}` : ""}
                    {row.vehicleLabel ? ` · ${row.vehicleLabel}` : ""}
                  </small>
                </div>
                <span>{RECEIPT_LABELS[row.kind]}</span>
                <time>Updated {formatDate(row.updatedAt)}</time>
                <div className="document-actions">
                  <button type="button" onClick={() => onOpen(row.kind, row.id)} disabled={busyId === row.id}>Open and edit</button>
                  <button type="button" onClick={() => void download(row)} disabled={busyId === row.id}>Download</button>
                  <button type="button" className="danger-button" onClick={() => void remove(row)} disabled={busyId === row.id}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="records-muted">No saved receipts yet. Create one in Towing Receipts or Storage Receipts and choose Save receipt.</p>
        )}
      </div>
    </section>
  );
}
