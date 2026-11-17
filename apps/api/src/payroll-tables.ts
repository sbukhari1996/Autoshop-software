// 2026 withholding tables. Brackets: [from, rate, base] = base tax at the start of the bracket.
// Sources: IRS Pub 15-T 2026 (p15t--dft.pdf: the copy fetched is a 2027 draft using 2026 parameters, re-check vs. the final 2026 Pub 15-T),
// NYS-50-T-NYS (1/26). NYC resident rates are the published NYC rate schedule; NYS-50-T-NYC was not fully readable. CPA must verify all.
export type Bracket = readonly [from: number, rate: number, base: number];

export const federalBrackets = {
  single: [[0, 0, 0], [7500, 0.10, 0], [19900, 0.12, 1240], [57900, 0.22, 5800], [113200, 0.24, 17966], [209275, 0.32, 41024], [263725, 0.35, 58448], [648100, 0.37, 192979.25]],
  married_jointly: [[0, 0, 0], [19300, 0.10, 0], [44100, 0.12, 2480], [120100, 0.22, 11600], [230700, 0.24, 35932], [422850, 0.32, 82048], [531750, 0.35, 116896], [788000, 0.37, 206583.5]],
  head_of_household: [[0, 0, 0], [15550, 0.10, 0], [33250, 0.12, 1770], [83000, 0.22, 7740], [121250, 0.24, 16155], [217300, 0.32, 39207], [271750, 0.35, 56631], [656150, 0.37, 191171]],
} as const satisfies Record<string, readonly Bracket[]>;

// W-4 Step 2 unchecked: standard withholding amount. Step 2 checked uses separate IRS schedules (not built: shortcut).
export const federalStandardWithholding = { single: 8600, head_of_household: 8600, married_jointly: 12900 } as const;

export const nysBrackets = {
  single: [[0, 0.039, 0], [8500, 0.044, 332], [11700, 0.0515, 472], [13900, 0.054, 586], [80650, 0.059, 4190], [96800, 0.0703, 5143], [107650, 0.0753, 5906], [157650, 0.064, 9673], [215400, 0.1144, 13369], [265400, 0.0735, 19091]],
  married_jointly: [[0, 0.039, 0], [8500, 0.044, 332], [11700, 0.0515, 472], [13900, 0.054, 586], [80650, 0.059, 4190], [96800, 0.0657, 5143], [107650, 0.0707, 5855], [157650, 0.0801, 9388], [211550, 0.064, 13708], [323200, 0.1349, 20854], [373200, 0.0735, 27600], [1077550, 0.0765, 79369]],
} as const satisfies Record<string, readonly Bracket[]>;
// Head of household is not in the NYS publication text we read: uses Single (shortcut).
export const nysWeeklyDeduction = { single: 142.30, married_jointly: 152.90 } as const;
export const nysWeeklyPerAllowance = 19.25;

// NYC resident brackets (single / married). Progressive: rate applies to the slice of income in each bracket.
export const nycBrackets = {
  single: [[0, 0.03078], [12000, 0.03762], [25000, 0.03819], [50000, 0.03876]],
  married_jointly: [[0, 0.03078], [21600, 0.03762], [45000, 0.03819], [90000, 0.03876]],
} as const;

export const weeksPerYear = 52;
