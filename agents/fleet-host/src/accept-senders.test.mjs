/**
 * FLEET_ACCEPT_SENDERS — the fleet's allowlist of senders.
 *
 * Run: node --import tsx agents/fleet-host/src/accept-senders.test.mjs
 */
import assert from 'node:assert/strict';
import { parseAcceptSenders, acceptListedSenders } from './accept-senders.ts';

const A = '2d74ad67-76a9-4a0e-a43d-845ea678ddcf';
const B = '51c89079-f48a-426f-a54f-43e2eb28c47a';
const C = '9f78eac6-ab4d-4385-a9c9-049f844e6991';

let n = 0;
const test = async (name, fn) => { await fn(); console.log(`  ok  ${name}`); n++; };

await test('unset or empty means nobody', () => {
  assert.deepEqual(parseAcceptSenders(undefined), { ids: [], invalid: [] });
  assert.deepEqual(parseAcceptSenders('  '), { ids: [], invalid: [] });
});

await test('splits on commas, spaces and newlines', () => {
  assert.deepEqual(parseAcceptSenders(`${A}, ${B}\n${C}`).ids, [A, B, C]);
});

await test('drops duplicates, ignoring case', () => {
  assert.deepEqual(parseAcceptSenders(`${A},${A.toUpperCase()}`).ids, [A]);
});

await test('reports entries that are not agent IDs and keeps the rest', () => {
  const parsed = parseAcceptSenders(`${A},@matt/desktop,not-a-uuid`);
  assert.deepEqual(parsed.ids, [A]);
  assert.deepEqual(parsed.invalid, ['@matt/desktop', 'not-a-uuid']);
});

const fakeAgent = (failFor = []) => {
  const calls = [];
  return {
    calls,
    acceptSender: async (id) => {
      calls.push(id);
      if (failFor.includes(id)) throw new Error('Sender agent not found');
      return { sender_name: `agent-${id.slice(0, 4)}`, released_messages: id === A ? 1 : 0 };
    },
  };
};

await test('accepts every listed sender and logs releases', async () => {
  const agent = fakeAgent();
  const lines = [];
  const outcome = await acceptListedSenders({
    agent, residentName: 'pr-review-agent', residentAgentId: B, senderIds: [A, C], log: (l) => lines.push(l),
  });
  assert.deepEqual(agent.calls, [A, C]);
  assert.deepEqual(outcome, { accepted: [A, C], failed: [] });
  assert.match(lines[0], /1 held message\(s\) released/);
  assert.doesNotMatch(lines[1], /released/);
});

await test('a resident never tries to accept itself', async () => {
  const agent = fakeAgent();
  await acceptListedSenders({
    agent, residentName: 'pr-review-agent', residentAgentId: B.toUpperCase(), senderIds: [A, B], log: () => {},
  });
  assert.deepEqual(agent.calls, [A]);
});

await test('one failure does not stop the rest or throw', async () => {
  const agent = fakeAgent([A]);
  const lines = [];
  const outcome = await acceptListedSenders({
    agent, residentName: 'scribe-agent', residentAgentId: B, senderIds: [A, C], log: (l) => lines.push(l),
  });
  assert.deepEqual(outcome, { accepted: [C], failed: [A] });
  assert.match(lines[0], /could not accept sender .*Sender agent not found/);
});

console.log(`\n${n} passed`);
