import path from "node:path";
import { readFile } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type FinanceSource = {
  sourceKey: string;
  entryDate: string;
  type: "income" | "expense";
  description: string;
  category: string | null;
  amount: number;
  paymentMethod: "cash" | "debit_card" | "credit_card" | "check" | "ach" | "other" | null;
  notes: string | null;
};

function parseJsonl(fileName: string, contents: string): FinanceSource[] {
  const seen = new Set<string>();
  return contents.split(/\r?\n/u).flatMap((line, index) => {
    if (!line.trim()) return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${fileName}:${index + 1} is not valid JSON`, { cause: error });
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${fileName}:${index + 1} must contain a JSON object`);
    }
    const row = value as FinanceSource;
    if (!row.sourceKey || seen.has(row.sourceKey)) {
      throw new Error(`${fileName}:${index + 1} has a missing or duplicate sourceKey`);
    }
    seen.add(row.sourceKey);
    if (row.type !== "income" && row.type !== "expense") {
      throw new Error(`${row.sourceKey} has an unsupported entry type`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(row.entryDate)) {
      throw new Error(`${row.sourceKey} has an invalid ISO entryDate`);
    }
    const date = new Date(`${row.entryDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== row.entryDate) {
      throw new Error(`${row.sourceKey} has an invalid calendar date`);
    }
    if (!row.description?.trim() || !Number.isFinite(row.amount) || row.amount <= 0) {
      throw new Error(`${row.sourceKey} must have a description and positive amount`);
    }
    if (row.paymentMethod !== null && !["cash", "debit_card", "credit_card", "check", "ach", "other"].includes(row.paymentMethod)) {
      throw new Error(`${row.sourceKey} has an unsupported payment method`);
    }
    return [{ ...row, description: row.description.trim() }];
  });
}

async function readOptional(fileName: string): Promise<FinanceSource[]> {
  try {
    return parseJsonl(fileName, await readFile(fileName, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const directory = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!directory) {
    throw new Error("Usage: tsx scripts/importHistoricalFinance.ts <jsonl-directory> [--dry-run]");
  }
  const income = parseJsonl(
    path.join(directory, "income.jsonl"),
    await readFile(path.join(directory, "income.jsonl"), "utf8"),
  );
  const expenses = await readOptional(path.join(directory, "expenses.jsonl"));
  if (income.some((row) => row.type !== "income") || expenses.some((row) => row.type !== "expense")) {
    throw new Error("Put only income records in income.jsonl and expense records in expenses.jsonl");
  }
  const entries = [...income, ...expenses];
  const sourceReferences = entries.map(({ sourceKey }) => `historical-finance:${sourceKey}`);
  const existing = await prisma.financeEntry.findMany({
    where: { sourceReference: { in: sourceReferences } },
    select: { sourceReference: true },
  });
  const importedReferences = new Set(existing.map(({ sourceReference }) => sourceReference));
  const result = {
    mode: dryRun ? "dry-run" : "import",
    incomeRecords: income.length,
    expenseRecords: expenses.length,
    alreadyImported: existing.length,
    toCreate: entries.length - existing.length,
    incomeTotal: income.reduce((total, row) => total + row.amount, 0),
    expenseTotal: expenses.reduce((total, row) => total + row.amount, 0),
  };
  if (dryRun) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const missing = entries.filter(({ sourceKey }) => !importedReferences.has(`historical-finance:${sourceKey}`));
  await prisma.$transaction(async (transaction) => {
    for (const entry of missing) {
      await transaction.financeEntry.create({
        data: {
          type: entry.type,
          description: entry.description,
          category: entry.category,
          amount: entry.amount,
          paymentMethod: entry.paymentMethod,
          entryDate: new Date(`${entry.entryDate}T00:00:00.000Z`),
          notes: entry.notes,
          sourceReference: `historical-finance:${entry.sourceKey}`,
        },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  console.log(JSON.stringify({ ...result, mode: "imported" }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Historical finance import failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
