// Shared display formatters for the Backtest Lab (and reusable elsewhere).
// All accept the API's `number | null` unions plus runtime `undefined`, and
// render a visible placeholder ('—') rather than a blank cell when a value
// is missing or non-finite.

/** Format a fraction (e.g. 0.05) as a percentage string ("5.00%"); '—' for null/undefined/non-finite. */
export const pct = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%';

/** Format a number to 2 decimals; '—' for null/undefined/non-finite. */
export const num = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : v.toFixed(2);

/**
 * Profit factor: '—' when unknown (null/undefined — metric not computed),
 * '∞' only when genuinely infinite (zero losing trades), else 2 decimals.
 */
export const pf = (v: number | null | undefined) =>
  v == null ? '—' : !isFinite(v) ? '∞' : v.toFixed(2);

/** Epoch ms → locale date+time string. */
export const dateTime = (t: number) => new Date(t).toLocaleString();
