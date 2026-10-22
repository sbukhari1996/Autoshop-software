import React from "react";
import { Mv104Form, STATUS_LABELS, type SavedForm } from "./Mv104Form";

// Reserved id the API uses for a blank MV-104 that is not tied to a claim.
const STANDALONE_ID = "standalone";

type ClaimOption = {
  id: string;
  claimNumber: string | null;
  insuranceCompany: string | null;
  customer: { firstName: string; lastName: string } | null;
};

type FormSummary = {
  id: string;
  claimId: string | null;
  title: string;
  status: string;
  signerName: string | null;
  updatedAt: string;
};

function claimLabel(claim: ClaimOption) {
  const name = claim.customer ? `${claim.customer.firstName} ${claim.customer.lastName}`.trim() : "Customer";
  const insurer = claim.insuranceCompany ? ` · ${claim.insuranceCompany}` : "";
  return `${claim.claimNumber || "No claim number"} · ${name}${insurer}`;
}

export function Mv104View({ claims, apiUrl }: { claims: ClaimOption[]; apiUrl: string }) {
  const [choice, setChoice] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [savedOpen, setSavedOpen] = React.useState<SavedForm | null>(null);
  const [forms, setForms] = React.useState<FormSummary[]>([]);
  const [listError, setListError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` });

  React.useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/mv104-forms`, { headers: authHeader() })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Unable to load saved MV-104s");
        return body as FormSummary[];
      })
      .then((rows) => { if (!cancelled) { setForms(rows); setListError(""); } })
      .catch((e: Error) => { if (!cancelled) setListError(e.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, refreshKey]);

  async function openSaved(id: string) {
    setListError("");
    try {
      const response = await fetch(`${apiUrl}/mv104-forms/${id}`, { headers: authHeader() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to open MV-104");
      setSavedOpen(body as SavedForm);
      setOpenId(body.claimId || STANDALONE_ID);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Unable to open MV-104");
    }
  }

  function closeForm() {
    setOpenId(null);
    setSavedOpen(null);
  }

  const claimName = (id: string | null) => {
    if (!id) return "Standalone";
    const claim = claims.find((item) => item.id === id);
    return claim ? claimLabel(claim) : "Claim";
  };

  return (
    <section className="tr-workspace">
      <div className="tr-toolbar surface">
        <div className="tr-toolbar-head">
          <div>
            <p className="eyebrow">Crash reports</p>
            <h2>MV-104 crash report</h2>
            <p className="subheading">
              Pick a claim to fill its MV-104 from your records, or open a blank standalone form. Save drafts to edit later, and send them to the signer.
            </p>
          </div>
        </div>
        <div className="tr-controls">
          <label className="tr-field">
            <span>Claim</span>
            <select value={choice} onChange={(event) => setChoice(event.target.value)}>
              <option value="">Choose a claim</option>
              {claims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claimLabel(claim)}
                </option>
              ))}
            </select>
          </label>
          <div className="tr-field">
            <span>Open</span>
            <div className="tr-segment" role="group" aria-label="Open MV-104">
              <button type="button" disabled={!choice} onClick={() => { setSavedOpen(null); setOpenId(choice); }}>
                Open claim MV-104
              </button>
              <button type="button" onClick={() => { setSavedOpen(null); setOpenId(STANDALONE_ID); }}>
                Standalone form
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="tr-toolbar surface">
        <h3>Saved MV-104s</h3>
        {listError && <p className="mv-error">{listError}</p>}
        {forms.length === 0 ? (
          <p className="mv-note">No saved MV-104s yet. Use Save draft in the form to keep one here.</p>
        ) : (
          <ul className="mv-saved-list">
            {forms.map((form) => (
              <li key={form.id}>
                <div>
                  <strong>{form.title}</strong>
                  <span className="mv-note">
                    {" "}· {claimName(form.claimId)} · {STATUS_LABELS[form.status] || form.status} · updated {new Date(form.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <button type="button" onClick={() => openSaved(form.id)}>
                  {form.status === "draft" || form.status === "send_failed" ? "Edit" : "View"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openId && (
        <Mv104Form
          key={savedOpen?.id ?? openId}
          claimId={openId}
          apiUrl={apiUrl}
          onClose={closeForm}
          saved={savedOpen}
          onSaved={() => setRefreshKey((key) => key + 1)}
        />
      )}
    </section>
  );
}
