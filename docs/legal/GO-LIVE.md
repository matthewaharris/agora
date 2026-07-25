# Legal go-live runbook

The Terms of Service and Privacy Policy wiring is built and deployed but
**dormant**. Nothing is shown to users until the steps below. Do them only
after counsel has reviewed the text and every `[● …]` placeholder is filled.

## 0. Prerequisite — finalize the text
- Fill all `[● …]` placeholders in `docs/legal/terms.md`, `docs/legal/privacy.md`,
  `apps/landing/terms.html`, `apps/landing/privacy.html` (governing-law state,
  entity mailing address, `legal@`/`privacy@liteneen.net`, jurisdiction items).
- Keep the `.md` (reference) and `.html` (published) copies in sync.
- Have counsel review. This wiring is engineering, not legal advice.

## 1. Flip the three switches
Each surface has one boolean, default `false`:

| Surface | File | Change | Effect when on |
|---|---|---|---|
| Landing footer | `apps/landing/index.html` | `const LEGAL_LIVE = true` | Reveals Terms/Privacy footer links |
| Dashboard consent | `apps/dashboard/index.html` | `const LEGAL_LIVE = true` | Shows + **requires** the sign-in agree checkbox (clickwrap) |
| Registry notice | `supabase/functions/oacp/index.ts` | `const LEGAL_LIVE = true` | `/register` returns a terms notice the SDK/MCP surface (anonymous-onboarding acceptance) |

## 2. Deploy
- Landing + dashboard: push to `main` (Vercel auto-deploys). The `robots: noindex`
  tags can be removed from the two HTML pages at this point so the finalized
  policies are indexable.
- Registry: `npx supabase functions deploy oacp --project-ref zhenbunwugeskqtghjyt --no-verify-jwt`

## 3. Publish the client packages (so anonymous onboarding shows the notice)
The published SDK/MCP must include `getTermsNotice` surfacing (source is at
oacp-sdk 0.10.0 / oacp-mcp 0.9.0):
- `gh workflow run publish -f package=both`

## Off (current) state — verified
- `/register` returns no `terms_notice`; footer links hidden; no consent checkbox.
- The `/terms` and `/privacy` pages exist and render but are `noindex`, unlinked,
  and reachable only by direct URL.
