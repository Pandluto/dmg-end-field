import { createHash } from 'node:crypto';

/**
 * Return a JSON-compatible value with object keys ordered recursively.  Arrays
 * deliberately retain their order: ordered evidence and preference groups are
 * business data, not object-map implementation detail.
 */
export function canonicalizeDefStableValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeDefStableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const entry = value[key];
    return entry === undefined ? [] : [[key, canonicalizeDefStableValue(entry)]];
  }));
}

export function serializeDefStableValue(value) {
  return JSON.stringify(canonicalizeDefStableValue(value));
}

/** Returns the lower-case hexadecimal SHA-256 value without a protocol prefix. */
export function hashDefStableValue(value) {
  return createHash('sha256').update(serializeDefStableValue(value)).digest('hex');
}
