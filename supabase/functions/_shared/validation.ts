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
