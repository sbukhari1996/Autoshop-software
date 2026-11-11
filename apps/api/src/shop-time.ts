// Shop calendar is New York time. Inspections stay on the dashboard until 6 PM on their day.
const shopTimeZone = 'America/New_York';

// New York wall-clock time for a date, written as if it were UTC so it can be parsed back.
function nyWallClock(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: shopTimeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
}

export function sixPmNewYork(scheduledFor: Date) {
  const day = nyWallClock(scheduledFor).slice(0, 10);
  const guess = Date.parse(`${day}T18:00:00Z`);
  const offset = Date.parse(nyWallClock(new Date(guess))) - guess;
  return new Date(guess - offset);
}
