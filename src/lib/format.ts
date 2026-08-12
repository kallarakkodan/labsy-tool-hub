/*
 * Display formatting. Every numeric readout these produce is rendered with
 * `tabular-nums` (CONTEXT §5) so digits do not jitter as values change.
 */

const BYTE_UNITS = ["B", "kB", "MB", "GB", "TB", "PB"] as const;

/**
 * Decimal (1000-based), not binary.
 *
 * PRD §15 lists Ubuntu 22.04.4 as "2.1 GB", which is the vendor's own decimal
 * figure — the same file is 1.96 GiB. Engineers compare what the card says
 * against what the vendor's download page says, so matching the vendor is the
 * useful behaviour even though 1024 is the more familiar divisor.
 *
 * Accepts `bigint` because that is what `Tool.fileSize` is, and `string`
 * because that is what survives the API boundary (`serializeTool`).
 */
export function formatBytes(bytes: bigint | number | string, fractionDigits = 1): string {
  let value = typeof bytes === "bigint" ? bytes : BigInt(Math.trunc(Number(bytes)));

  const negative = value < 0n;
  if (negative) value = -value;

  if (value < 1000n) return `${negative ? "-" : ""}${value} B`;

  // Step down in BigInt to avoid ever converting a >2^53 byte count to a double.
  let unit = 0;
  let scaled = value;
  while (scaled >= 1000n && unit < BYTE_UNITS.length - 1) {
    scaled /= 1000n;
    unit += 1;
  }

  const divisor = 1000n ** BigInt(unit);
  const whole = value / divisor;
  const remainder = value % divisor;
  const fraction = Number(remainder) / Number(divisor);
  const rendered = (Number(whole) + fraction).toFixed(fractionDigits);

  return `${negative ? "-" : ""}${rendered} ${BYTE_UNITS[unit]}`;
}

/** "12 Aug 2026" — the form used on cards and in the detail drawer. */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

const RELATIVE_STEPS: [limitSeconds: number, unit: Intl.RelativeTimeFormatUnit, perUnit: number][] = [
  [60, "second", 1],
  [3600, "minute", 60],
  [86_400, "hour", 3600],
  [2_592_000, "day", 86_400],
  [31_536_000, "month", 2_592_000],
  [Number.POSITIVE_INFINITY, "year", 31_536_000],
];

/**
 * "3 days ago" — the admin table's Updated column. `null` renders as "Never",
 * which is a real state: a tool nobody has ever downloaded is exactly what the
 * Stale filter is looking for (PRD §16 D4).
 */
export function formatRelativeDate(date: Date | string | null, now: Date = new Date()): string {
  if (date === null) return "Never";

  const d = typeof date === "string" ? new Date(date) : date;
  const deltaSeconds = (d.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(deltaSeconds);

  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  for (const [limit, unit, perUnit] of RELATIVE_STEPS) {
    if (magnitude < limit) {
      return formatter.format(Math.round(deltaSeconds / perUnit), unit);
    }
  }
  return formatter.format(Math.round(deltaSeconds / 31_536_000), "year");
}

/** "12.4 MB/s" — upload and download progress. */
export function formatThroughput(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

/**
 * "2m 14s" — remaining upload time. Deliberately coarse: a second-accurate ETA
 * on an 8 GB upload is noise, and a jittering number reads as instability.
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${secs}s`;
}
