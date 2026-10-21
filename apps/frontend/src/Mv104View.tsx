import React from "react";
import { Mv104Form } from "./Mv104Form";

// Reserved id the API uses for a blank MV-104 that is not tied to a claim.
const STANDALONE_ID = "standalone";

type ClaimOption = {
  id: string;
  claimNumber: string | null;
  insuranceCompany: string | null;
  customer: { firstName: string; lastName: string } | null;
};

function claimLabel(claim: ClaimOption) {
  const name = claim.customer ? `${claim.customer.firstName} ${claim.customer.lastName}`.trim() : "Customer";
  const insurer = claim.insuranceCompany ? ` · ${claim.insuranceCompany}` : "";
  return `${claim.claimNumber || "No claim number"} · ${name}${insurer}`;
}

export function Mv104View({ claims, apiUrl }: { claims: ClaimOption[]; apiUrl: string }) {
  const [choice, setChoice] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  return (
    <section className="tr-workspace">
      <div className="tr-toolbar surface">
        <div className="tr-toolbar-head">
          <div>
            <p className="eyebrow">Crash reports</p>
            <h2>MV-104 crash report</h2>
            <p className="subheading">
              Pick a claim to fill its MV-104 from your records, or open a blank standalone form for any crash report.
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
              <button type="button" disabled={!choice} onClick={() => setOpenId(choice)}>
                Open claim MV-104
              </button>
              <button type="button" onClick={() => setOpenId(STANDALONE_ID)}>
                Standalone form
              </button>
            </div>
          </div>
        </div>
      </div>
      {openId && <Mv104Form claimId={openId} apiUrl={apiUrl} onClose={() => setOpenId(null)} />}
    </section>
  );
}
