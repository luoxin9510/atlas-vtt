import { isRecord } from './shape.ts';

/** A step that moved a shared check's target: a name (a die's label's characters, at most 24) and a signed value, or a value alone. */
export interface SharedTargetStep {
  readonly label?: string;
  readonly value: number;
}

/** The most steps a check's target is moved by: the armed values Atlas's formula holds, and a one-off modifier. */
export const MAX_TARGET_STEPS = 21;
const MAX_STEP_LABEL = 24;
const STEP_LABEL = /^[\p{L}\p{N}' -]{1,24}$/u;

function parseStep(value: unknown, limit: number): SharedTargetStep | null {
  if (!isRecord(value)) return null;
  const { label, value: amount } = value;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || Math.abs(amount) > limit) return null;
  if (label === undefined) return { value: amount };
  if (typeof label !== 'string' || label.length > MAX_STEP_LABEL || label.trim() === '' || !STEP_LABEL.test(label)) return null;
  return { label, value: amount };
}

/**
 * How a check's target was moved, as `{ baseTarget, targetSteps }` to spread into the check, or
 * nothing where either is missing or malformed, the list is empty or too long, or the steps do not
 * add up from the base to `target`: a check keeps its verdict and loses only this extra. `limit` is
 * the largest number a target or step holds.
 */
export function parseTargetSteps(
  baseTarget: unknown, steps: unknown, target: number, limit: number,
): { baseTarget: number; targetSteps: SharedTargetStep[] } | Record<string, never> {
  if (typeof baseTarget !== 'number' || !Number.isInteger(baseTarget) || Math.abs(baseTarget) > limit) return {};
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_TARGET_STEPS) return {};
  const parsed = steps.map((step: unknown) => parseStep(step, limit));
  if (parsed.some((step) => step === null)) return {};
  const targetSteps = parsed as SharedTargetStep[];
  return targetSteps.reduce((sum, step) => sum + step.value, baseTarget) === target ? { baseTarget, targetSteps } : {};
}
