// Pure presentation helpers (no DOM). Kept separate from stats so the analytics
// stay number-only and these string formatters can be unit-tested too.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jan 5, 2024" from a local timestamp. */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Jan 5 – Apr 24, 2024" (compact range, dropping a repeated year). */
export function formatRange(start: number, end: number): string {
  const a = new Date(start);
  const b = new Date(end);
  const left =
    a.getFullYear() === b.getFullYear()
      ? `${MONTHS[a.getMonth()]} ${a.getDate()}`
      : `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()}`;
  const right = `${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  return `${left} – ${right}`;
}

/** Whole-number percent, e.g. 0.333 → "33%". */
export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Human "12:00–12:59" → "12 PM" hour label for a 0..23 hour. */
export function formatHour(hour: number): string {
  if (hour < 0) return "—";
  const ampm = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${ampm}`;
}

/** Compact thousands grouping without locale dependence in tests. */
export function formatCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Largest-unit duration label, e.g. 90061000 → "1d 1h". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const mins = Math.floor((ms % HOUR_MS) / MIN_MS);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}
