/**
 * Structured server-side error logging.
 *
 * Next logs an uncaught throw from a route on its own, so the gap this fills is the opposite case:
 * errors we *catch* and turn into a tidy user-facing response. Those disappear entirely — a
 * storage outage reaches the reader as "파일을 찾을 수 없습니다" and leaves nothing behind to say
 * the bucket was unreachable. One line on the way past keeps the answer to the user friendly and
 * the cause visible in the platform log.
 *
 * JSON on a single line because that is what log aggregators can filter on; never include the
 * request body, cookies or any credential.
 */
export function logError(scope: string, error: unknown, context: Record<string, string | number | boolean | null | undefined> = {}) {
  const detail = error instanceof Error
    ? { message: error.message, name: error.name, cause: error.cause instanceof Error ? error.cause.message : undefined }
    : { message: String(error) };
  console.error(JSON.stringify({ level: "error", scope, ...detail, ...context, at: new Date().toISOString() }));
}
