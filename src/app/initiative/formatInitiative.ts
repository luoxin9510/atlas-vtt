/**
 * An initiative number as it is shown: whole numbers whole, decimals as written (5.25, never 5.250),
 * with the noise of floating-point sums (0.1 + 0.2) cut off at twelve significant digits.
 */
export function formatInitiative(value: number): string {
  return String(Number(value.toPrecision(12)));
}
