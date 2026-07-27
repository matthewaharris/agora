/**
 * Input Validation Helpers
 *
 * Lightweight validation for API request bodies.
 */

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate that required string fields are present and non-empty.
 */
export function validateRequired(
  body: Record<string, unknown>,
  fields: string[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null) {
      errors.push({ field, message: `${field} is required` });
    } else if (typeof value === 'string' && value.trim() === '') {
      errors.push({ field, message: `${field} must not be empty` });
    }
  }
  return errors;
}

/**
 * Validate capabilities is a non-empty array of strings.
 */
export function validateCapabilities(
  capabilities: unknown,
): ValidationError[] {
  if (!Array.isArray(capabilities)) {
    return [{ field: 'capabilities', message: 'capabilities must be an array' }];
  }
  if (capabilities.length === 0) {
    return [{ field: 'capabilities', message: 'capabilities must not be empty' }];
  }
  const nonStrings = capabilities.filter((c) => typeof c !== 'string');
  if (nonStrings.length > 0) {
    return [
      { field: 'capabilities', message: 'all capabilities must be strings' },
    ];
  }
  return [];
}

/**
 * Validate public_key looks like a hex-encoded Ed25519 key (64 hex chars = 32 bytes).
 */
export function validatePublicKey(publicKey: unknown): ValidationError[] {
  if (typeof publicKey !== 'string') {
    return [{ field: 'public_key', message: 'public_key must be a string' }];
  }
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) {
    return [
      {
        field: 'public_key',
        message:
          'public_key must be a 64-character hex string (32-byte Ed25519 public key)',
      },
    ];
  }
  return [];
}

/**
 * JSON Schema subset for stranger task_request validation (RFC 005).
 * Mirrors the SDK's SimpleSchema in packages/oacp-sdk/src/trust.ts —
 * supports: type, properties, required, enum, minLength, maxLength,
 * minimum, maximum, items. Deliberately not a full JSON Schema validator.
 */
export interface SimpleSchema {
  type?: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, SimpleSchema>;
  required?: string[];
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: SimpleSchema;
  description?: string;
}

/**
 * Validate a value against a SimpleSchema. Port of the SDK's validatePayload
 * so the registry enforces the same boundary the receiving agent would.
 */
export function validateSimpleSchema(
  payload: unknown,
  schema: SimpleSchema,
  path = 'payload',
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (schema.type) {
    const actualType = Array.isArray(payload) ? 'array' : typeof payload;
    if (actualType !== schema.type) {
      if (payload !== null && payload !== undefined) {
        errors.push(`${path}: expected ${schema.type}, got ${actualType}`);
        return { valid: false, errors };
      }
    }
  }

  if (
    schema.type === 'object' && typeof payload === 'object' && payload !== null &&
    !Array.isArray(payload)
  ) {
    const obj = payload as Record<string, unknown>;
    if (schema.required) {
      for (const field of schema.required) {
        if (obj[field] === undefined || obj[field] === null) {
          errors.push(`${path}.${field}: required field missing`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (obj[key] !== undefined) {
          const propResult = validateSimpleSchema(obj[key], propSchema, `${path}.${key}`);
          errors.push(...propResult.errors);
        }
      }
    }
  }

  if (schema.type === 'string' && typeof payload === 'string') {
    if (schema.minLength !== undefined && payload.length < schema.minLength) {
      errors.push(`${path}: string too short (min: ${schema.minLength})`);
    }
    if (schema.maxLength !== undefined && payload.length > schema.maxLength) {
      errors.push(`${path}: string too long (max: ${schema.maxLength})`);
    }
    if (schema.enum && !schema.enum.includes(payload)) {
      errors.push(`${path}: value must be one of: ${schema.enum.join(', ')}`);
    }
  }

  if (schema.type === 'number' && typeof payload === 'number') {
    if (schema.minimum !== undefined && payload < schema.minimum) {
      errors.push(`${path}: number too small (min: ${schema.minimum})`);
    }
    if (schema.maximum !== undefined && payload > schema.maximum) {
      errors.push(`${path}: number too large (max: ${schema.maximum})`);
    }
  }

  if (schema.type === 'array' && Array.isArray(payload) && schema.items) {
    payload.forEach((item, i) => {
      const itemResult = validateSimpleSchema(item, schema.items as SimpleSchema, `${path}[${i}]`);
      errors.push(...itemResult.errors);
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate agent_id is a valid UUID.
 */
export function validateUUID(
  value: unknown,
  field = 'agent_id',
): ValidationError[] {
  if (typeof value !== 'string') {
    return [{ field, message: `${field} must be a string` }];
  }
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    return [{ field, message: `${field} must be a valid UUID` }];
  }
  return [];
}
