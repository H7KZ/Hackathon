/** Czech number/date formatting for every number shown in the UI (docs/design/brand.md). */

export type Format = "text" | "number" | "int" | "percent" | "delta" | "date" | "pass" | "yesno";

const num = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("cs-CZ", { style: "percent", maximumFractionDigits: 0 });
const signedPct = new Intl.NumberFormat("cs-CZ", {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

/** `2026-03-01` → `1. 3. 2026` without timezone surprises. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${String(Number(m[3]))}. ${String(Number(m[2]))}. ${m[1] ?? ""}` : iso;
}

export function formatValue(value: unknown, format: Format = "text"): string {
  if (value === null || value === undefined || value === "" || Number.isNaN(value)) return "–";
  if (format === "pass") return value === true ? "✓ splněno" : "✗ nesplněno";
  if (format === "yesno") return value === true ? "✓ ano" : "✗ ne";
  if (format === "date") return formatDate(toText(value));
  if (typeof value !== "number") return toText(value);
  switch (format) {
    case "int":
      return int.format(value);
    case "percent":
      return pct.format(value);
    case "delta":
      return signedPct.format(value);
    default:
      return num.format(value);
  }
}

/** Any bound value as display text: primitives as-is, objects as JSON (never "[object Object]"). */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return value.toString();
  return JSON.stringify(value);
}

/** Czech plural: `plural(1, "bod", "body", "bodů")` → "1 bod", 3 → "3 body", 5 → "5 bodů". */
export function plural(n: number, one: string, few: string, many: string): string {
  const word = n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  return `${n.toLocaleString("cs-CZ")} ${word}`;
}
