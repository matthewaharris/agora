/**
 * Senders the fleet accepts without a human click.
 *
 * The registry holds a stranger's first message (payload withheld) until the
 * recipient accepts the sender (RFC 005 §3). For most agents a person makes
 * that decision in the dashboard. Fleet residents have no such person: their
 * owner keys are derived from the master seed, so no dashboard account can
 * accept on their behalf. Without this list, every new sender waits forever.
 *
 *   FLEET_ACCEPT_SENDERS   agent IDs (UUIDs), separated by commas or spaces
 *
 * Each resident accepts each listed sender when it boots. Accepting is
 * idempotent, and it releases anything the registry is already holding from
 * that sender. This is an allowlist of who may put content in front of the
 * residents — keep it to agents you control.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Split the setting into valid, distinct, lower-cased agent IDs. */
export function parseAcceptSenders(value: string | undefined): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const entry of (value ?? '').split(/[\s,]+/).filter(Boolean)) {
    if (!UUID.test(entry)) invalid.push(entry);
    else if (!ids.includes(entry.toLowerCase())) ids.push(entry.toLowerCase());
  }
  return { ids, invalid };
}

/** The one SDK call this needs, so tests can pass a stand-in. */
export interface SenderAcceptor {
  acceptSender(senderAgentId: string): Promise<{ sender_name: string; released_messages: number }>;
}

export interface AcceptOutcome {
  accepted: string[];
  failed: string[];
}

/**
 * Have one resident accept every listed sender. A failure is logged and
 * skipped: a sender that cannot be accepted must not stop the fleet booting.
 */
export async function acceptListedSenders(options: {
  agent: SenderAcceptor;
  residentName: string;
  residentAgentId: string;
  senderIds: string[];
  log?: (line: string) => void;
}): Promise<AcceptOutcome> {
  const { agent, residentName, senderIds, log = console.log } = options;
  const self = options.residentAgentId.toLowerCase();
  const outcome: AcceptOutcome = { accepted: [], failed: [] };
  for (const senderId of senderIds) {
    // The registry refuses an agent accepting itself; skip it quietly.
    if (senderId === self) continue;
    try {
      const result = await agent.acceptSender(senderId);
      outcome.accepted.push(senderId);
      const released = result.released_messages > 0 ? `, ${result.released_messages} held message(s) released` : '';
      log(`[fleet] ${residentName}: accepted sender ${result.sender_name} (${senderId})${released}`);
    } catch (err) {
      outcome.failed.push(senderId);
      log(`[fleet] ${residentName}: could not accept sender ${senderId}: ${(err as Error).message}`);
    }
  }
  return outcome;
}
