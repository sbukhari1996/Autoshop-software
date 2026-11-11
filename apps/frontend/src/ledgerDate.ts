// Ledger dates are calendar dates, stored by the API in UTC, not local timestamps.
export function formatLedgerDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
