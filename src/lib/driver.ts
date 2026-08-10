import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type SqlValue = string | number | bigint | boolean | null | Uint8Array;
export type Row = Record<string, unknown>;

/**
 * A minimal database driver. Two implementations exist:
 *
 *   - sqlite   — node:sqlite, the default. Self-hosting keeps a single file on a volume.
 *   - postgres — used when DATABASE_URL is set, e.g. Supabase behind Vercel.
 *
 * Application SQL is written once, with `?` placeholders and syntax both engines accept; the
 * Postgres adapter rewrites `?` to `$n`. Anything that genuinely cannot be shared (the schema
 * DDL, column introspection) is branched behind `dialect`.
 */
export type Driver = {
  dialect: "sqlite" | "postgres";
  all(sql: string, values: SqlValue[]): Promise<Row[]>;
  run(sql: string, values: SqlValue[]): Promise<void>;
  exec(sql: string): Promise<void>;
  /** Runs `fn` with every nested query pinned to one connection, committing or rolling back. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Column names of a table, used by the lightweight migrations in schema.ts. */
  columns(table: string): Promise<string[]>;
  close(): Promise<void>;
};

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

async function createSqliteDriver(): Promise<Driver> {
  const { DatabaseSync } = await import("node:sqlite");
  const file = process.env.SQLITE_PATH ?? "/data/aistudy.sqlite";
  mkdirSync(path.dirname(file) || ".", { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");

  // node:sqlite is synchronous and holds a single connection, so an async transaction body could
  // otherwise let a second request interleave its own BEGIN between ours — SQLite has no nested
  // transactions, and the two would commit as one. This chain serialises them instead.
  let queue: Promise<unknown> = Promise.resolve();
  let depth = 0;

  return {
    dialect: "sqlite",
    async all(sql, values) { return db.prepare(sql).all(...(values as never[])) as Row[]; },
    async run(sql, values) { db.prepare(sql).run(...(values as never[])); },
    async exec(sql) { db.exec(sql); },
    async columns(table) {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      return rows.map((row) => row.name);
    },
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      // Already inside one: join it rather than nesting, matching the Postgres behaviour.
      if (depth > 0) return fn();
      const run = async () => {
        depth += 1;
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          try { db.exec("ROLLBACK"); } catch { /* connection already unwound */ }
          throw error;
        } finally {
          depth -= 1;
        }
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
    async close() { db.close(); },
  };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/** `?` → `$1, $2, …`, skipping anything inside quotes so string literals survive untouched. */
export function toPositional(sql: string) {
  let out = "";
  let index = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quote) {
      out += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; out += char; continue; }
    if (char === "?") { index += 1; out += `$${index}`; continue; }
    out += char;
  }
  return out;
}

async function createPostgresDriver(url: string): Promise<Driver> {
  const pg = await import("pg");
  const { Pool, types } = pg;

  // node-postgres hands back int8 (bigint) as a string to avoid precision loss. Everything this
  // app stores in one — COUNT(*), positions, sizes — is far inside Number.MAX_SAFE_INTEGER, and
  // the callers compare against numbers, so parse it like SQLite already does.
  types.setTypeParser(20, (value: string) => Number(value));
  const pool = new Pool({
    connectionString: url,
    // Serverless invocations are short-lived and Supabase pools connections upstream, so keep
    // this small and let idle sockets go rather than pinning them per lambda.
    max: Number(process.env.PGPOOL_MAX ?? 4),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ...(url.includes("sslmode=disable") ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  // Nested queries have to reach the transaction's own client, otherwise they would take a
  // different pooled connection and sit outside the transaction entirely.
  const context = new AsyncLocalStorage<{ query: (sql: string, values: SqlValue[]) => Promise<{ rows: Row[] }> }>();

  const query = async (sql: string, values: SqlValue[]) => {
    const active = context.getStore();
    if (active) return active.query(toPositional(sql), values);
    return pool.query(toPositional(sql), values) as Promise<{ rows: Row[] }>;
  };

  return {
    dialect: "postgres",
    async all(sql, values) { return (await query(sql, values)).rows; },
    async run(sql, values) { await query(sql, values); },
    async exec(sql) {
      const active = context.getStore();
      if (active) await active.query(sql, []); else await pool.query(sql);
    },
    async columns(table) {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
        [table],
      );
      return result.rows.map((row: { column_name: string }) => row.column_name);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (context.getStore()) return fn();
      const client = await pool.connect();
      const scoped = { query: (sql: string, values: SqlValue[]) => client.query(sql, values) as Promise<{ rows: Row[] }> };
      try {
        await client.query("BEGIN");
        const result = await context.run(scoped, fn);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

export function createDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL?.trim();
  return url ? createPostgresDriver(url) : createSqliteDriver();
}
