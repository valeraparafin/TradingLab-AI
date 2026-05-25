/**
 * Utilities for converting between snake_case (DB) and camelCase (JS/TS).
 */

export function toCamel(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map(v => toCamel(v));
  } else if (obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = key.replace(/(_[a-z0-9])/g, group => group[1].toUpperCase());
      return {
        ...result,
        [camelKey]: toCamel(obj[key])
      };
    }, {});
  }
  return obj;
}

export function toSnake(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map(v => toSnake(v));
  } else if (obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const snakeKey = key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();
      return {
        ...result,
        [snakeKey]: toSnake(obj[key])
      };
    }, {});
  }
  return obj;
}
