import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

type CustomerSource = {
  sourceRecordKey: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

type VehicleSource = {
  sourceRecordKey: string;
  customerKey: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
  VIN: string | null;
  licensePlate: string | null;
  licenseState: string | null;
  color: string | null;
  registrationDetails: string | null;
  notes: string | null;
};

type ClaimSource = {
  sourceRecordKey: string;
  customerKey: string;
  vehicleKey: string | null;
  claimNumber: string | null;
  insuranceCompany: string | null;
  policyNumber: string | null;
  customerNameOnClaim: string | null;
  customerPhoneOnClaim: string | null;
  customerAddressOnClaim: string | null;
  incidentDate: string | null;
  lossType: string | null;
  adjusterName: string | null;
  adjusterPhone: string | null;
  adjusterEmail: string | null;
  policeReportNumber: string | null;
  policeDepartment: string | null;
  witnessName: string | null;
  witnessPhone: string | null;
  claimStatus: string | null;
  photoFolderLink: string | null;
  notes: string | null;
};

type JobSource = {
  sourceRecordKey: string;
  customerKey: string;
  vehicleKey: string | null;
  claimKey: string | null;
  jobNumber: string;
  status: string;
  arrivalDate: string | null;
  inspectionDate: string | null;
  dueDate: string | null;
  notes: string | null;
};

type EntityType = "customer" | "vehicle" | "claim" | "job";
type SourceRecord = {
  sourceRecordKey: string;
};

function parseEntityType(value: string): EntityType {
  if (value === "customer" || value === "vehicle" || value === "claim" || value === "job") {
    return value;
  }
  throw new Error(`Unsupported historical import entity type: ${value}`);
}

async function importedEntityExists(
  prisma: PrismaClient,
  entityType: EntityType,
  recordId: string,
): Promise<boolean> {
  switch (entityType) {
    case "customer":
      return Boolean(await prisma.customer.findUnique({ where: { id: recordId }, select: { id: true } }));
    case "vehicle":
      return Boolean(await prisma.vehicle.findUnique({ where: { id: recordId }, select: { id: true } }));
    case "claim":
      return Boolean(await prisma.claim.findUnique({ where: { id: recordId }, select: { id: true } }));
    case "job":
      return Boolean(await prisma.job.findUnique({ where: { id: recordId }, select: { id: true } }));
  }
}

const entityFiles: Array<{ entityType: EntityType; fileName: string }> = [
  { entityType: "customer", fileName: "customers.jsonl" },
  { entityType: "vehicle", fileName: "vehicles.jsonl" },
  { entityType: "claim", fileName: "claims.jsonl" },
  { entityType: "job", fileName: "completed_jobs.jsonl" },
];

function parseLines<T>(fileName: string, contents: string): T[] {
  return contents
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, lineNumber }) => {
      try {
        const record: unknown = JSON.parse(line);
        if (typeof record !== "object" || record === null || Array.isArray(record)) {
          throw new Error("Expected a JSON object");
        }
        return record as T;
      } catch (error) {
        throw new Error(
          `${fileName}:${lineNumber} is not a valid JSON object`,
          { cause: error },
        );
      }
    });
}

function requireText(value: unknown, field: string, sourceKey: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${sourceKey} is missing required field ${field}`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, sourceKey: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`${sourceKey} has an invalid ${field}`);
  }
  return value.trim() || null;
}

function optionalDate(value: unknown, field: string, sourceKey: string): Date | null {
  const text = optionalText(value, field, sourceKey);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw new Error(`${sourceKey} has a non-ISO ${field}; refusing to guess the date`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${sourceKey} has an invalid ${field}`);
  }
  return date;
}

function validateKeys(
  entityType: EntityType,
  records: SourceRecord[],
): Map<string, SourceRecord> {
  const byKey = new Map<string, SourceRecord>();
  for (const record of records) {
    const sourceKey = requireText(record.sourceRecordKey, "sourceRecordKey", "record");
    if (!sourceKey.startsWith(`${entityType}:`)) {
      throw new Error(`${sourceKey} does not use the expected ${entityType} key prefix`);
    }
    if (byKey.has(sourceKey)) throw new Error(`Duplicate sourceRecordKey: ${sourceKey}`);
    byKey.set(sourceKey, record);
  }
  return byKey;
}

function validateReferences(
  records: Array<{ sourceRecordKey: string; customerKey?: string | null; vehicleKey?: string | null; claimKey?: string | null }>,
  customerKeys: Set<string>,
  vehicleKeys: Set<string>,
  claimKeys: Set<string>,
) {
  for (const record of records) {
    if (record.customerKey && !customerKeys.has(record.customerKey)) {
      throw new Error(`${record.sourceRecordKey} refers to missing customer ${record.customerKey}`);
    }
    if (record.vehicleKey && !vehicleKeys.has(record.vehicleKey)) {
      throw new Error(`${record.sourceRecordKey} refers to missing vehicle ${record.vehicleKey}`);
    }
    if (record.claimKey && !claimKeys.has(record.claimKey)) {
      throw new Error(`${record.sourceRecordKey} refers to missing claim ${record.claimKey}`);
    }
  }
}

