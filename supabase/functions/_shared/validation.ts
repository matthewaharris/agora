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
 * Field size limits for the agent card. Registration is unauthenticated by
 * design, so these are the only bound on what a stranger can write into a row
 * that every dashboard, SDK and third-party client will later render.
 */
const AGENT_CARD_LIMITS: Record<string, number> = {
  name: 100,
  description: 500,
  owner_handle: 64,
  endpoint_url: 300,
};

/** Max serialized size of the free-form `metadata` blob. */
const METADATA_MAX_BYTES = 16_384;

/** Max number of capability tags on one card. */
const CAPABILITIES_MAX = 32;

// Control characters (C0 + DEL + C1) — never legitimate in a displayed field,
// and a reliable way to corrupt logs, terminals and list rendering.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Validate the human-facing fields of an agent card: length, control
 * characters, and markup in `name`.
 *
 * Escaping at every render site is the other half of this and neither
 * substitutes for the other — the registry cannot assume a client escapes, and
 * a client cannot assume the registry constrained. See
 * docs/SECURITY-AUDIT-2026-08-18.md §1–2.
 */
export function validateAgentCard(
  body: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [field, max] of Object.entries(AGENT_CARD_LIMITS)) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      errors.push({ field, message: `${field} must be a string` });
      continue;
    }
    if (value.length > max) {
      errors.push({
        field,
        message: `${field} must be ${max} characters or fewer`,
      });
    }
    if (CONTROL_CHARS.test(value)) {
      errors.push({
        field,
        message: `${field} must not contain control characters`,
      });
    }
  }

  // `name` is rendered in more places than any other field — keep markup out of
  // it at the source rather than relying on every renderer downstream.
  if (typeof body.name === 'string' && /[<>]/.test(body.name)) {
    errors.push({
      field: 'name',
      message: 'name must not contain angle brackets',
    });
  }

  if (Array.isArray(body.capabilities)) {
    if (body.capabilities.length > CAPABILITIES_MAX) {
      errors.push({
        field: 'capabilities',
        message: `at most ${CAPABILITIES_MAX} capabilities`,
      });
    }
    for (const cap of body.capabilities) {
      if (typeof cap === 'string' && cap.length > 64) {
        errors.push({
          field: 'capabilities',
          message: 'each capability must be 64 characters or fewer',
        });
        break;
      }
    }
  }

  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      errors.push({ field: 'metadata', message: 'metadata must be an object' });
    } else {
      let serialized: string;
      try {
        serialized = JSON.stringify(body.metadata);
      } catch {
        errors.push({
          field: 'metadata',
          message: 'metadata must be JSON-serializable',
        });
        return errors;
      }
      if (serialized.length > METADATA_MAX_BYTES) {
        errors.push({
          field: 'metadata',
          message: `metadata must be ${METADATA_MAX_BYTES} bytes or smaller when serialized`,
        });
      }
    }
  }

  return errors;
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
