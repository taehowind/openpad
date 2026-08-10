import type { NextConfig } from "next";

/**
 * Where the browser uploads attachments directly, that origin has to be reachable from the page.
 * Serverless caps request bodies at 4.5MB, under our 10MB attachment limit, so on object storage
 * the bytes only ever travel browser -> bucket (see src/lib/storage.ts and BoardClient's
 * attachFile). With `connect-src 'self'` alone the browser blocks that PUT outright and large
 * attachments cannot be uploaded at all.
 *
 * Only the configured bucket host is allowed, and only when one is configured, so a self-hosted
 * deployment — which uploads through the API and needs no such exception — keeps the tighter
 * policy. Headers are baked in at build time, so changing SUPABASE_URL needs a redeploy.
 */
const storageOrigin = (() => {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return null;
  try { return new URL(raw).origin; } catch { return null; }
})();

// Next injects inline bootstrap/hydration scripts and Tailwind ships inline styles, so those two
// directives must stay permissive. Everything else is locked down: no third-party scripts, no
// plugins, no <base> hijacking, and forms can only post back to us.
const appCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${storageOrigin ? ` ${storageOrigin}` : ""}`,
  // Gallery works are same-origin documents shown in an iframe; each carries its own sandbox CSP.
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Routes that serve uploaded content set their own restrictive `sandbox` CSP per response.
// They are excluded here so this config cannot overwrite it.
const USER_CONTENT = "api/embed|api/files|g/";

const nextConfig: NextConfig = {
  // "standalone" produces the self-contained server the Dockerfile copies. Vercel builds its
  // own output and does not want it, so only emit it when self-hosting.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  poweredByHeader: false,
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    // HSTS belongs to the TLS terminator (see deploy/Caddyfile). Setting it here too would merge
    // into one comma-joined value, which browsers may discard entirely.
    return [
      {
        // The app itself: never framed, locked-down CSP.
        source: `/((?!${USER_CONTENT}).*)`,
        headers: [...base, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: appCsp }],
      },
      {
        // Gallery works must be embeddable by our own pages (sandboxed to an opaque origin).
        source: "/api/embed/:path*",
        headers: [...base, { key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      {
        // Short gallery links and file downloads open top-level but are never framed.
        source: "/g/:path*",
        headers: [...base, { key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/api/files/:path*",
        headers: [...base, { key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
