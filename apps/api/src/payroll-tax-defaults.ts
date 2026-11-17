// Starting values per year. Every value is editable in the app and must be checked against the IRS/NYS publication for that year.
export const defaultTaxSettings = (year: number) => [
  { key: 'ss_rate', label: 'Social Security rate (employee and employer each)', value: 0.062, notes: 'verify' },
  { key: 'ss_wage_base', label: 'Social Security wage base', value: 184500, notes: 'verify for this year' },
  { key: 'medicare_rate', label: 'Medicare rate (employee and employer each)', value: 0.0145, notes: 'verify' },
  { key: 'additional_medicare_rate', label: 'Additional Medicare rate (employee only)', value: 0.009, notes: 'verify' },
  { key: 'additional_medicare_threshold', label: 'Additional Medicare threshold', value: 200000, notes: 'verify' },
  { key: 'futa_rate', label: 'FUTA rate (employer)', value: 0.006, notes: 'verify' },
  { key: 'futa_wage_base', label: 'FUTA wage base', value: 7000, notes: 'verify' },
  { key: 'nys_sdi_rate', label: 'NYS disability (SDI) rate', value: 0.005, notes: 'verify' },
  { key: 'nys_sdi_weekly_max', label: 'NYS SDI max per week', value: 0.6, notes: 'verify' },
  { key: 'nys_pfl_rate', label: 'NYS paid family leave rate', value: 0.00388, notes: 'verify' },
].map((setting) => ({ year, ...setting }));
