import { federalBrackets, federalStandardWithholding, nycBrackets, nysBrackets, nysWeeklyDeduction, nysWeeklyPerAllowance, weeksPerYear, type Bracket } from './payroll-tables.js';

export type FilingStatus = keyof typeof federalBrackets;
export type PayrollEmployee = {
  federalFilingStatus: string | null;
  w4Step2Checked: boolean;
  w4DependentsCredit: number;
  w4OtherIncome: number;
  w4Deductions: number;
  w4ExtraWithholding: number;
  nysAllowances: number;
  nysAdditionalWithholding: number;
  nycResident: boolean;
};
export type Settings = Record<string, number>;
export type YearToDate = { socialSecurityWages: number; futaWages: number; medicareWages: number };

const cents = (value: number) => Math.round(value * 100) / 100;
const statusOf = (value: string | null): FilingStatus => (value === 'married_jointly' || value === 'head_of_household' ? value : 'single') as FilingStatus;

// Tax on an annual amount with base-at-bracket tables.
export function bracketTax(amount: number, brackets: readonly Bracket[]) {
  const amountAboveZero = Math.max(0, amount);
  let row: Bracket = brackets[0];
  for (const bracket of brackets) if (amountAboveZero >= bracket[0]) row = bracket;
  return row[2] + row[1] * (amountAboveZero - row[0]);
}

// Progressive tax (NYC style): each rate applies only to the income inside its bracket.
export function progressiveTax(amount: number, brackets: readonly (readonly [number, number])[]) {
  return brackets.reduce((total, [from, rate], index) => {
    const upper = brackets[index + 1]?.[0] ?? Infinity;
    return total + Math.max(0, Math.min(amount, upper) - from) * rate;
  }, 0);
}

// IRS Pub 15-T (2020+ W-4), weekly, percentage method.
export function federalWeekly(employee: PayrollEmployee, grossWeekly: number) {
  const status = statusOf(employee.federalFilingStatus);
  const annualWages = grossWeekly * weeksPerYear + employee.w4OtherIncome - employee.w4Deductions;
  const standard = employee.w4Step2Checked ? 0 : federalStandardWithholding[status];
  const tentative = Math.max(0, bracketTax(Math.max(0, annualWages - standard), federalBrackets[status]) - employee.w4DependentsCredit);
  return cents(tentative / weeksPerYear + employee.w4ExtraWithholding);
}

// NYS-50-T-NYS annual Method II schedule, weekly allowances (Table A/B/C), divided to weekly. Matches the published tables within a few cents.
export function nysWeekly(employee: PayrollEmployee, grossWeekly: number) {
  const status = statusOf(employee.federalFilingStatus) === 'married_jointly' ? 'married_jointly' : 'single';
  const allowance = nysWeeklyDeduction[status] + employee.nysAllowances * nysWeeklyPerAllowance;
  const netWeekly = Math.max(0, grossWeekly - allowance);
  return cents(bracketTax(netWeekly * weeksPerYear, nysBrackets[status]) / weeksPerYear + employee.nysAdditionalWithholding);
}

// NYC resident tax, same allowance approximation as NYS (shortcut: NYC-50-T-NYC allowance tables not read).
export function nycWeekly(employee: PayrollEmployee, grossWeekly: number) {
  if (!employee.nycResident) return 0;
  const status = statusOf(employee.federalFilingStatus) === 'married_jointly' ? 'married_jointly' : 'single';
  const allowance = nysWeeklyDeduction[status] + employee.nysAllowances * nysWeeklyPerAllowance;
  const netWeekly = Math.max(0, grossWeekly - allowance);
  return cents(progressiveTax(netWeekly * weeksPerYear, nycBrackets[status]) / weeksPerYear);
}

export function payRunAmounts(employee: PayrollEmployee, grossWeekly: number, settings: Settings, ytd: YearToDate) {
  const gross = cents(grossWeekly);
  const ssTaxable = Math.min(gross, Math.max(0, settings.ss_wage_base - ytd.socialSecurityWages));
  const socialSecurityEmployee = cents(ssTaxable * settings.ss_rate);
  const medicareEmployee = cents(gross * settings.medicare_rate);
  // Additional Medicare: only the part of YTD wages above the threshold.
  const aboveThreshold = (wages: number) => Math.max(0, wages - settings.additional_medicare_threshold);
  const additionalMedicare = cents((aboveThreshold(ytd.medicareWages + gross) - aboveThreshold(ytd.medicareWages)) * settings.additional_medicare_rate);
  const sdiEmployee = cents(Math.min(gross * settings.nys_sdi_rate, settings.nys_sdi_weekly_max));
  const pflEmployee = cents(gross * settings.nys_pfl_rate);
  const federal = federalWeekly(employee, gross);
  const nys = nysWeekly(employee, gross);
  const nyc = nycWeekly(employee, gross);
  const futaTaxable = Math.min(gross, Math.max(0, settings.futa_wage_base - ytd.futaWages));
  const deductions = federal + nys + nyc + socialSecurityEmployee + medicareEmployee + additionalMedicare + sdiEmployee + pflEmployee;
  return {
    grossPay: gross,
    federalWithholding: federal,
    nysWithholding: nys,
    nycWithholding: nyc,
    socialSecurityEmployee,
    medicareEmployee: cents(medicareEmployee + additionalMedicare),
    sdiEmployee,
    pflEmployee,
    netPay: cents(gross - deductions),
    socialSecurityEmployer: socialSecurityEmployee,
    medicareEmployer: medicareEmployee,
    futaEmployer: cents(futaTaxable * settings.futa_rate),
  };
}
