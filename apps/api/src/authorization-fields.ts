import { ApiError } from './errors.js';

export interface AuthorizationFieldPlacement {
  name: string;
  type: 'initials' | 'signature' | 'date' | 'text';
  required: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

export function parseAuthorizationFieldPlacements(serialized: string | null): AuthorizationFieldPlacement[] | undefined {
  if (serialized === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ApiError(500, 'Stored authorization field placements are invalid');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) {
    throw new ApiError(500, 'Stored authorization field placements are invalid');
  }
  const placements: AuthorizationFieldPlacement[] = [];
  for (const field of parsed) {
    if (typeof field !== 'object' || field === null || Array.isArray(field)) {
      throw new ApiError(500, 'Stored authorization field placements are invalid');
    }
    const value = field as Record<string, unknown>;
    const { name, type, required, x, y, w, h } = value;
    if (
      typeof name !== 'string' || !name ||
      !isFieldType(type) ||
      typeof required !== 'boolean' ||
      value.page !== 1 ||
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof w !== 'number' || !Number.isFinite(w) ||
      typeof h !== 'number' || !Number.isFinite(h) ||
      x < 0 || y < 0 || w <= 0 || h <= 0 ||
      x + w > 612 || y + h > 792
    ) {
      throw new ApiError(500, 'Stored authorization field placements are invalid');
    }
    placements.push({ name, type, required, x, y, w, h, page: 1 });
  }
  return placements;
}

function isFieldType(value: unknown): value is AuthorizationFieldPlacement['type'] {
  return value === 'initials' || value === 'signature' || value === 'date' || value === 'text';
}
