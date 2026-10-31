import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLedgerDate } from "../src/ledgerDate.ts";

for (const timezone of ["America/New_York", "America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
  test(`ledger calendar dates remain unchanged in ${timezone}`, () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = timezone;
    try {
      for (const date of ["2026-10-31", "2026-11-01", "2026-01-01", "2026-03-08", "2026-11-02", "2028-02-29"]) {
        const [year, month, day] = date.split("-").map(Number);
        const expected = new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
          month: "short", day: "numeric", year: "numeric",
        });
        assert.equal(formatLedgerDate(date), expected);
        assert.equal(formatLedgerDate(`${date}T00:00:00.000Z`), expected);
      }
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
}
