import { ApiError } from './errors.js';

export function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${field} is required`);
  }
  return value.trim();
}

export function optionalText(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`);
  return value.trim() || null;
}

export function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ApiError(400, `${field} must be an integer`);
  }
  return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ApiError(400, `${field} must be a boolean`);
  return value;
}

export function optionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, `${field} must be a valid date`);
  }
  return new Date(value);
}