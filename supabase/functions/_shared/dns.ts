/**
 * DNS-over-HTTPS domain verification (RFC 002 §4).
 *
 * Shared by the registry (claim time) and the cron (periodic re-check) so
 * both sides apply exactly the same proof rule. The edge runtime has no raw
 * resolver access, so this goes over DoH with a fallback resolver.
 */

/**
 * Verify that _oacp.<domain> publishes "oacp-owner-key=<ownerPublicKey>".
 *
 * `found` returns whatever TXT records were seen, so a caller can tell
 * "record missing entirely" from "record present but holds a stale key" —
 * the second is the case worth alerting a human about.
 */
export async function verifyDomainOwnerKey(
  domain: string,
  ownerPublicKey: string,
): Promise<{ ok: boolean; found: string[]; resolved: boolean }> {
  const name = `_oacp.${domain}`;
  const resolvers = [
    `https://cloudflare-dns.com/dns-query?name=${name}&type=TXT`,
    `https://dns.google/resolve?name=${name}&type=TXT`,
  ];
  const found: string[] = [];
  let resolved = false;

  for (const url of resolvers) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
      if (!res.ok) continue;
      const data = await res.json();
      resolved = true;
      for (const answer of data.Answer ?? []) {
        // TXT data arrives quoted (and possibly chunked): "part1" "part2"
        const txt = String(answer.data ?? '').replaceAll('"', '').replaceAll(' ', '');
        found.push(txt);
        if (txt === `oacp-owner-key=${ownerPublicKey.toLowerCase()}`) {
          return { ok: true, found, resolved: true };
        }
      }
      if (found.length > 0) break; // records exist but none matched
    } catch {
      // try the next resolver
    }
  }
  return { ok: false, found, resolved };
}
