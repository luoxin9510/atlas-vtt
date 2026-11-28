/**
 * An initiative number as it is shown: whole numbers as they are (never cut to twelve digits), a dash for what is not finite, decimals as written (5.25, never 5.250),
 * with the noise of floating-point sums (0.1 + 0.2) cut off at twelve significant digits.
 */
export function formatInitiative(value: number): string {
  if (!Number.isFinite(value)) return '–';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}
