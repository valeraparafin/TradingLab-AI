/**
 * Utilities for converting between snake_case (DB) and camelCase (JS/TS).
 */

export function toCamel(obj) {
  if (Array.isArray(obj)) {
    return obj.map(v => toCamel(v));
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => ({
      ...result,
      [key.replace(/(_[a-z])/g, group => group[1].toUpperCase())]: toCamel(obj[key])
    }), {});
  }
  return obj;
}

export function toSnake(obj) {
  if (Array.isArray(obj)) {
    return obj.map(v => toSnake(v));
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => ({
      ...result,
      [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)]: toSnake(obj[key])
    }), {});
  }
  return obj;
}
