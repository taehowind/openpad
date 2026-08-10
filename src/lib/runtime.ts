/**
 * Which deployment shape we are running in.
 *
 * Two things behave differently on serverless: the SSE stream is backed by an in-process
 * EventEmitter (invisible to other instances), and the rate limiter keeps its counters in
 * memory (so N instances multiply every limit by N). Both are fine on a single long-lived
 * server and both need a different answer on Vercel.
 */
export function isServerless() {
  // Vercel sets VERCEL=1 on every deployment; the override exists so self-hosters running
  // multiple app instances behind a load balancer can opt into the same behaviour.
  return process.env.VERCEL === "1" || process.env.SERVERLESS === "1";
}

/** Push updates only work when one process serves every subscriber for a board. */
export function supportsRealtimePush() {
  return !isServerless();
}
