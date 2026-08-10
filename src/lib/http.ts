import { NextResponse } from "next/server";
import { all, run } from "@/lib/db";
import { isServerless } from "@/lib/runtime";

export function apiError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// The reverse proxy appends the real peer to X-Forwarded-For, so the LAST hop is the one we
// control — reading the first entry would let a client spoof its way around every rate limit.
export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

const buckets = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5_000) {
    for (const [bucketKey, values] of buckets) {
      if (!values.some((time) => now - time < windowMs)) buckets.delete(bucketKey);
    }
  }
  return false;
}

/**
 * Rate limit that survives having more than one instance.
 *
 * The in-memory limiter above keeps its counters per process, so on serverless every limit is
 * effectively multiplied by the number of live instances — fine for spam control, not fine for
 * password guessing. Auth paths use this instead, which counts in the database.
 *
 * Single-process deployments skip the round trip and fall through to the in-memory version.
 */
export async function rateLimitedShared(key: string, limit: number, windowMs: number) {
  if (!isServerless()) return rateLimited(key, limit, windowMs);
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  await run("DELETE FROM rate_limits WHERE hit_at < ?", cutoff);
  const recent = await all<{ n: number }>(
    "SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND hit_at >= ?", key, cutoff,
  );
  if ((recent[0]?.n ?? 0) >= limit) return true;
  await run("INSERT INTO rate_limits (bucket, hit_at) VALUES (?, ?)", key, new Date().toISOString());
  return false;
}
