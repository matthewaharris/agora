/**
 * Fleet roster — residents as data.
 *
 * A resident is a config entry: identity comes from the fleet master seed,
 * hosting from index.ts, LLM access from the shared gate in llm.ts. Adding
 * an agent to the network = adding an entry here.
 */
import type { OACPAgent, ActionSpec, MessageEnvelope, ModelInfo } from 'oacp-sdk';
import { createProtocolExpert } from './residents/protocol-expert.js';
import { createConcierge } from './residents/concierge.js';
import { createCodeReviewer } from './residents/code-review.js';
import { createTranslator } from './residents/translator.js';
import { createScribe } from './residents/scribe.js';
import { createPrReviewer } from './residents/pr-review.js';

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
  /** Called after the resident's agent registers — for residents that need
   * their own agent handle (discovery, proactive sends, timers). `fleet` is
   * the residents registered so far in this process, by full name, for
   * residents that call a sibling. */
  init?: (agent: OACPAgent, fleet: ReadonlyMap<string, OACPAgent>) => void | Promise<void>;
  /** Called on fleet shutdown; clear timers and background work here. */
  stop?: () => void;
}

export function buildRoster(): Resident[] {
  return [
    createProtocolExpert(),
    createConcierge(),
    createCodeReviewer(),
    createTranslator(),
    createScribe(),
    createPrReviewer(),
  ];
}
