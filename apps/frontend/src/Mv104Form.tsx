import React from "react";
import "./Mv104Form.css";

// Mirrors the server's Mv104Input (apps/api/src/mv104/mv104Form.ts). Field names match the PDF's sections.
type Party = Record<string, string>;
type Person = { name: string; unit: string; position: string; safety: string; age: string; sex: string; injury: string; seriousInjuries: string; deathDate: string };
type Option = { value: string; label: string };
type Codes = Record<"trafficControl" | "roadwaySurface" | "direction" | "preCrash" | "typeOfCrash" | "unit" | "position" | "safety" | "injury" | "diagram", Option[]>;
type Mv104Input = {
  crash: Record<string, string | boolean>;
  location: Record<string, string | boolean | string[]>;
  partA: Party;
  partB: Party;
  otherPartyTypes: string[];
  persons: Person[];
  signing: Record<string, string | boolean>;
};
type Defaults = { input: Mv104Input; codes: Codes };
export type SavedForm = { id: string; title: string; status: string; claimId: string | null; signerName: string | null; signerEmail: string | null; input: Mv104Input };
const EDITABLE_STATUSES = ["draft", "send_failed"];
export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sending: "Sending…",
  sent: "Sent, waiting for the signer",
  signed: "Signed",
  send_failed: "Send failed, you can try again",
  send_unknown: "Outcome unknown, check Documenso before retrying",
};