async function readSource<T>(directory: string, fileName: string): Promise<T[]> {
  const contents = await readFile(path.join(directory, fileName), "utf8");
  return parseLines<T>(fileName, contents);
}

async function main() {
  const sourceDirectory = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!sourceDirectory) {
    throw new Error("Usage: tsx scripts/importHistoricalShopData.ts <jsonl-directory> [--dry-run]");
  }

  const [customers, vehicles, claims, jobs] = await Promise.all([
    readSource<CustomerSource>(sourceDirectory, "customers.jsonl"),
    readSource<VehicleSource>(sourceDirectory, "vehicles.jsonl"),
    readSource<ClaimSource>(sourceDirectory, "claims.jsonl"),
    readSource<JobSource>(sourceDirectory, "completed_jobs.jsonl"),
  ]);
  const keys = {
    customer: validateKeys("customer", customers),
    vehicle: validateKeys("vehicle", vehicles),
    claim: validateKeys("claim", claims),
    job: validateKeys("job", jobs),
  };
  validateReferences(vehicles, new Set(keys.customer.keys()), new Set(), new Set());
  validateReferences(claims, new Set(keys.customer.keys()), new Set(keys.vehicle.keys()), new Set());
  validateReferences(jobs, new Set(keys.customer.keys()), new Set(keys.vehicle.keys()), new Set(keys.claim.keys()));
  for (const job of jobs) {
    if (requireText(job.status, "status", job.sourceRecordKey).toLowerCase() !== "completed") {
      throw new Error(`${job.sourceRecordKey} is not explicitly marked completed`);
    }
    requireText(job.jobNumber, "jobNumber", job.sourceRecordKey);
  }
  for (const customer of customers) {
    requireText(customer.firstName, "firstName", customer.sourceRecordKey);
  }

  const prisma = new PrismaClient();
  try {
    const sourceEntries = entityFiles.flatMap(({ entityType }) => {
      const records = keys[entityType];
      return [...records.keys()].map((sourceKey) => ({ entityType, sourceKey }));
    });
    const imported = await prisma.historicalImportRecord.findMany({
      where: { sourceKey: { in: sourceEntries.map(({ sourceKey }) => sourceKey) } },
    });
    const importedBySource = new Map(imported.map((entry) => [entry.sourceKey, entry]));
    const trackedIds = {
      customer: new Map<string, string>(),
      vehicle: new Map<string, string>(),
      claim: new Map<string, string>(),
      job: new Map<string, string>(),
    };

    for (const entry of imported) {
      const entityType = parseEntityType(entry.entityType);
      if (!await importedEntityExists(prisma, entityType, entry.recordId)) {
        throw new Error(`Import mapping ${entry.sourceKey} points to a missing database record`);
      }
      trackedIds[entityType].set(entry.sourceKey, entry.recordId);
    }

    const knownJobNumbers = await prisma.job.findMany({
      where: { jobNumber: { in: jobs.map(({ jobNumber }) => jobNumber) } },
      select: { id: true, jobNumber: true },
    });
    const trackedJobIds = new Set(trackedIds.job.values());
    const untrackedJobNumberConflicts = knownJobNumbers.filter((job) => !trackedJobIds.has(job.id));
    if (untrackedJobNumberConflicts.length) {
      throw new Error(
        `Existing job number(s) have no import source mapping; refusing to duplicate or reassign them: ${untrackedJobNumberConflicts.map(({ jobNumber }) => jobNumber).join(", ")}`,
      );
    }

    const result = {
      mode: dryRun ? "dry-run" : "import",
      sourceCounts: {
        customers: customers.length,
        vehicles: vehicles.length,
        claims: claims.length,
        completedJobs: jobs.length,
      },
      alreadyImported: imported.length,
      toCreate: sourceEntries.length - imported.length,
      duplicateVinRows: vehicles.length - new Set(vehicles.map(({ VIN }) => VIN?.trim().toUpperCase()).filter(Boolean)).size,
      nullLastNames: customers.filter(({ lastName }) => !lastName?.trim()).length,
      nullClaimNumbers: claims.filter(({ claimNumber }) => !claimNumber?.trim()).length,
    };

    if (dryRun) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    await prisma.$transaction(async (tx) => {
      async function importedId(entityType: EntityType, sourceKey: string) {
        const prior = trackedIds[entityType].get(sourceKey);
        if (prior) return prior;

        const source = `${entityType}:${sourceKey}`;
        let recordId: string;
        if (entityType === "customer") {
          const row = customers.find(({ sourceRecordKey }) => sourceRecordKey === sourceKey)!;
          const created = await tx.customer.create({
            data: {
              firstName: requireText(row.firstName, "firstName", sourceKey),
              lastName: optionalText(row.lastName, "lastName", sourceKey) ?? "",
              phone: optionalText(row.phone, "phone", sourceKey),
              email: optionalText(row.email, "email", sourceKey),
              address: optionalText(row.address, "address", sourceKey),
              notes: optionalText(row.notes, "notes", sourceKey),
            },
            select: { id: true },
          });
          recordId = created.id;
        } else if (entityType === "vehicle") {
          const row = vehicles.find(({ sourceRecordKey }) => sourceRecordKey === sourceKey)!;
          const customerId = await importedId("customer", row.customerKey);
          const created = await tx.vehicle.create({
            data: {
              customerId,
              year: row.year,
              make: optionalText(row.make, "make", sourceKey),
              model: optionalText(row.model, "model", sourceKey),
              trim: optionalText(row.trim, "trim", sourceKey),
              bodyClass: optionalText(row.bodyClass, "bodyClass", sourceKey),
              vin: optionalText(row.VIN, "VIN", sourceKey)?.toUpperCase(),
              licensePlate: optionalText(row.licensePlate, "licensePlate", sourceKey),
              licenseState: optionalText(row.licenseState, "licenseState", sourceKey),
              color: optionalText(row.color, "color", sourceKey),
              registrationDetails: optionalText(row.registrationDetails, "registrationDetails", sourceKey),
              notes: optionalText(row.notes, "notes", sourceKey),
            },
            select: { id: true },
          });
          recordId = created.id;
        } else if (entityType === "claim") {
          const row = claims.find(({ sourceRecordKey }) => sourceRecordKey === sourceKey)!;
          const customerId = await importedId("customer", row.customerKey);
          const vehicleId = row.vehicleKey ? await importedId("vehicle", row.vehicleKey) : null;
          const created = await tx.claim.create({
            data: {
              customerId,
              vehicleId,
              claimNumber: optionalText(row.claimNumber, "claimNumber", sourceKey),
              customerName: optionalText(row.customerNameOnClaim, "customerNameOnClaim", sourceKey),
              customerPhone: optionalText(row.customerPhoneOnClaim, "customerPhoneOnClaim", sourceKey),
              customerInsurance: optionalText(row.insuranceCompany, "insuranceCompany", sourceKey),
              customerPolicyNumber: optionalText(row.policyNumber, "policyNumber", sourceKey),
              customerAddress: optionalText(row.customerAddressOnClaim, "customerAddressOnClaim", sourceKey),
              incidentDate: optionalDate(row.incidentDate, "incidentDate", sourceKey),
              lossType: optionalText(row.lossType, "lossType", sourceKey),
              policeReportNumber: optionalText(row.policeReportNumber, "policeReportNumber", sourceKey),
              policeDepartment: optionalText(row.policeDepartment, "policeDepartment", sourceKey),
              witnessName: optionalText(row.witnessName, "witnessName", sourceKey),
              witnessPhone: optionalText(row.witnessPhone, "witnessPhone", sourceKey),
              photoFolderLink: optionalText(row.photoFolderLink, "photoFolderLink", sourceKey),
              insuranceCompany: optionalText(row.insuranceCompany, "insuranceCompany", sourceKey),
              adjusterName: optionalText(row.adjusterName, "adjusterName", sourceKey),
              adjusterPhone: optionalText(row.adjusterPhone, "adjusterPhone", sourceKey),
              adjusterEmail: optionalText(row.adjusterEmail, "adjusterEmail", sourceKey),
              claimStatus: optionalText(row.claimStatus, "claimStatus", sourceKey) ?? "new",
              notes: optionalText(row.notes, "notes", sourceKey),
            },
            select: { id: true },
          });
          recordId = created.id;
        } else {
          const row = jobs.find(({ sourceRecordKey }) => sourceRecordKey === sourceKey)!;
          const customerId = await importedId("customer", row.customerKey);
          const vehicleId = row.vehicleKey ? await importedId("vehicle", row.vehicleKey) : null;
          const claimId = row.claimKey ? await importedId("claim", row.claimKey) : null;
          const created = await tx.job.create({
            data: {
              customerId,
              vehicleId,
              claimId,
              jobNumber: requireText(row.jobNumber, "jobNumber", sourceKey),
              status: "completed",
              arrivalDate: optionalDate(row.arrivalDate, "arrivalDate", sourceKey),
              inspectionDate: optionalDate(row.inspectionDate, "inspectionDate", sourceKey),
              dueDate: optionalDate(row.dueDate, "dueDate", sourceKey),
              notes: optionalText(row.notes, "notes", sourceKey),
            },
            select: { id: true },
          });
          recordId = created.id;
        }

        await tx.historicalImportRecord.create({
          data: { sourceKey, entityType, recordId },
        });
        trackedIds[entityType].set(sourceKey, recordId);
        return recordId;
      }

      for (const row of customers) await importedId("customer", row.sourceRecordKey);
      for (const row of vehicles) await importedId("vehicle", row.sourceRecordKey);
      for (const row of claims) await importedId("claim", row.sourceRecordKey);
      for (const row of jobs) await importedId("job", row.sourceRecordKey);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    console.log(JSON.stringify({ ...result, mode: "imported" }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Historical import failed");
  process.exitCode = 1;
});
