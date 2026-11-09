// server/src/money.js
const CENTS_RE = /^\d+\.\d{2}$/;

export function toCents(value) {
  if (typeof value !== 'string' || !CENTS_RE.test(value)) {
    throw new Error(`toCents: invalid money string: ${JSON.stringify(value)}`);
  }
  const [dollars, cents] = value.split('.');
  const result = Number(dollars) * 100 + Number(cents);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`toCents: value out of safe range: ${value}`);
  }
  return result;
}

export function fromCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`fromCents: expected non-negative integer cents, got ${JSON.stringify(cents)}`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}