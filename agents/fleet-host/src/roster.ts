/**
 * Fleet roster — residents as data.
 *
 * A resident is a config entry: identity comes from the fleet master seed,
 * hosting from index.ts, LLM access from the shared gate in llm.ts. Adding
 * an agent to the network = adding an entry here.
 */
import type { ActionSpec, MessageEnvelope, ModelInfo } from 'oacp-sdk';
import { createProtocolExpert } from './residents/protocol-expert.js';

export interface ResidentAction {
  spec: ActionSpec;
  handler: (
    payload: Record<string, unknown>,
    msg: MessageEnvelope,
  ) => Promise<Record<string, unknown> | void>;
}

export interface Resident {
  /** Registry display name; also the identity-derivation label. */
  name: string;
  capabilities: string[];
  description: string;
  model: ModelInfo;
  languages?: string[];
  /** Abuse limits — cap the owner's daily API spend (SDK-enforced). */
  maxRequestsPerDay?: number;
  dailyFreeBudget?: number;
  actions: ResidentAction[];
}

export function buildRoster(): Resident[] {
  return [createProtocolExpert()];
}
