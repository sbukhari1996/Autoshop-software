import { bracketTax, progressiveTax, type Settings } from './payroll-calc.js';
import { federalBrackets, nycBrackets, nysBrackets } from './payroll-tables.js';

type PacketEntry = { type: string; amount: number; category: string | null; entryDate: Date };
type PacketRun = { payDate: Date; grossPay: number; socialSecurityEmployer?: number; medicareEmployer?: number; futaEmployer?: number; federalWithholding: number; nysWithholding: number; nycWithholding: number; socialSecurityEmployee: number; medicareEmployee: number; sdiEmployee: number; pflEmployee: number; employee: { name: string } };

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

// CPA packet: year-to-date through the quarter end, plus a rough estimate. Every rate comes from tax settings. The CPA must review before any payment.
export function buildTaxPacket({ year, quarter, quarterStart, entries, runs, settings }: { year: number; quarter: number; quarterStart: Date; entries: PacketEntry[]; runs: PacketRun[]; settings: Settings }) {
  const inQuarter = (date: Date) => date >= quarterStart;
  const income = (list: PacketEntry[]) => list.filter((entry) => entry.type === 'income').reduce((total, entry) => total + entry.amount, 0);
  const expenses = (list: PacketEntry[]) => list.filter((entry) => entry.type === 'expense').reduce((total, entry) => total + entry.amount, 0);
  const expenseByCategory = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== 'expense') continue;
    const category = entry.category || 'Uncategorized';
    expenseByCategory.set(category, (expenseByCategory.get(category) || 0) + entry.amount);
  }
  const quarterEntries = entries.filter((entry) => inQuarter(entry.entryDate));
  const ytdGross = runs.reduce((total, run) => total + run.grossPay, 0);
  const ytdEmployerTax = runs.reduce((total, run) => total + (run.socialSecurityEmployer || 0) + (run.medicareEmployer || 0) + (run.futaEmployer || 0), 0);
  const ytdIncome = income(entries);
  const ytdExpenses = expenses(entries);
  const netProfit = ytdIncome - ytdExpenses - ytdGross - ytdEmployerTax;
  const annualFactor = 12 / (quarter * 3);
  const annualProfit = netProfit * annualFactor;
  const seTax = Math.max(0, annualProfit) * 0.9235 * settings.se_rate;
  const agi = annualProfit - seTax / 2;
  const federalIncome = bracketTax(Math.max(0, agi - settings.federal_standard_deduction_single), federalBrackets.single);
  const nysTax = bracketTax(Math.max(0, agi - settings.nys_standard_deduction_single), nysBrackets.single);
  const nycTax = progressiveTax(Math.max(0, agi - settings.nys_standard_deduction_single), nycBrackets.single);
  const nycUbt = Math.max(0, annualProfit - settings.nyc_ubt_allowance) * settings.nyc_ubt_rate;
  const annualEstimate = federalIncome + seTax + nysTax + nycTax + nycUbt;

  const rows: (string | number)[][] = [
    [`Tax packet ${year} Q${quarter} (year to date through quarter end)`],
    ['Prepared for CPA review. Estimates only. Not a filed return. Rates are on the app\'s tax settings page.'],
    [],
    ['SCHEDULE C SUMMARY', 'Quarter', 'Year to date'],
    ['Gross receipts (line 1)', money(income(quarterEntries)), money(ytdIncome)],
    ...[...expenseByCategory.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, amount]) => [`Expense: ${category}`, money(expenses(quarterEntries.filter((entry) => (entry.category || 'Uncategorized') === category))), money(amount)]),
    ['Wages paid (line 26)', money(runs.filter((run) => inQuarter(run.payDate)).reduce((t, run) => t + run.grossPay, 0)), money(ytdGross)],
    ['Employer payroll taxes (line 23)', money(runs.filter((run) => inQuarter(run.payDate)).reduce((t, run) => t + (run.socialSecurityEmployer || 0) + (run.medicareEmployer || 0) + (run.futaEmployer || 0), 0)), money(ytdEmployerTax)],
    ['Net profit (before self-employment tax)', '', money(netProfit)],
    [],
    ['PAYROLL TAXES TO REMIT (year to date)', 'Amount'],
    ['Federal income tax withheld (Form 941 / 945)', money(runs.reduce((t, run) => t + run.federalWithholding, 0))],
    ['Social Security + Medicare, employee and employer (Form 941)', money(runs.reduce((t, run) => t + run.socialSecurityEmployee + run.medicareEmployee + (run.socialSecurityEmployer || 0) + (run.medicareEmployer || 0), 0))],
    ['FUTA (Form 940)', money(runs.reduce((t, run) => t + (run.futaEmployer || 0), 0))],
    ['NYS income tax withheld (NYS-45)', money(runs.reduce((t, run) => t + run.nysWithholding, 0))],
    ['NYC income tax withheld (NYC-45)', money(runs.reduce((t, run) => t + run.nycWithholding, 0))],
    ['NYS disability (SDI) withheld', money(runs.reduce((t, run) => t + run.sdiEmployee, 0))],
    ['NYS paid family leave withheld', money(runs.reduce((t, run) => t + run.pflEmployee, 0))],
    [],
    ['ROUGH ESTIMATE (annualized from year to date)', 'Annual estimate', 'Cumulative target through this quarter (25% per quarter)'],
    ['Self-employment tax (15.3% x 92.35%; wage-base offset not applied)', money(seTax), money(seTax * quarter / 4)],
    ['Federal income tax (single brackets, 2026 standard deduction)', money(federalIncome), money(federalIncome * quarter / 4)],
    ['NYS income tax (Single schedule)', money(nysTax), money(nysTax * quarter / 4)],
    ['NYC resident income tax (Single schedule)', money(nycTax), money(nycTax * quarter / 4)],
    ['NYC unincorporated business tax (NYC-202, rough)', money(nycUbt), money(nycUbt * quarter / 4)],
    ['Total estimate', money(annualEstimate), money(annualEstimate * quarter / 4)],
    [],
    ['Payments already made this year (enter from IRS/NYS records)', ''],
    ['Entries in ledger for this quarter', quarterEntries.length],
    ['Owner transfers are counted as income unless excluded. Review income before filing.'],
  ];
  return rows;
}
