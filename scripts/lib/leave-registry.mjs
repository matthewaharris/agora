/**
 * Take a script's scratch agents off the registry when it ends (RFC 009).
 *
 * Shutting an agent down only marks it offline; its card stays in the public
 * directory. Scratch agents use throwaway keys, so nobody can come back for
 * them later. They have to leave before the script exits.
 *
 * Never throws: a failed cleanup is reported and must not change a test's result.
 */
export async function leaveRegistry(agents, log = console.warn) {
  let left = 0;
  for (const agent of agents) {
    if (!agent) continue;
    try {
      if (typeof agent.deregister !== 'function') {
        log('scratch agent left behind: this oacp-sdk has no deregister() (needs RFC 009 support)');
        await agent.shutdown();
        continue;
      }
      await agent.deregister();
      left++;
    } catch (err) {
      log(`scratch agent left behind: ${String(err?.message ?? err).slice(0, 160)}`);
      await agent.shutdown().catch(() => {});
    }
  }
  return left;
}
