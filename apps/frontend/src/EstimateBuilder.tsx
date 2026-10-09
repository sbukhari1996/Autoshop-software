import React from "react";
import { LineItemPresetPicker } from "./LineItemPresetPicker";
import type { CollisionPresetItem } from "./collisionLineItemPresets";

type Job = {
  id: string;
  jobNumber: string;
  customer: { firstName: string; lastName: string; address?: string | null; phone?: string | null };
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    trim?: string | null;
    vin?: string | null;
    licensePlate?: string | null;
    licenseState?: string | null;
    color?: string | null;
  } | null;
  claim?: {
    claimNumber?: string | null;
    insuranceCompany?: string | null;
    customerName?: string | null;
    customerPolicyNumber?: string | null;
    incidentDate?: string | null;
    adjusterName?: string | null;
    adjusterPhone?: string | null;
  } | null;
};
type SavedEstimate = {
  id: string;
  jobId: string | null;
  estimateNumber: string | null;
  taxRate: number;
  bodyRate: number;
  paintRate: number;
  supplyRate: number;
  mechanicRate: number;
  damageSummary: string | null;
  carrier: string | null;
  appraisalCompanyName: string | null;
  workfileId: string | null;
  ownerName: string | null;
  insuredName: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
  lossType: string | null;
  dateOfLoss: string | null;
  pointOfImpact: string | null;
  daysToRepair: string | null;
  writtenBy: string | null;
  nyAdjusterLicense: string | null;
  writtenByPhone: string | null;
  insuranceAdjuster: string | null;
  insuranceAdjusterPhone: string | null;
  inspectionLocation: string | null;
  repairFacility: string | null;
  odometer: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  engine: string | null;
  productionDate: string | null;
  vehicleCondition: string | null;
  vehicleFeatures: string[];
  walkInCustomerName: string | null;
  walkInCustomerAddress: string | null;
  walkInCustomerPhone: string | null;
  walkInVehicleYear: number | null;
  walkInVehicleMake: string | null;
  walkInVehicleModel: string | null;
  walkInVehicleTrim: string | null;
  walkInVehicleBodyClass: string | null;
  walkInVehicleVin: string | null;
  walkInVehicleLicense: string | null;
  walkInVehicleState: string | null;
  lineItems: Array<{
    id: string;
    parentLineId: string | null;
    section: string | null;
    operation: string | null;
    description: string;
    partNumber: string | null;
    note: string | null;
    quantity: number;
    unitPrice: number;
    laborHours: number;
    mechanicHours: number;
    paintHours: number;
  }>;
};
type Line = {
  localId: string;
  parentId?: string;
  section: string;
  operation: string;
  description: string;
  partNumber: string;
  quantity: string;
  unitPrice: string;
  laborHours: string;
  mechanicHours: string;
  paintHours: string;
  note: string;
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
type AppraisalDetails = {
  carrier: string;
  appraisalCompanyName: string;
  workfileId: string;
  ownerName: string;
  insuredName: string;
  policyNumber: string;
  claimNumber: string;
  lossType: string;
  dateOfLoss: string;
  pointOfImpact: string;
  daysToRepair: string;
  writtenBy: string;
  nyAdjusterLicense: string;
  writtenByPhone: string;
  insuranceAdjuster: string;
  insuranceAdjusterPhone: string;
  inspectionLocation: string;
  repairFacility: string;
  odometer: string;
  exteriorColor: string;
  interiorColor: string;
  engine: string;
  productionDate: string;
  vehicleCondition: string;
};
const VEHICLE_FEATURES = [
  { category: "TRANSMISSION", items: ["Automatic transmission", "Manual transmission", "Overdrive", "Intermittent wipers"] },
  { category: "POWER", items: ["Power steering", "Power brakes", "Power windows", "Power locks", "Power mirrors", "Power driver seat", "Power passenger seat", "Heated mirrors"] },
  { category: "CONVENIENCE & DECOR", items: ["Air conditioning", "Cruise control", "Keyless entry", "Alarm", "Tilt wheel", "Telescopic wheel", "Dual mirrors", "Tinted glass", "Remote start", "Backup camera", "Parking sensors", "Navigation system"] },
  { category: "SAFETY", items: ["Driver air bag", "Passenger air bag", "Side impact air bags", "Anti-lock brakes", "Traction control", "Stability control", "Blind spot detection", "Lane departure warning", "Adaptive cruise control"] },
  { category: "WHEELS", items: ["Steel wheels", "Aluminum/alloy wheels", "Four-wheel disc brakes"] },
  { category: "PAINT & ROOF", items: ["Clear coat paint", "Pearl/tri-coat paint", "Sunroof", "Panoramic roof"] },
  { category: "AUDIO & SEATING", items: ["AM/FM radio", "Premium radio", "Bluetooth/audio connection", "Leather seats", "Heated seats", "Ventilated seats", "Rear heated seats"] },
] as const;
const LOSS_TYPES = ["Collision", "Comprehensive", "Liability", "Hail", "Vandalism", "Theft", "Fire", "Flood / Water", "Glass", "Animal", "Other"] as const;
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const MASTERCRAFT_FACILITY_NAME = "Mastercraft Auto Repair & Collision LLC";
const MASTERCRAFT_FACILITY_DETAILS = [
  MASTERCRAFT_FACILITY_NAME,
  "(646) 203-1122 Business",
  "38-21 23rd St",
  "LONG ISLAND CITY, NY 11101-0000",
  "(718) 578-4563",
];
const newLine = (): Line => ({
  localId: crypto.randomUUID(),
  section: "FRONT DOOR",
  operation: "Rpr",
  description: "",
  partNumber: "",
  quantity: "1",
  unitPrice: "",
  laborHours: "",
  mechanicHours: "",
  paintHours: "",
  note: "",
});
const money = (value: number) =>
  `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const displayDate = (value: string) =>
  value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString() : "—";
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
const emptyAppraisal: AppraisalDetails = {
  carrier: "",
  appraisalCompanyName: "Mastercraft Auto Repair & Collision",
  workfileId: "",
  ownerName: "",
  insuredName: "",
  policyNumber: "",
  claimNumber: "",
  lossType: "",
  dateOfLoss: "",
  pointOfImpact: "",
  daysToRepair: "",
  writtenBy: "Syed S. Bukhari",
  nyAdjusterLicense: "IA-2002072",
  writtenByPhone: "",
  insuranceAdjuster: "",
  insuranceAdjusterPhone: "",
  inspectionLocation: "",
  repairFacility: "",
  odometer: "",
  exteriorColor: "",
  interiorColor: "",
  engine: "",
  productionDate: "",
  vehicleCondition: "",
};

export function EstimateBuilder({
  jobs,
  request,
  onSaved,
  editEstimateId,
  onStartNew,
  onCancelEdit,
}: {
  jobs: Job[];
  request: Request;
  onSaved: () => Promise<void>;
  editEstimateId: string | null;
  onStartNew: () => void;
  onCancelEdit: () => void;
}) {
  const [jobId, setJobId] = React.useState("");
  const [source, setSource] = React.useState<"existing" | "walkin">("existing");
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [walkIn, setWalkIn] = React.useState<WalkIn>(emptyWalkIn);
  const [appraisal, setAppraisal] =
    React.useState<AppraisalDetails>(emptyAppraisal);
  const [customLossType, setCustomLossType] = React.useState("");
  const [customInspectionLocation, setCustomInspectionLocation] = React.useState(false);
  const [vehicleFeatures, setVehicleFeatures] = React.useState<string[]>([]);
  const [vinLoading, setVinLoading] = React.useState(false);
  const [vinMessage, setVinMessage] = React.useState("");
  const [number, setNumber] = React.useState("");
  const [damage, setDamage] = React.useState("");
  const [taxRate, setTaxRate] = React.useState("8.875");
  const [bodyRate, setBodyRate] = React.useState("63");
  const [paintRate, setPaintRate] = React.useState("63");
  const [supplyRate, setSupplyRate] = React.useState("41");
  const [mechanicRate, setMechanicRate] = React.useState("80");
  const [lines, setLines] = React.useState<Line[]>([newLine()]);
  const [error, setError] = React.useState("");
  const [savedEstimateId, setSavedEstimateId] = React.useState("");
  const [editingEstimateId, setEditingEstimateId] = React.useState("");
  const [loadingEstimate, setLoadingEstimate] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  const [generatedAt] = React.useState(() => new Date().toLocaleString());
  const selectedJob = jobs.find((job) => job.id === jobId);
  const editNotLoaded = Boolean(editEstimateId && editingEstimateId !== editEstimateId);
  React.useEffect(() => {
    if (!selectedJob || savedEstimateId) return;
    const claim = selectedJob.claim;
    const customerFullName = `${selectedJob.customer.firstName} ${selectedJob.customer.lastName}`;
    setAppraisal((current) => ({
      ...emptyAppraisal,
      appraisalCompanyName: current.appraisalCompanyName || emptyAppraisal.appraisalCompanyName,
      workfileId: current.workfileId,
      writtenBy: current.writtenBy,
      nyAdjusterLicense: current.nyAdjusterLicense,
      writtenByPhone: current.writtenByPhone,
      carrier: claim?.insuranceCompany || "",
      ownerName: customerFullName,
      insuredName: claim?.customerName || customerFullName,
      policyNumber: claim?.customerPolicyNumber || "",
      claimNumber: claim?.claimNumber || "",
      dateOfLoss: claim?.incidentDate?.slice(0, 10) || "",
      insuranceAdjuster: claim?.adjusterName || "",
      insuranceAdjusterPhone: claim?.adjusterPhone || "",
      inspectionLocation: MASTERCRAFT_FACILITY_NAME,
      repairFacility: MASTERCRAFT_FACILITY_NAME,
      exteriorColor: selectedJob.vehicle?.color || "",
    }));
  }, [selectedJob?.id, savedEstimateId]);
  React.useEffect(() => {
    if (!editEstimateId) return;
    let cancelled = false;
    setLoadingEstimate(true);
    void request<SavedEstimate>(`/estimates/${editEstimateId}`)
      .then((estimate) => {
        if (cancelled) return;
        const addressParts = (estimate.walkInCustomerAddress || "").split("\n");
        const locality = (addressParts[1] || "").split(",").map((part) => part.trim());
        const lineIds = new Map<string, string>();
        const restoredLines = estimate.lineItems.map((line) => {
          const localId = crypto.randomUUID();
          lineIds.set(line.id, localId);
          return {
            localId,
            parentId: line.parentLineId ? lineIds.get(line.parentLineId) : undefined,
            section: line.section || "",
            operation: line.operation || "",
            description: line.description,
            partNumber: line.partNumber || "",
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            laborHours: String(line.laborHours),
            mechanicHours: String(line.mechanicHours),
            paintHours: String(line.paintHours),
            note: line.note || "",
          };
        });
        setSource(estimate.jobId ? "existing" : "walkin");
        setJobId(estimate.jobId || "");
        setWalkIn({
          customerName: estimate.walkInCustomerName || "",
          address: addressParts[0] || "",
          city: locality[0] || "",
          state: locality[1] || "",
          zip: locality[2] || "",
          year: estimate.walkInVehicleYear ? String(estimate.walkInVehicleYear) : "",
          make: estimate.walkInVehicleMake || "",
          model: estimate.walkInVehicleModel || "",
          trim: estimate.walkInVehicleTrim || "",
          bodyClass: estimate.walkInVehicleBodyClass || "",
          vin: estimate.walkInVehicleVin || "",
          license: estimate.walkInVehicleLicense || "",
          vehicleState: estimate.walkInVehicleState || "",
          registration: "",
        });
        const savedLossType = estimate.lossType || "";
        const isCustomLossType = savedLossType !== "" && !LOSS_TYPES.some((lossType) => lossType === savedLossType);
        setCustomLossType(isCustomLossType ? savedLossType : "");
        setAppraisal({
          carrier: estimate.carrier || "",
          appraisalCompanyName: estimate.appraisalCompanyName || "",
          workfileId: estimate.workfileId || "",
          ownerName: estimate.ownerName || "",
          insuredName: estimate.insuredName || "",
          policyNumber: estimate.policyNumber || "",
          claimNumber: estimate.claimNumber || "",
          lossType: isCustomLossType ? "Other" : savedLossType,
          dateOfLoss: estimate.dateOfLoss || "",
          pointOfImpact: estimate.pointOfImpact || "",
          daysToRepair: estimate.daysToRepair || "",
          writtenBy: estimate.writtenBy || emptyAppraisal.writtenBy,
          nyAdjusterLicense: estimate.nyAdjusterLicense || emptyAppraisal.nyAdjusterLicense,
          writtenByPhone: estimate.writtenByPhone || "",
          insuranceAdjuster: estimate.insuranceAdjuster || "",
          insuranceAdjusterPhone: estimate.insuranceAdjusterPhone || "",
          inspectionLocation: estimate.inspectionLocation || "",
          repairFacility: estimate.repairFacility || "",
          odometer: estimate.odometer || "",
          exteriorColor: estimate.exteriorColor || "",
          interiorColor: estimate.interiorColor || "",
          engine: estimate.engine || "",
          productionDate: estimate.productionDate || "",
          vehicleCondition: estimate.vehicleCondition || "",
        });
        setCustomInspectionLocation(Boolean(
          estimate.inspectionLocation && estimate.inspectionLocation !== MASTERCRAFT_FACILITY_NAME,
        ));
        setVehicleFeatures(estimate.vehicleFeatures);
        setNumber(estimate.estimateNumber || "");
        setDamage(estimate.damageSummary || "");
        setTaxRate(String(estimate.taxRate));
        setBodyRate(String(estimate.bodyRate));
        setPaintRate(String(estimate.paintRate));
        setSupplyRate(String(estimate.supplyRate));
        setMechanicRate(String(estimate.mechanicRate));
        setLines(restoredLines.length ? restoredLines : [newLine()]);
        setSavedEstimateId(estimate.id);
        setEditingEstimateId(estimate.id);
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load estimate for editing");
      })
      .finally(() => {
        if (!cancelled) setLoadingEstimate(false);
      });
    return () => { cancelled = true; };
  }, [editEstimateId, request]);
  const customerName =
    source === "walkin"
      ? walkIn.customerName || "Walk-in customer"
      : selectedJob
        ? `${selectedJob.customer.firstName} ${selectedJob.customer.lastName}`
        : "Select a customer";
  const claimNumber = appraisal.claimNumber || selectedJob?.claim?.claimNumber || "";
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
              selectedJob.vehicle.trim,
          ]
            .filter(Boolean)
            .join(" ")
        : "Not specified";
  const vehicleVin =
    source === "walkin" ? walkIn.vin : selectedJob?.vehicle?.vin || "N/A";
  const vehicleLicense =
    source === "walkin"
      ? `${walkIn.license}${walkIn.vehicleState ? ` (${walkIn.vehicleState})` : ""}`
      : selectedJob?.vehicle
        ? `${selectedJob.vehicle.licensePlate || "N/A"}${selectedJob.vehicle.licenseState ? ` (${selectedJob.vehicle.licenseState})` : ""}`
        : "N/A";
  const miscellaneous = lines.reduce(
    (sum, line) =>
      sum +
      (["shop & misc", "miscellaneous"].includes(line.section.trim().toLowerCase())
        ? Number(line.quantity || 0) * Number(line.unitPrice || 0)
        : 0),
    0,
  );
  const parts = lines.reduce(
    (sum, line) =>
      sum +
      (["shop & misc", "miscellaneous"].includes(line.section.trim().toLowerCase())
        ? 0
        : Number(line.quantity || 0) * Number(line.unitPrice || 0)),
    0,
  );
  const bodyHours = lines.reduce(
    (sum, line) => sum + Number(line.laborHours || 0),
    0,
  );
  const mechanicHours = lines.reduce(
    (sum, line) => sum + Number(line.mechanicHours || 0),
    0,
  );
  const paintHours = lines.reduce(
    (sum, line) => sum + Number(line.paintHours || 0),
    0,
  );
  const taxableSubtotal =
    parts +
    bodyHours * Number(bodyRate || 0) +
    mechanicHours * Number(mechanicRate || 0) +
    paintHours * (Number(paintRate || 0) + Number(supplyRate || 0));
  const subtotal = taxableSubtotal + miscellaneous;
  const tax = Math.round((taxableSubtotal * Number(taxRate || 0) / 100 + Number.EPSILON) * 100) / 100;
  const total = Math.round((subtotal + tax + Number.EPSILON) * 100) / 100;
  const updateLine = (index: number, key: keyof Line, value: string) =>
    setLines(
      lines.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    );
  function addPresetLines(items: CollisionPresetItem[]) {
    const presetLines: Line[] = items.flatMap((item) => {
      const parent = {
        ...newLine(),
        section: item.category,
        operation: item.operation,
        description: item.description,
        partNumber: item.partNumber || "",
        quantity: item.quantity ? String(item.quantity) : "1",
        unitPrice: item.unitPrice ? String(item.unitPrice) : "",
        note: item.note || "",
        laborHours: item.laborHours ? String(item.laborHours) : "",
        mechanicHours:
          item.mechanicHours || item.category === "Mechanical"
            ? String(item.mechanicHours || item.laborHours || "")
            : "",
        paintHours: item.paintHours ? String(item.paintHours) : "",
      };
      const subLines = (item.subItems || []).map((subItem): Line => ({
        ...newLine(),
        parentId: parent.localId,
        section: item.category,
        operation: subItem.operation,
        description: subItem.description,
        partNumber: subItem.partNumber || "",
        quantity: subItem.quantity ? String(subItem.quantity) : "1",
        unitPrice: subItem.unitPrice ? String(subItem.unitPrice) : "",
        note: subItem.note || "",
        laborHours: subItem.laborHours ? String(subItem.laborHours) : "",
        mechanicHours: subItem.mechanicHours ? String(subItem.mechanicHours) : "",
        paintHours: subItem.paintHours ? String(subItem.paintHours) : "",
      }));
      return [parent, ...subLines];
    });
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
  async function save(): Promise<string | null> {
    if (source === "existing" && !jobId) {
      setError("Select a customer and repair job before saving this estimate.");
      return null;
    }
    try {
      const response = await fetch(
        `${API_URL}/estimates${editingEstimateId ? `/${editingEstimateId}` : ""}`,
        {
        method: editingEstimateId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}`,
        },
        body: JSON.stringify({
          jobId: source === "existing" ? jobId : null,
          ...(source === "walkin"
            ? {
                walkIn: {
                  customerName: walkIn.customerName || "Walk-in customer",
                  address: [walkIn.address, [walkIn.city, walkIn.state, walkIn.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n"),
                  phone: "",
                  vehicleYear: walkIn.year ? Number(walkIn.year) : null,
                  vehicleMake: walkIn.make,
                  vehicleModel: walkIn.model,
                  vehicleTrim: walkIn.trim,
                  vehicleBodyClass: walkIn.bodyClass,
                  vin: walkIn.vin,
                  license: walkIn.license,
                  vehicleState: walkIn.vehicleState,
                },
              }
            : {}),
          estimateNumber: number,
          damageSummary: damage,
          ...appraisal,
          lossType: appraisal.lossType === "Other" ? customLossType.trim() || "Other" : appraisal.lossType,
          vehicleFeatures,
          taxRate,
          bodyRate,
          paintRate,
          supplyRate,
          mechanicRate,
          lineItems: lines.map((line, index) => ({
            section: line.section,
            operation: line.operation,
            description: line.description,
            partNumber: line.partNumber,
            note: line.note,
            parentIndex: line.parentId
              ? lines.findIndex((parent) => parent.localId === line.parentId)
              : null,
            sortOrder: index,
            quantity: Number(line.quantity || 0),
            unitPrice: Number(line.unitPrice || 0),
            laborHours: Number(line.laborHours || 0),
            mechanicHours: Number(line.mechanicHours || 0),
            paintHours: Number(line.paintHours || 0),
          })),
        }),
      });
      const result = await response.json() as Pick<SavedEstimate, "id" | "estimateNumber" | "workfileId"> & { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Unable to save estimate");
      setSavedEstimateId(result.id);
      setEditingEstimateId(result.id);
      setNumber(result.estimateNumber || "");
      setAppraisal((current) => ({ ...current, workfileId: result.workfileId || "" }));
      await onSaved();
      setError(editingEstimateId ? "Estimate updated successfully." : "Estimate saved successfully.");
      return result.id;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save estimate",
      );
      return null;
    }
  }
  async function downloadEstimate(forPrint = false) {
    const printWindow = forPrint ? window.open("about:blank", "_blank") : null;
    if (forPrint && !printWindow) {
      setError("Allow pop-ups for this site to open the print-ready estimate.");
      return;
    }
    setDownloading(true); setError("");
    try {
      const estimateId = forPrint ? await save() : savedEstimateId;
      if (!estimateId) {
        printWindow?.close();
        if (!forPrint) setError("Save this estimate first, then download the PDF.");
        return;
      }
      setError("");
      const response = await fetch(`${API_URL}/estimates/${estimateId}/pdf`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("repairos_token") || ""}` } });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `Unable to download estimate PDF (HTTP ${response.status})`);
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      if (printWindow) {
        printWindow.location.href = blobUrl;
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } else {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `${number || "estimate"}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }
    } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : "Unable to download estimate PDF"); } finally { setDownloading(false); }
  }
  async function printEstimate() {
    const printWindow = window.open("about:blank", "_blank");
    if (!printWindow) {
      setError("Allow pop-ups for this site to open the print-ready estimate.");
      return;
    }
    setDownloading(true);
    setError("");
    try {
      const estimateId = await save();
      if (!estimateId) {
        printWindow.close();
        return;
      }
      setError("");
      const response = await fetch(`${API_URL}/estimates/${estimateId}/pdf`, {
        method: "POST",
        headers: { Authorization: `******"repairos_token") || ""}` },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `Unable to prepare estimate PDF (HTTP ${response.status})`);
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      printWindow.location.href = blobUrl;
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (printError) {
      printWindow.close();
      setError(printError instanceof Error ? printError.message : "Unable to prepare estimate for printing");
    } finally {
      setDownloading(false);
    }
  }
  async function deleteEstimate() {
    if (!savedEstimateId || !window.confirm("Delete this saved estimate? This cannot be undone.")) return;
    setError("");
    try {
      await request(`/estimates/${savedEstimateId}`, { method: "DELETE" });
      setSavedEstimateId("");
      setEditingEstimateId("");
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
  const appraisalField = (
    key: keyof AppraisalDetails,
    label: string,
    type: "text" | "date" = "text",
    placeholder = "",
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        value={appraisal[key]}
        onChange={(event) =>
          setAppraisal({ ...appraisal, [key]: event.target.value })
        }
        placeholder={placeholder}
      />
    </label>
  );
  return (
    <div className="estimate-builder">
      <div className="estimate-builder-toolbar">
        <div>
          <p className="eyebrow">Estimate of record</p>
          <h2>{editingEstimateId ? `Edit estimate ${number || ""}` : "Build repair estimate"}</h2>
          <p>
            Add customer and vehicle details, then add each repair operation.
          </p>
        </div>
        <div className="estimate-actions">
          <button type="button" className="secondary-button" onClick={onStartNew}>
            New estimate
          </button>
          {editEstimateId && <button type="button" className="secondary-button" onClick={onCancelEdit}>Cancel edit</button>}
          <button className="secondary-button" onClick={() => void downloadEstimate(true)} disabled={downloading}>
            {downloading ? "Preparing PDF..." : "Print estimate"}
          </button>
          <button className="secondary-button" onClick={() => void downloadEstimate()} disabled={downloading}>
            {downloading ? "Preparing PDF..." : "Download estimate PDF"}
          </button>
          <button
            className="orange-button"
            onClick={save}
            disabled={loadingEstimate || editNotLoaded}
          >
            {loadingEstimate ? "Loading estimate..." : editNotLoaded ? "Estimate unavailable" : editingEstimateId ? "Update estimate" : "Save estimate"}
          </button>
          {savedEstimateId && <button className="danger-button" onClick={() => void deleteEstimate()}>Delete saved estimate</button>}
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
          <input value={number} placeholder="Assigned automatically when saved" readOnly />
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
          Mechanical labor / hr
          <input
            type="number"
            value={mechanicRate}
            onChange={(event) => setMechanicRate(event.target.value)}
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
      <section className="estimate-details surface">
        <div className="surface-heading">
          <div>
            <h2>Appraisal and insurance details</h2>
            <p>Claim details prefill from the selected repair job; update any field as needed.</p>
          </div>
        </div>
        <div className="estimate-appraisal-grid">
          {appraisalField("carrier", "Insurance carrier")}
          {appraisalField("appraisalCompanyName", "Appraisal company")}
          <label>
            Workfile ID
            <input value={appraisal.workfileId} placeholder="Assigned automatically when saved" readOnly />
          </label>
          {appraisalField("ownerName", "Vehicle owner")}
          {appraisalField("insuredName", "Named insured")}
          {appraisalField("policyNumber", "Policy number")}
          {appraisalField("claimNumber", "Insurance claim number")}
          <label>
            Type of loss
            <select
              value={appraisal.lossType}
              onChange={(event) => setAppraisal((current) => ({ ...current, lossType: event.target.value }))}
            >
              <option value="">Select loss type</option>
              {LOSS_TYPES.map((lossType) => (
                <option key={lossType} value={lossType}>{lossType}</option>
              ))}
            </select>
          </label>
          {appraisal.lossType === "Other" && (
            <label>
              Specify type of loss
              <input
                value={customLossType}
                onChange={(event) => setCustomLossType(event.target.value)}
                placeholder="Enter a custom type of loss"
              />
            </label>
          )}
          {appraisalField("dateOfLoss", "Date of loss", "date")}
          {appraisalField("pointOfImpact", "Point of impact")}
          {appraisalField("daysToRepair", "Estimated repair days")}
          {appraisalField("writtenBy", "Written by")}
          {appraisalField("nyAdjusterLicense", "NY adjuster license number")}
          {appraisalField("writtenByPhone", "Appraiser phone")}
          {appraisalField("insuranceAdjuster", "Insurance adjuster")}
          {appraisalField("insuranceAdjusterPhone", "Insurance adjuster phone")}
          <label>
            Inspection location
            <select
              value={customInspectionLocation ? "custom" : appraisal.inspectionLocation}
              onChange={(event) => {
                const value = event.target.value;
                setCustomInspectionLocation(value === "custom");
                setAppraisal((current) => ({
                  ...current,
                  inspectionLocation: value === "custom" ? (current.inspectionLocation === MASTERCRAFT_FACILITY_NAME ? "" : current.inspectionLocation) : value,
                }));
              }}
            >
              <option value="">Select an inspection location</option>
              <option value={MASTERCRAFT_FACILITY_NAME}>{MASTERCRAFT_FACILITY_NAME}</option>
              <option value="custom">Other / custom location</option>
            </select>
          </label>
          {customInspectionLocation && appraisalField("inspectionLocation", "Custom inspection location")}
          <label>
            Repair facility
            <select
              value={appraisal.repairFacility}
              onChange={(event) => setAppraisal((current) => ({ ...current, repairFacility: event.target.value }))}
            >
              <option value="">Select a repair facility</option>
              <option value={MASTERCRAFT_FACILITY_NAME}>{MASTERCRAFT_FACILITY_NAME}</option>
            </select>
          </label>
          {appraisalField("odometer", "Odometer")}
          {appraisalField("exteriorColor", "Exterior color")}
          {appraisalField("interiorColor", "Interior color")}
          {appraisalField("engine", "Engine")}
          {appraisalField("productionDate", "Production date")}
          {appraisalField("vehicleCondition", "Vehicle condition")}
        </div>
        <div className="vehicle-feature-groups">
          {VEHICLE_FEATURES.map((group) => (
            <fieldset className="vehicle-feature-group" key={group.category}>
              <legend>{group.category}</legend>
              {group.items.map((feature) => (
                <label key={feature}>
                  <input
                    type="checkbox"
                    checked={vehicleFeatures.includes(feature)}
                    onChange={(event) =>
                      setVehicleFeatures((current) =>
                        event.target.checked
                          ? [...current, feature]
                          : current.filter((item) => item !== feature),
                      )
                    }
                  />
                  {feature}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
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
            <span>Mech</span>
            <span>Paint</span>
            <span>Note</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <div className={line.parentId ? "estimate-line estimate-line-sub" : "estimate-line"} key={line.localId}>
              <label className="estimate-line-field"><span>Section</span><input aria-label="Section" value={line.section} onChange={(event) => updateLine(index, "section", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Operation</span><input aria-label="Operation" value={line.operation} onChange={(event) => updateLine(index, "operation", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Description</span><input aria-label="Repair description" value={line.description} onChange={(event) => updateLine(index, "description", event.target.value)} placeholder="Repair description" /></label>
              <label className="estimate-line-field"><span>Part number</span><input aria-label="Part number" value={line.partNumber} onChange={(event) => updateLine(index, "partNumber", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Quantity</span><input aria-label="Quantity" type="number" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Price</span><input aria-label="Unit price" type="number" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(index, "unitPrice", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Labor hours</span><input aria-label="Labor hours" type="number" step="0.01" value={line.laborHours} onChange={(event) => updateLine(index, "laborHours", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Mechanical hours</span><input aria-label="Mechanical hours" type="number" step="0.01" value={line.mechanicHours} onChange={(event) => updateLine(index, "mechanicHours", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Paint hours</span><input aria-label="Paint hours" type="number" step="0.01" value={line.paintHours} onChange={(event) => updateLine(index, "paintHours", event.target.value)} /></label>
              <label className="estimate-line-field"><span>Note</span><input aria-label="Line note" value={line.note} onChange={(event) => updateLine(index, "note", event.target.value)} placeholder="Optional line note" /></label>
              <button
                className="remove-line"
                onClick={() => setLines(lines.filter((candidate, lineIndex) =>
                  lineIndex !== index && (!candidate.parentId || candidate.parentId !== line.localId),
                ))}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="estimate-preview">
        <div className="estimate-paper">
          <div className="paper-running-header">
            <strong>ESTIMATE OF RECORD{number ? ` · ${number}` : ""}</strong>
            <div className="paper-running-owner">
              <span>Owner: {appraisal.ownerName || customerName}</span>
              <span>Job Number: {selectedJob?.jobNumber || "—"}</span>
            </div>
            <span>
              VEHICLE · {[vehicleName, appraisal.engine].filter(Boolean).join(" · ")} · VIN: {vehicleVin || "—"}
              {claimNumber ? ` · Claim: ${claimNumber}` : ""}
            </span>
          </div>
          <header className="paper-header">
            <h2>{appraisal.appraisalCompanyName || "MASTERCRAFT AUTO REPAIR & COLLISION"}</h2>
            <p>
              38-21 23rd Street, Long Island City, NY 11101 | Tel: 718-578-4563
              / 718-603-0412 | shop@mastercraftautony.com
            </p>
            <p>www.mastercraftautony.com</p>
          </header>
          <h2 className="paper-title">ESTIMATE OF RECORD{number ? ` · ${number}` : ""}</h2>
          <div className="paper-owner-details">
            <div className="paper-owner-job">
              <strong>Owner: {appraisal.ownerName || customerName}</strong>
              <strong>Job Number: {selectedJob?.jobNumber || "—"}</strong>
            </div>
            <div className="paper-written-by">
              Written By: {[appraisal.writtenBy, appraisal.nyAdjusterLicense].filter(Boolean).join(", ") || "—"}
            </div>
            <div className="paper-adjuster">
              Adjuster: {[appraisal.insuranceAdjuster, appraisal.insuranceAdjusterPhone].filter(Boolean).join(" · ") || "—"}
            </div>
            <div className="paper-loss-details">
              <div>
                <span>Insured: {appraisal.insuredName || customerName}</span>
                <span>Type of Loss: {appraisal.lossType === "Other" ? customLossType || "Other" : appraisal.lossType || "—"}</span>
                <span>Point of Impact: {appraisal.pointOfImpact || "—"}</span>
              </div>
              <div>
                <span>Policy #: {appraisal.policyNumber || "—"}</span>
                <span>Date of Loss: {displayDate(appraisal.dateOfLoss)}</span>
                <span>Days to Repair: {appraisal.daysToRepair || "—"}</span>
              </div>
              <div>
                <span>Claim #: {claimNumber || "—"}</span>
                <span>Workfile ID: {appraisal.workfileId || "—"}</span>
              </div>
            </div>
            <div className="paper-owner-facility-details">
              <div>
                <strong>Owner:</strong>
                <span>{appraisal.ownerName || customerName}</span>
                {customerAddress && <span>{customerAddress}</span>}
                {source === "existing" && selectedJob?.customer.phone && <span>{selectedJob.customer.phone}</span>}
              </div>
              <div>
                <strong>Inspection Location:</strong>
                <span>{appraisal.inspectionLocation || "—"}</span>
              </div>
              <div>
                <strong>Repair Facility:</strong>
                {appraisal.repairFacility === MASTERCRAFT_FACILITY_NAME
                  ? MASTERCRAFT_FACILITY_DETAILS.map((detail) => <span key={detail}>{detail}</span>)
                  : <span>—</span>}
              </div>
            </div>
          </div>
          <div className="paper-vehicle">
            <h3>VEHICLE</h3>
            <strong className="paper-vehicle-name">
              {[vehicleName, appraisal.engine].filter(Boolean).join(" · ")}
            </strong>
            <div className="paper-vehicle-grid">
              <span><b>VIN:</b> {vehicleVin || "—"}</span>
              <span><b>Production Date:</b> {appraisal.productionDate || "—"}</span>
              <span><b>Interior Color:</b> {appraisal.interiorColor || "—"}</span>
              <span><b>License:</b> {vehicleLicense || "—"}</span>
              <span><b>Odometer:</b> {appraisal.odometer || "—"}</span>
              <span><b>Exterior Color:</b> {appraisal.exteriorColor || "—"}</span>
              <span><b>State:</b> {source === "walkin" ? walkIn.vehicleState || "—" : selectedJob?.vehicle?.licenseState || "—"}</span>
              <span><b>Condition:</b> {appraisal.vehicleCondition || "—"}</span>
            </div>
            <div className="paper-feature-grid">
              {VEHICLE_FEATURES.map((group) => (
                <div key={group.category}>
                  <strong>{group.category}</strong>
                  {group.items.map((feature) => (
                    <span key={feature}>
                      <i>{vehicleFeatures.includes(feature) ? "✓" : "□"}</i>
                      {feature}
                    </span>
                  ))}
                </div>
              ))}
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
                <th>Line</th>
                <th>Op</th>
                <th>Description</th>
                <th>Part Number</th>
                <th>Qty</th>
                <th>Extended Price $</th>
                <th>Labor</th>
                <th>Paint</th>
              </tr>
            </thead>
            <tbody>
              {lines.flatMap((line, index) => {
                const sectionChanged =
                  !line.parentId &&
                  (index === 0 || line.section !== lines[index - 1].section);
                const labor = [
                  line.laborHours ? `${line.laborHours} body` : "",
                  line.mechanicHours ? `${line.mechanicHours} mech` : "",
                ].filter(Boolean).join(" / ");
                return [
                  ...(sectionChanged
                    ? [<tr className="paper-section-row" key={`section-${index}`}><td colSpan={8}>{line.section || "REPAIR OPERATIONS"}</td></tr>]
                    : []),
                  <tr key={`line-${index}`}>
                    <td>{index + 1}</td>
                    <td>{line.operation || (line.parentId ? "" : "—")}</td>
                    <td className={line.parentId ? "paper-subline-description" : undefined}>{line.description || "—"}</td>
                    <td>{line.partNumber || "—"}</td>
                    <td>{line.parentId ? "" : line.quantity || "—"}</td>
                    <td>{line.parentId && !line.unitPrice ? "" : money(Number(line.quantity || 0) * Number(line.unitPrice || 0))}</td>
                    <td>{labor || "—"}</td>
                    <td>{line.paintHours || "—"}</td>
                  </tr>,
                  ...(line.note
                    ? [<tr className="paper-line-note" key={`note-${index}`}><td colSpan={8}>Note: {line.note}</td></tr>]
                    : []),
                ];
              })}
            </tbody>
          </table>
          <h3 className="paper-totals-heading">ESTIMATE TOTALS</h3>
          <table className="paper-totals">
            <thead><tr><th>Category</th><th>Basis</th><th>Rate</th><th>Cost $</th></tr></thead>
            <tbody>
              <tr><td>Parts</td><td>Parts</td><td>—</td><td>{money(parts)}</td></tr>
              <tr><td>Body Labor</td><td>{bodyHours.toFixed(1)} hrs</td><td>{money(Number(bodyRate))} / hr</td><td>{money(bodyHours * Number(bodyRate))}</td></tr>
              <tr><td>Paint Labor</td><td>{paintHours.toFixed(1)} hrs</td><td>{money(Number(paintRate))} / hr</td><td>{money(paintHours * Number(paintRate))}</td></tr>
              <tr><td>Mechanical Labor</td><td>{mechanicHours.toFixed(1)} hrs</td><td>{money(Number(mechanicRate))} / hr</td><td>{money(mechanicHours * Number(mechanicRate))}</td></tr>
              <tr><td>Paint Supplies</td><td>{paintHours.toFixed(1)} hrs</td><td>{money(Number(supplyRate))} / hr</td><td>{money(paintHours * Number(supplyRate))}</td></tr>
              <tr><td>Miscellaneous</td><td>Charges</td><td>—</td><td>{money(miscellaneous)}</td></tr>
              <tr className="paper-subtotal"><td colSpan={3}>Subtotal</td><td>{money(subtotal)}</td></tr>
              <tr><td>Sales Tax</td><td>{money(taxableSubtotal)}</td><td>{taxRate}%</td><td>{money(tax)}</td></tr>
              <tr className="paper-total"><td colSpan={3}>TOTAL COST OF REPAIRS</td><td>{money(total)}</td></tr>
            </tbody>
          </table>
          <div className="paper-closing">
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
          <div className="paper-page-footer">
            <span>{generatedAt}</span>
            <span>{claimNumber ? `Claim #${claimNumber}` : selectedJob?.jobNumber || "—"}</span>
            <span className="paper-page-number">Page <b>1</b></span>
          </div>
        </div>
      </section>
    </div>
  );
}
