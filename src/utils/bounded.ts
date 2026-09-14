/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Append `value` and drop the oldest entries so the array never exceeds `max`.
 * Mutates in place so callers that share the array reference keep seeing it.
 */
export function pushBounded<T>(values: T[], value: T, max: number): void {
  values.push(value);
  if (values.length > max) {
    values.splice(0, values.length - max);
  }
}

/**
 * Set `key` as the most recently used entry and evict the least recently set
 * entries so the map never exceeds `max`. Relies on Map insertion order.
 */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) {
      break;
    }
    map.delete(oldest.value);
  }
}
