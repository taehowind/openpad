import { createDriver, type Driver, type SqlValue } from "@/lib/driver";
import { logError } from "@/lib/log";
import { applySchema } from "@/lib/schema";

/**
 * The one way the app talks to its database.
 *
 * Every helper is async so the same code runs on node:sqlite (self-hosting, the default) and on
 * Postgres (Supabase behind Vercel, selected by DATABASE_URL). Write SQL once, with `?`
 * placeholders — the Postgres adapter rewrites them to $n.
 */
let ready: Promise<Driver> | null = null;

function connect(): Promise<Driver> {
  // Cached as a promise, not an instance, so concurrent first calls share one bootstrap instead
  // of racing to create the schema.
  ready ??= (async () => {
    const driver = await createDriver();
    await applySchema(driver);
    return driver;
  })().catch((error) => {
    ready = null; // let the next request retry rather than wedging the process
    logError("db.connect", error, { dialect: process.env.DATABASE_URL ? "postgres" : "sqlite" });
    throw error;
  });
  return ready;
}

/** Exposed for tooling (migrations, tests) that needs the driver itself. */
export function getDriver() {
  return connect();
}

export async function all<T>(sql: string, ...values: SqlValue[]): Promise<T[]> {
  return (await (await connect()).all(sql, values)) as T[];
}

export async function get<T>(sql: string, ...values: SqlValue[]): Promise<T | undefined> {
  const rows = await (await connect()).all(sql, values);
  return rows[0] as T | undefined;
}

export async function run(sql: string, ...values: SqlValue[]): Promise<void> {
  await (await connect()).run(sql, values);
}

/**
 * Runs `callback` inside a transaction. Queries made within it — including from functions it
 * calls — are pinned to the transaction's own connection, so they commit or roll back together.
 */
export async function transaction<T>(callback: () => Promise<T>): Promise<T> {
  return (await connect()).transaction(callback);
}
