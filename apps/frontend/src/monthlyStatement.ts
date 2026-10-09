import { zipSync, strToU8 } from "fflate";

type StatementEntry = {
  type: "income" | "expense";
  description: string;
  category: string | null;
  amount: number;
  paymentMethod: string | null;
  entryDate: string;
  notes: string | null;
};

type Cell = string | number;
type SheetCell = { value: Cell; style?: number };

const xmlEscape = (value: string) =>
  value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character]!);

function columnName(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function worksheetXml(rows: SheetCell[][], widths: number[], filter = false) {
  const rowXml = rows.map((row, rowIndex) =>
    `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = cell.style === undefined ? "" : ` s="${cell.style}"`;
      if (typeof cell.value === "number") {
        return `<c r="${reference}"${style}><v>${cell.value}</v></c>`;
      }
      return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.value)}</t></is></c>`;
    }).join("")}</row>`,
  ).join("");
  const columns = widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join("");
  const lastColumn = columnName(Math.max(0, widths.length - 1));
  const autoFilter = filter && rows.length > 1
    ? `<autoFilter ref="A1:${lastColumn}${rows.length}"/>`
    : "";
  const frozenHeader = filter
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${frozenHeader}<cols>${columns}</cols><sheetData>${rowXml}</sheetData>${autoFilter}</worksheet>`;
}

function workbookBytes(summary: SheetCell[][], transactions: SheetCell[][]) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Transactions" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "xl/styles.xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="$#,##0.00;[Red]-$#,##0.00"/><numFmt numFmtId="165" formatCode="mm/dd/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(summary, [28, 20])),
    "xl/worksheets/sheet2.xml": strToU8(worksheetXml(transactions, [14, 13, 42, 24, 18, 16, 46], true)),
  };
  return zipSync(files, { level: 6 });
}

export function createMonthlyStatementWorkbook(
  entries: readonly StatementEntry[],
  year: string,
  month: string,
  type: "all" | StatementEntry["type"] = "all",
) {
  const filtered = entries
    .filter((entry) =>
      entry.entryDate.slice(0, 4) === year
      && (month === "all" || entry.entryDate.slice(5, 7) === month)
      && (type === "all" || entry.type === type))
    .sort((left, right) =>
      Number(right.type === "income") - Number(left.type === "income")
      || left.entryDate.localeCompare(right.entryDate));
  const income = filtered.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = filtered.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const period = month === "all"
    ? year
    : `${new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-US", { month: "long" })} ${year}`;
  const summary: SheetCell[][] = [
    [{ value: "MASTERCRAFT AUTO REPAIR & COLLISION", style: 2 }],
    [{ value: month === "all" ? "Annual Statement" : "Monthly Statement", style: 2 }],
    [{ value: period }],
    [],
    [{ value: "Income", style: 2 }, { value: income, style: 1 }],
    [{ value: "Expenses", style: 2 }, { value: expenses, style: 1 }],
    [{ value: "Net", style: 2 }, { value: income - expenses, style: 1 }],
    [{ value: "Transactions", style: 2 }, { value: filtered.length }],
  ];
  const transactions: SheetCell[][] = [
    ["Date", "Type", "Description", "Category", "Payment method", "Amount", "Notes"]
      .map((value) => ({ value, style: 2 })),
    ...filtered.map((entry) => [
      { value: excelDate(entry.entryDate), style: 3 },
      { value: entry.type === "income" ? "Income" : "Expense" },
      { value: entry.description },
      { value: entry.category || "" },
      { value: entry.paymentMethod?.replaceAll("_", " ") || "" },
      { value: entry.type === "income" ? entry.amount : -entry.amount, style: 1 },
      { value: entry.notes || "" },
    ]),
  ];
  return workbookBytes(summary, transactions);
}

export function downloadMonthlyStatement(
  entries: readonly StatementEntry[],
  year: string,
  month: string,
  type: "all" | StatementEntry["type"] = "all",
) {
  const bytes = createMonthlyStatementWorkbook(entries, year, month, type);
  const url = URL.createObjectURL(new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `mastercraft-statement-${year}${month === "all" ? "" : `-${month}`}${type === "all" ? "" : `-${type}`}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function excelDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000;
}