const STATES = ["NY", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WV", "WI", "WY"];
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS: Option[] = Array.from({ length: 12 }, (_, i) => ({ value: pad(i + 1), label: pad(i + 1) }));
const DAYS: Option[] = Array.from({ length: 31 }, (_, i) => ({ value: pad(i + 1), label: pad(i + 1) }));
const STATE_OPTIONS: Option[] = [{ value: "", label: "—" }, ...STATES.map((s) => ({ value: s, label: s }))];
const withBlank = (options: Option[]): Option[] => [{ value: "", label: "— choose —" }, ...options];

function Field({ label, value, onChange, maxLength, wide, type = "text" }: { label: string; value: string; onChange: (v: string) => void; maxLength?: number; wide?: boolean; type?: string }) {
  return (
    <label className={`mv-field ${wide ? "mv-wide" : ""}`}>
      <span>{label}</span>
      <input type={type} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Area({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (v: string) => void; maxLength?: number }) {
  return (
    <label className="mv-field mv-wide">
      <span>{label}{maxLength ? ` (max ${maxLength})` : ""}</span>
      <textarea rows={3} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Select({ label, value, options, onChange, wide }: { label: string; value: string; options: Option[]; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className={`mv-field ${wide ? "mv-wide" : ""}`}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.value && o.label !== o.value ? `${o.value} ${o.label}` : o.label}</option>)}
      </select>
    </label>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: string; onChange: (v: "Yes" | "No" | "") => void }) {
  return (
    <fieldset className="mv-yesno">
      <legend>{label}</legend>
      {(["Yes", "No"] as const).map((choice) => (
        <label key={choice}><input type="radio" checked={value === choice} onChange={() => onChange(choice)} /> {choice}</label>
      ))}
      <label><input type="radio" checked={value === ""} onChange={() => onChange("")} /> Not answered</label>
    </fieldset>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mv-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function Mv104Form({ claimId, apiUrl, onClose, saved, onSaved }: { claimId: string; apiUrl: string; onClose: () => void; saved?: SavedForm | null; onSaved?: () => void }) {
  const [defaults, setDefaults] = React.useState<Defaults | null>(null);
  const [input, setInput] = React.useState<Mv104Input | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loadError, setLoadError] = React.useState("");
  const [formId, setFormId] = React.useState<string | null>(saved?.id ?? null);
  const [status, setStatus] = React.useState<string>(saved?.status ?? "draft");
  const [notice, setNotice] = React.useState("");
  const [signerName, setSignerName] = React.useState(saved?.signerName ?? "");
  const [signerEmail, setSignerEmail] = React.useState(saved?.signerEmail ?? "");

  React.useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("repairos_token") || "";
    fetch(`${apiUrl}/claims/${claimId}/mv104/defaults`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error || "Unable to load MV-104"); return body as Defaults; })
      .then((data) => { if (!cancelled) { setDefaults(data); setInput(saved ? saved.input : data.input); } })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [apiUrl, claimId]);

  if (loadError) return <Shell onClose={onClose}><p className="mv-error">{loadError}</p></Shell>;
  if (!defaults || !input) return <Shell onClose={onClose}><p>Loading MV-104…</p></Shell>;
  const codes = defaults.codes;

  const setCrash = (key: string, value: string | boolean) => setInput({ ...input, crash: { ...input.crash, [key]: value } });
  const setLoc = (key: string, value: string | boolean | string[]) => setInput({ ...input, location: { ...input.location, [key]: value } });
  const setParty = (part: "partA" | "partB", key: string, value: string) => setInput({ ...input, [part]: { ...input[part], [key]: value } });
  const setSigning = (key: string, value: string | boolean) => setInput({ ...input, signing: { ...input.signing, [key]: value } });
  const setPerson = (index: number, key: keyof Person, value: string) => {
    const persons = input.persons.map((p, i) => (i === index ? { ...p, [key]: value } : p));
    setInput({ ...input, persons });
  };
  const addPerson = () => input.persons.length < 5 && setInput({ ...input, persons: [...input.persons, { name: "", unit: "1.", position: "", safety: "", age: "", sex: "", injury: "", seriousInjuries: "", deathDate: "" }] });
  const removePerson = (index: number) => setInput({ ...input, persons: input.persons.filter((_, i) => i !== index) });
  const toggleList = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const c = input.crash as Record<string, string>;
  const cb = input.crash as Record<string, boolean>;
  const l = input.location as Record<string, string>;
  const lb = input.location as Record<string, boolean>;

  const locked = formId !== null && !EDITABLE_STATUSES.includes(status);

  function authHeaders(json = true): Record<string, string> {
    const token = localStorage.getItem("repairos_token") || "";
    return json ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}` };
  }
  async function readJson(response: Response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (HTTP ${response.status})`);
    return body;
  }
  const failure = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  // Creates the saved MV-104 on first save, then updates it.
  async function saveDraft(): Promise<string | null> {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = formId
        ? await fetch(`${apiUrl}/mv104-forms/${formId}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ input }) })
        : await fetch(`${apiUrl}/mv104-forms`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ claimId, input }) });
      const body = await readJson(response);
      setFormId(body.id);
      setNotice("Draft saved. Reopen it from the MV-104 page to keep editing.");
      onSaved?.();
      return body.id as string;
    } catch (e) {
      setError(failure(e, "Unable to save the draft"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function sendForSignature() {
    if (!signerName.trim() || !signerEmail.trim()) { setError("Enter the signer's name and email."); return; }
    const id = formId ?? (await saveDraft());
    if (!id) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${apiUrl}/mv104-forms/${id}/send`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: signerName.trim(), email: signerEmail.trim() }),
      });
      const body = await readJson(response);
      setStatus(body.status);
      setNotice("Sent for signature. Use Check status to see when it is signed.");
      onSaved?.();
    } catch (e) {
      setError(failure(e, "Unable to send for signature"));
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!formId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = await readJson(await fetch(`${apiUrl}/mv104-forms/${formId}/refresh`, { method: "POST", headers: authHeaders() }));
      setStatus(body.status);
      setNotice(body.status === "signed" ? "Signed. You can download the signed copy." : "Not signed yet.");
      onSaved?.();
    } catch (e) {
      setError(failure(e, "Unable to check status"));
    } finally {
      setBusy(false);
    }
  }

  async function downloadSigned() {
    if (!formId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/mv104-forms/${formId}/signed.pdf`, { headers: authHeaders(false) });
      if (!response.ok) await readJson(response);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "MV-104-signed.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(failure(e, "Unable to download the signed copy"));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true); setError("");
    try {
      const token = localStorage.getItem("repairos_token") || "";
      const response = await fetch(`${apiUrl}/claims/${claimId}/mv104.pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Unable to generate MV-104 (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const named = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "");
      const a = document.createElement("a");
      a.href = url;
      a.download = named ? named[1] : `MV-104-${claimId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate MV-104");
    } finally {
      setBusy(false);
    }
  }

  const partFields = (part: "partA" | "partB", title: string) => {
    const p = input[part];
    return (
      <section className="mv-section">
        <h3>{title}</h3>
        <h4>Driver</h4>
        <div className="mv-grid">
          <Field label="Driver name (Last, First, M.I.)" value={p.driverName} onChange={(v) => setParty(part, "driverName", v)} maxLength={80} wide />
          <Field label="Driver license #" value={p.dlNumber} onChange={(v) => setParty(part, "dlNumber", v)} />
          <Select label="License state" value={p.dlState} options={STATE_OPTIONS} onChange={(v) => setParty(part, "dlState", v)} />
          <Field label="Address" value={p.address} onChange={(v) => setParty(part, "address", v)} wide />
          <Field label="City" value={p.city} onChange={(v) => setParty(part, "city", v)} />
          <Select label="State" value={p.state} options={STATE_OPTIONS} onChange={(v) => setParty(part, "state", v)} />
          <Field label="Zip" value={p.zip} onChange={(v) => setParty(part, "zip", v)} maxLength={10} />
          <Select label="DOB month" value={p.dobMonth} options={withBlank(MONTHS)} onChange={(v) => setParty(part, "dobMonth", v)} />
          <Select label="DOB day" value={p.dobDay} options={withBlank(DAYS)} onChange={(v) => setParty(part, "dobDay", v)} />
          <Field label="DOB year" value={p.dobYear} onChange={(v) => setParty(part, "dobYear", v)} maxLength={4} />
          <Field label="Sex (M/F/X)" value={p.sex} onChange={(v) => setParty(part, "sex", v.toUpperCase())} maxLength={1} />
          <Field label="People in vehicle" value={p.peopleInVehicle} onChange={(v) => setParty(part, "peopleInVehicle", v)} maxLength={2} />
        </div>
        <h4>Registrant and vehicle</h4>
        <div className="mv-grid">
          <Field label="Registrant name (as on registration)" value={p.registrantName} onChange={(v) => setParty(part, "registrantName", v)} maxLength={80} wide />
          <Field label="Registrant address" value={p.regAddress} onChange={(v) => setParty(part, "regAddress", v)} wide />
          <Field label="Registrant city" value={p.regCity} onChange={(v) => setParty(part, "regCity", v)} />
          <Select label="Registrant state" value={p.regState} options={STATE_OPTIONS} onChange={(v) => setParty(part, "regState", v)} />
          <Field label="Registrant zip" value={p.regZip} onChange={(v) => setParty(part, "regZip", v)} maxLength={10} />
          <Field label="Plate #" value={p.plate} onChange={(v) => setParty(part, "plate", v.toUpperCase())} />
          <Select label="Plate state" value={p.plateState} options={STATE_OPTIONS} onChange={(v) => setParty(part, "plateState", v)} />
          <Field label="Year / make / model" value={p.yearMakeModel} onChange={(v) => setParty(part, "yearMakeModel", v)} wide />
          <Field label="Vehicle type (e.g. PAS)" value={p.vehicleType} onChange={(v) => setParty(part, "vehicleType", v.toUpperCase())} />
          <Field label="VIN" value={p.vin} onChange={(v) => setParty(part, "vin", v.toUpperCase())} maxLength={19} />
          <Field label="Insurance code" value={p.insuranceCode} onChange={(v) => setParty(part, "insuranceCode", v)} />
          <Field label="Insurance company" value={p.insuranceCompany} onChange={(v) => setParty(part, "insuranceCompany", v)} wide />
          <Field label="Policy / certificate #" value={p.policyNumber} onChange={(v) => setParty(part, "policyNumber", v)} wide />
        </div>
      </section>
    );
  };

  return (
    <Shell onClose={onClose}>
      <div className="mv-body">
        <p className="mv-intro">Pre-filled from this claim. Fill in the blanks (time, location, injuries, codes) and check each answer against the crash before generating. Values are drawn into the official DMV form exactly as entered.</p>
        {error && <p className="mv-error">{error}</p>}

        <section className="mv-section">
          <h3>Crash details</h3>
          <div className="mv-grid">
            <Select label="Crash month" value={c.month} options={withBlank(MONTHS)} onChange={(v) => setCrash("month", v)} />
            <Select label="Crash day" value={c.day} options={withBlank(DAYS)} onChange={(v) => setCrash("day", v)} />
            <Field label="Crash year" value={c.year} onChange={(v) => setCrash("year", v)} maxLength={4} />
            <Field label="Time (e.g. 2:30)" value={c.time} onChange={(v) => setCrash("time", v)} maxLength={5} />
            <Select label="AM / PM" value={c.ampm} options={[{ value: "", label: "— choose —" }, { value: "AM", label: "AM" }, { value: "PM", label: "PM" }]} onChange={(v) => setCrash("ampm", v)} />
            <Field label="# vehicles/units" value={c.vehicleCount} onChange={(v) => setCrash("vehicleCount", v)} maxLength={2} />
            <Field label="# injured" value={c.injured} onChange={(v) => setCrash("injured", v)} maxLength={3} />
            <Field label="# fatalities" value={c.fatalities} onChange={(v) => setCrash("fatalities", v)} maxLength={3} />
            <Check label="Police responded" checked={cb.policeResponded} onChange={(v) => setCrash("policeResponded", v)} />
            <Check label="Police filed crash report" checked={cb.policeFiledReport} onChange={(v) => setCrash("policeFiledReport", v)} />
            <Field label="Police agency / precinct / crash #" value={c.policeAgencyNumber} onChange={(v) => setCrash("policeAgencyNumber", v)} wide />
            <YesNo label="Was the vehicle vandalized?" value={c.vandalized} onChange={(v) => setCrash("vandalized", v)} />
            <YesNo label="Did the crash occur in New York State?" value={c.inNewYork} onChange={(v) => setCrash("inNewYork", v)} />
            <YesNo label="Anyone killed/injured, or damage over $1,000?" value={c.injuredOrOver1000} onChange={(v) => setCrash("injuredOrOver1000", v)} />
            <YesNo label="E-bike/e-scooter death or injury?" value={c.ebikeInjury} onChange={(v) => setCrash("ebikeInjury", v)} />
            <Check label="Repairs to any vehicle or property will exceed $1,000" checked={cb.damageOver1000} onChange={(v) => setCrash("damageOver1000", v)} />
            <Check label="Firefighter responding to an emergency (VTL 114-b)" checked={input.signing.firefighter as boolean} onChange={(v) => setSigning("firefighter", v)} />
          </div>
        </section>

        {partFields("partA", "Part A: Your vehicle / unit")}

        <section className="mv-section">
          <h3>Part B: Other vehicle / unit</h3>
          <div className="mv-checks">
            {["OTHER DRIVER", "PEDESTRIAN", "BICYCLIST", "E-BIKE/E-SCOOTER"].map((kind) => (
              <Check key={kind} label={kind} checked={input.otherPartyTypes.includes(kind)} onChange={() => setInput({ ...input, otherPartyTypes: toggleList(input.otherPartyTypes, kind) })} />
            ))}
          </div>
        </section>
        {partFields("partB", "Part B details")}

        <section className="mv-section">
          <h3>Crash description and location</h3>
          <div className="mv-grid">
            <Field label="County" value={l.county} onChange={(v) => setLoc("county", v)} />
            <Select label="City / town / village" value={l.cityType} options={[{ value: "", label: "—" }, { value: "City", label: "City" }, { value: "Town", label: "Town" }, { value: "Village of:", label: "Village of" }]} onChange={(v) => setLoc("cityType", v)} />
            <Field label="City, town or village name" value={l.cityName} onChange={(v) => setLoc("cityName", v)} wide />
            <Field label="Road (route #, road or street)" value={l.road} onChange={(v) => setLoc("road", v)} maxLength={80} wide />
            <Field label="House #" value={l.houseNumber} onChange={(v) => setLoc("houseNumber", v)} />
            <Field label="Permanent landmark" value={l.landmark} onChange={(v) => setLoc("landmark", v)} />
            <Check label="Crash occurred at an intersection" checked={lb.atIntersection} onChange={(v) => setLoc("atIntersection", v)} />
            <Select label="If at intersection or near" value={l.intersectionType} options={[{ value: "", label: "—" }, { value: "At Intersection With:", label: "At intersection with" }, { value: "Within distance of:", label: "Within distance of" }]} onChange={(v) => setLoc("intersectionType", v)} />
            <Field label="Cross street (if at intersection)" value={l.crossStreet} onChange={(v) => setLoc("crossStreet", v)} wide />
            <Field label="Feet" value={l.feet} onChange={(v) => setLoc("feet", v)} />
            <Field label="Miles" value={l.miles} onChange={(v) => setLoc("miles", v)} />
            <div className="mv-checks mv-wide">
              {(["N", "E", "S", "W"] as const).map((p) => (
                <Check key={p} label={p} checked={(input.location.compass as string[]).includes(p)} onChange={() => setLoc("compass", toggleList(input.location.compass as string[], p))} />
              ))}
            </div>
            <Field label="Of (route, road, or milepost)" value={l.distanceRouteOf} onChange={(v) => setLoc("distanceRouteOf", v)} wide />
            <Check label="Parking lot" checked={lb.parkingLot} onChange={(v) => setLoc("parkingLot", v)} />
            <Select label="Diagram (0–9)" value={c.diagramCode} options={withBlank(codes.diagram)} onChange={(v) => setCrash("diagramCode", v)} wide />
            <Area label="How the crash happened" value={c.description} onChange={(v) => setCrash("description", v)} maxLength={400} />
          </div>
        </section>

        <section className="mv-section">
          <h3>Codes (from the form's page 2 legend)</h3>
          <div className="mv-grid">
            <Select label="Traffic control" value={c.trafficControl} options={withBlank(codes.trafficControl)} onChange={(v) => setCrash("trafficControl", v)} wide />
            <Select label="Roadway surface" value={c.roadwaySurface} options={withBlank(codes.roadwaySurface)} onChange={(v) => setCrash("roadwaySurface", v)} wide />
            <Select label="Direction of travel, Unit 1" value={c.directionUnit1} options={withBlank(codes.direction)} onChange={(v) => setCrash("directionUnit1", v)} />
            <Select label="Direction of travel, Unit 2" value={c.directionUnit2} options={withBlank(codes.direction)} onChange={(v) => setCrash("directionUnit2", v)} />
            <Select label="Pre-crash action, Unit 1" value={c.preCrashUnit1} options={withBlank(codes.preCrash)} onChange={(v) => setCrash("preCrashUnit1", v)} />
            <Select label="Pre-crash action, Unit 2" value={c.preCrashUnit2} options={withBlank(codes.preCrash)} onChange={(v) => setCrash("preCrashUnit2", v)} />
            <Select label="Type of crash (general)" value={c.typeOfCrash} options={withBlank(codes.typeOfCrash)} onChange={(v) => setCrash("typeOfCrash", v)} wide />
            <Select label="Type of crash, Unit 1" value={c.typeOfCrashUnit1} options={withBlank(codes.typeOfCrash)} onChange={(v) => setCrash("typeOfCrashUnit1", v)} wide />
            <Select label="Type of crash, Unit 2" value={c.typeOfCrashUnit2} options={withBlank(codes.typeOfCrash)} onChange={(v) => setCrash("typeOfCrashUnit2", v)} wide />
          </div>
        </section>

        <section className="mv-section">
          <h3>Persons involved</h3>
          {input.persons.map((p, i) => (
            <div className="mv-person" key={i}>
              <div className="mv-person-head"><strong>Person {i + 1}</strong>{i > 0 && <button type="button" className="mv-link" onClick={() => removePerson(i)}>Remove</button>}</div>
              <div className="mv-grid">
                <Field label="Name (Last, First, M.I.)" value={p.name} onChange={(v) => setPerson(i, "name", v)} wide />
                <Select label="Which unit" value={p.unit} options={withBlank(codes.unit)} onChange={(v) => setPerson(i, "unit", v)} />
                <Select label="Position" value={p.position} options={withBlank(codes.position)} onChange={(v) => setPerson(i, "position", v)} />
                <Select label="Safety equipment" value={p.safety} options={withBlank(codes.safety)} onChange={(v) => setPerson(i, "safety", v)} wide />
                <Field label="Age" value={p.age} onChange={(v) => setPerson(i, "age", v)} maxLength={3} />
                <Field label="Sex (M/F/X)" value={p.sex} onChange={(v) => setPerson(i, "sex", v.toUpperCase())} maxLength={1} />
                <Select label="Injury (worst)" value={p.injury} options={withBlank(codes.injury.map((o) => ({ value: o.value, label: o.value })))} onChange={(v) => setPerson(i, "injury", v)} />
                <Field label="Most serious injury (description)" value={p.seriousInjuries} onChange={(v) => setPerson(i, "seriousInjuries", v)} maxLength={80} wide />
                <Field label="Date of death (if any)" value={p.deathDate} onChange={(v) => setPerson(i, "deathDate", v)} maxLength={10} />
              </div>
            </div>
          ))}
          {input.persons.length < 5 && <button type="button" className="mv-link" onClick={addPerson}>+ Add person</button>}
        </section>

        <section className="mv-section">
          <h3>Signature</h3>
          <div className="mv-grid">
            <Field label="Print name of driver" value={input.signing.printName as string} onChange={(v) => setSigning("printName", v)} wide />
            <Field label="Date (MM/DD/YYYY)" value={input.signing.date as string} onChange={(v) => setSigning("date", v)} maxLength={10} />
            <Check label="Signing on behalf of a unit (representative)" checked={input.signing.onBehalfOf as boolean} onChange={(v) => setSigning("onBehalfOf", v)} />
            <Field label="Unit number / specify" value={input.signing.onBehalfUnit as string} onChange={(v) => setSigning("onBehalfUnit", v)} maxLength={10} />
            <Select label="Why the driver cannot sign" value={input.signing.reason as string} options={[{ value: "", label: "—" }, { value: "Injury", label: "Injury" }, { value: "Death", label: "Death" }]} onChange={(v) => setSigning("reason", v)} />
          </div>
          <p className="mv-note">The form must be signed by the driver or representative. Print it, sign and date it, and send the original to the Crash Records Center, 6 Empire State Plaza, PO Box 2925, Albany, NY 12220-0925, within 10 days.</p>
        </section>
      </div>
      <section className="mv-sign">
        <h3>Send for signature</h3>
        {locked ? (
          <>
            <p className="mv-note">
              Status: {STATUS_LABELS[status] || status}
              {signerName ? ` · Signer: ${signerName}${signerEmail ? ` (${signerEmail})` : ""}` : ""}
            </p>
            <div className="mv-sign-actions">
              <button type="button" className="secondary-button" onClick={refreshStatus} disabled={busy}>Check status</button>
              {status === "signed" && <button type="button" className="primary-button" onClick={downloadSigned} disabled={busy}>Download signed PDF</button>}
            </div>
          </>
        ) : (
          <>
            <p className="mv-note">
              Sends this MV-104 to the signer with a signature box and a date box on page 1. The draft is saved first, and the signer enters the date when signing.
            </p>
            <div className="mv-sign-grid">
              <label className="mv-field">Signer name<input value={signerName} onChange={(e) => setSignerName(e.target.value)} /></label>
              <label className="mv-field">Signer email<input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} /></label>
            </div>
            <div className="mv-sign-actions">
              <button type="button" className="primary-button" onClick={sendForSignature} disabled={busy}>{busy ? "Sending…" : "Send for signature"}</button>
            </div>
          </>
        )}
        {notice && <p className="mv-note" role="status">{notice}</p>}
      </section>
      <div className="mv-footer">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        {!locked && <button type="button" className="secondary-button" onClick={saveDraft} disabled={busy}>{formId ? "Save changes" : "Save draft"}</button>}
        <button type="button" className="primary-button" onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate MV-104 PDF"}</button>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="mv-overlay" role="dialog" aria-modal="true" aria-label="MV-104 crash report">
      <div className="mv-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <h2>MV-104 Report of Motor Vehicle Crash</h2>
          <button type="button" className="mv-link" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
