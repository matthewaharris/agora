/**
 * OACP Fleet Host
 *
 * Many resident agents, one Node process, one worker. Each resident's
 * Ed25519 identity is derived deterministically from ONE master seed
 * (FLEET_MASTER_SEED), so a single Render secret pins the whole fleet and
 * the same roster rebuilds the same identities on any host.
 *
 * Residents are data — see src/roster.ts. LLM calls from all residents
 * share a global concurrency gate (src/llm.ts).
 *
 * Env:
 *   FLEET_MASTER_SEED   32 bytes as 64 hex chars (required)
 *   ANTHROPIC_API_KEY   required (LLM-backed residents)
 *   SUPABASE_URL / SUPABASE_ANON_KEY   optional — defaults to the public registry
 *   FLEET_LLM_CONCURRENCY   max concurrent Anthropic calls (default 3)
 */
import 'dotenv/config';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OACPAgent } from 'oacp-sdk';
import { deriveKeypair, isValidMasterSeed } from './src/identity.js';
import { buildRoster, type Resident } from './src/roster.js';

const REGISTER_STAGGER_MS = 250;

export interface FleetOptions {
  /** Prepended to every resident name (identity derives from the full name) —
   * scratch/staging boots get disjoint identities from production. */
  namePrefix?: string;
  /** Extra capability tags on every resident (e.g. a scratch-cleanup tag). */
  extraCapabilities?: string[];
  /** Roster override (tests). Default: buildRoster(). */
  residents?: Resident[];
  /** Directory for per-resident state files (owner keypair, contacts). */
  stateDir?: string;
}

export async function bootFleet(options: FleetOptions = {}): Promise<Map<string, OACPAgent>> {
  const seed = process.env.FLEET_MASTER_SEED;
  if (!isValidMasterSeed(seed)) {
    throw new Error('FLEET_MASTER_SEED must be set to 32 bytes as 64 hex chars');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required — fleet residents are LLM-backed');
  }

  const residents = options.residents ?? buildRoster();
  const prefix = options.namePrefix ?? '';
  const stateDir = options.stateDir ?? '.';
  const agents = new Map<string, OACPAgent>();

  for (const resident of residents) {
    const name = `${prefix}${resident.name}`;
    const agent = new OACPAgent({
      name,
      capabilities: [...resident.capabilities, ...(options.extraCapabilities ?? [])],
      ownerHandle: 'matthew',
      description: resident.description,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      keypair: deriveKeypair(seed, name),
      // Identity comes from the derived keypair; these paths only place the
      // auxiliary state files, one set per resident so they never collide.
      keypairPath: path.join(stateDir, `${name}.keypair.json`),
      ownerKeypairPath: path.join(stateDir, `${name}.owner.json`),
      contactsPath: path.join(stateDir, `${name}.contacts.json`),
      ratchetsPath: path.join(stateDir, `${name}.ratchets.json`),
      heartbeatIntervalMs: 60_000,
      actionSpecs: resident.actions.map((a) => a.spec),
      trustPolicy: { allowedSenders: 'open', requireSignature: true },
      model: resident.model,
      languages: resident.languages ?? ['en'],
      maxRequestsPerDay: resident.maxRequestsPerDay ?? 200,
      dailyFreeBudget: resident.dailyFreeBudget ?? 300_000,
    });
    for (const action of resident.actions) {
      agent.registerAction(action.spec, action.handler);
    }

    const agentId = await agent.register();
    console.log(`🏠 ${name} registered as ${agentId} (pk ${agent.getPublicKey().slice(0, 16)}…)`);
    agent.startHeartbeat();
    agents.set(name, agent);

    if (residents.length > 1) {
      await new Promise((r) => setTimeout(r, REGISTER_STAGGER_MS));
    }
  }

  return agents;
}

export async function shutdownFleet(agents: Map<string, OACPAgent>): Promise<void> {
  await Promise.allSettled([...agents.values()].map((agent) => agent.shutdown()));
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🏙️ OACP Fleet Host starting...\n');

  // Never let a stray async error take the whole fleet down — the SDK turns
  // handler errors into task_error replies; anything that escapes is logged.
  process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled rejection (continuing):', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught exception (continuing):', err);
  });

  const agents = await bootFleet();
  console.log(`\n⏳ ${agents.size} resident(s) online, waiting for tasks... (Ctrl+C to stop)\n`);

  const shutdown = async () => {
    console.log('\n🛑 Shutting down fleet...');
    await shutdownFleet(agents);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
