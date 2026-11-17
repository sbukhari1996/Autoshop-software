import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bracketTax, payRunAmounts, progressiveTax } from '../src/payroll-calc.js';
import { defaultTaxSettings } from '../src/payroll-tax-defaults.js';

const settings = Object.fromEntries(defaultTaxSettings(2026).map((setting) => [setting.key, setting.value]));
const single = { federalFilingStatus: 'single', w4Step2Checked: false, w4DependentsCredit: 0, w4OtherIncome: 0, w4Deductions: 0, w4ExtraWithholding: 0, nysAllowances: 0, nysAdditionalWithholding: 0, nycResident: false };

test('bracket tax matches a hand calculation', () => {
  // 40,000 annual single federal: 1,240 + 12% of (40,000 - 19,900)
  assert.equal(Math.round(bracketTax(40000, [[0, 0, 0], [7500, 0.1, 0], [19900, 0.12, 1240]])), Math.round(1240 + 0.12 * 20100));
});

test('progressive NYC tax applies each rate to its own slice', () => {
  // 12,000 x 10% + 13,000 x 20% + 5,000 x 30% = 5,300
  assert.equal(progressiveTax(30000, [[0, 0.1], [12000, 0.2], [25000, 0.3]]), 5300);
});

test('pay run: FICA and SDI on a 1,000 weekly single employee', () => {
  const run = payRunAmounts(single, 1000, settings, { socialSecurityWages: 0, futaWages: 0, medicareWages: 0 });
  assert.equal(run.socialSecurityEmployee, 62);
  assert.equal(run.medicareEmployee, 14.5);
  assert.equal(run.sdiEmployee, 0.6);
  assert.ok(run.federalWithholding > 0 && run.federalWithholding < 100, 'federal in plausible range');
  assert.equal(run.netPay, Math.round((1000 - run.federalWithholding - run.nysWithholding - run.socialSecurityEmployee - run.medicareEmployee - run.sdiEmployee - run.pflEmployee) * 100) / 100);
});

test('social security stops at the wage base', () => {
  const run = payRunAmounts(single, 1000, settings, { socialSecurityWages: 184500 - 100, futaWages: 0, medicareWages: 0 });
  assert.equal(run.socialSecurityEmployee, 6.2);
});
