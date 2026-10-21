// In-memory failed-sign-in throttle. Blocks an email after repeated failures and an IP after many failures.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 30;

type Entry = { count: number; resetAt: number };
const failures = new Map<string, Entry>();

function current(key: string): Entry | undefined {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    failures.delete(key);
    return undefined;
  }
  return entry;
}

export function isLoginBlocked(email: string, ip: string): boolean {
  return (current(`email:${email}`)?.count ?? 0) >= MAX_FAILURES_PER_EMAIL
    || (current(`ip:${ip}`)?.count ?? 0) >= MAX_FAILURES_PER_IP;
}

export function recordLoginFailure(email: string, ip: string): void {
  for (const key of [`email:${email}`, `ip:${ip}`]) {
    const entry = current(key) ?? { count: 0, resetAt: Date.now() + WINDOW_MS };
    entry.count += 1;
    failures.set(key, entry);
  }
}

export function clearLoginFailures(email: string): void {
  failures.delete(`email:${email}`);
}

// Drop expired entries periodically so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failures) if (entry.resetAt <= now) failures.delete(key);
}, WINDOW_MS).unref();
