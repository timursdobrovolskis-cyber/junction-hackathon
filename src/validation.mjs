export function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function cents(value, name, { signed = false } = {}) {
  requireValue(Number.isSafeInteger(value) && (signed || value >= 0),
    `${name} must be ${signed ? 'a' : 'a non-negative'} safe integer in euro cents`);
  return value;
}

export function sum(values) {
  return values.reduce((total, value) => cents(total + value, 'total', { signed: true }), 0);
}

export function date(value, name = 'date') {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${name} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  requireValue(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    `${name} must be a valid calendar date`);
  return value;
}

export function month(value) {
  requireValue(typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value), 'month must be YYYY-MM');
  return value;
}

export function identifier(value, name = 'id') {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

export function unique(values, name) {
  requireValue(new Set(values).size === values.length, `${name} must be unique`);
}

export function evidenceIds(values = []) {
  requireValue(Array.isArray(values), 'evidenceIds must be an array');
  values.forEach((value) => identifier(value, 'evidenceId'));
  return [...new Set(values)];
}
