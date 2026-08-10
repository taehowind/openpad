import { randomUUID } from "node:crypto";
import type { Driver } from "@/lib/driver";
import { hashPassword } from "@/lib/password";
import { generateShareCode } from "@/lib/share";

// The table definitions below are written in the subset both SQLite and Postgres accept:
// TEXT/INTEGER columns, composite and partial indexes, CHECK constraints, and ON DELETE actions
// all mean the same thing in each. Timestamps are ISO strings and booleans are 0/1 integers, so
// application SQL never has to know which engine it is talking to.
const TABLES = `
  CREATE TABLE IF NOT EXISTS instructors (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'instructor' CHECK (role IN ('admin', 'instructor')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    share_token TEXT UNIQUE NOT NULL,
    share_mode TEXT NOT NULL DEFAULT 'readonly' CHECK (share_mode IN ('readonly', 'write')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS board_columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🙂',
    device_id TEXT,
    updated_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS device_profiles (
    device_id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT UNIQUE NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('teacher', 'guest')),
    author_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    link_url TEXT,
    file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS card_reactions (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    identity_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (card_id, identity_key)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('teacher', 'guest')),
    author_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    device_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS board_revisions (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('auto', 'final')),
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS presence (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    identity_key TEXT NOT NULL,
    participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('teacher', 'guest')),
    nickname TEXT NOT NULL,
    emoji TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (board_id, identity_key)
  );
  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT NOT NULL,
    hit_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('teacher', 'guest')),
    author_name TEXT NOT NULL,
    author_emoji TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

const INDEXES = `
  CREATE INDEX IF NOT EXISTS cards_board_idx ON cards(board_id, column_id, position);
  CREATE INDEX IF NOT EXISTS participants_board_idx ON participants(board_id);
  CREATE INDEX IF NOT EXISTS audit_board_idx ON audit_logs(board_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS revisions_board_idx ON board_revisions(board_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS presence_board_seen_idx ON presence(board_id, last_seen DESC);
  CREATE INDEX IF NOT EXISTS chat_board_idx ON chat_messages(board_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS reactions_card_idx ON card_reactions(card_id);
  CREATE INDEX IF NOT EXISTS comments_card_idx ON comments(card_id, created_at);
  CREATE INDEX IF NOT EXISTS rate_limits_bucket_idx ON rate_limits(bucket, hit_at);
  CREATE UNIQUE INDEX IF NOT EXISTS participants_board_device_unique ON participants(board_id, device_id) WHERE device_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS boards_share_code_unique ON boards(share_code) WHERE share_code IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS cards_share_code_unique ON cards(share_code) WHERE share_code IS NOT NULL;
  CREATE INDEX IF NOT EXISTS boards_owner_idx ON boards(owner_id);
`;

/** Columns added after the original schema shipped, applied in order on every start. */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ["participants", "emoji", "TEXT NOT NULL DEFAULT '🙂'"],
  ["participants", "device_id", "TEXT"],
  ["participants", "updated_at", "TEXT"],
  ["audit_logs", "device_id", "TEXT"],
  ["boards", "share_code", "TEXT"],
  ["boards", "owner_id", "TEXT"],
  ["boards", "audience", "TEXT NOT NULL DEFAULT 'link'"],
  ["boards", "access_password_hash", "TEXT"],
  ["boards", "type", "TEXT NOT NULL DEFAULT 'board'"],
  ["boards", "background", "TEXT NOT NULL DEFAULT 'default'"],
  ["cards", "share_code", "TEXT"],
  ["chat_messages", "hidden", "INTEGER NOT NULL DEFAULT 0"],
];

async function migrate(driver: Driver) {
  await driver.exec(TABLES);

  for (const [table, column, definition] of ADDED_COLUMNS) {
    const existing = await driver.columns(table);
    if (!existing.includes(column)) await driver.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // grid_col decides which vertical column a list sits in. Boards that predate it keep their
  // original left-to-right order, so the backfill mirrors position.
  const boardColumnFields = await driver.columns("board_columns");
  if (!boardColumnFields.includes("grid_col")) {
    await driver.exec("ALTER TABLE board_columns ADD COLUMN grid_col INTEGER NOT NULL DEFAULT 0");
    await driver.exec("UPDATE board_columns SET grid_col = position");
  }

  await driver.exec(INDEXES);
  await backfillShareCodes(driver, "boards");
  await backfillShareCodes(driver, "cards");
  await seedAdminInstructor(driver);
}

/**
 * Runs the schema bootstrap once. On Postgres it runs inside a single transaction holding a
 * transaction-scoped advisory lock: serverless cold starts can fire several instances at the same
 * moment, and concurrent CREATE TABLE / CREATE INDEX statements race on the system catalogue.
 *
 * Both halves of that sentence matter, because a connection pooler in transaction mode (Supabase's
 * is, on port 6543) gives each *transaction* whichever backend is free rather than keeping one per
 * client. Taking a session-scoped pg_advisory_lock in one statement and releasing it in another —
 * which is what this used to do — fails three ways at once there, all three reproduced against a
 * real project: two instances get handed the same backend and both "acquire" the lock, so it
 * excludes nothing; the unlock lands on a backend that never held it and returns false; and the
 * lock then survives on the original backend, blocking every later cold start until that backend
 * is terminated. A transaction is pinned to one backend for its whole life, and
 * pg_advisory_xact_lock is released by COMMIT, so none of the three can happen.
 */
export async function applySchema(driver: Driver) {
  if (driver.dialect !== "postgres") return migrate(driver);

  const LOCK_KEY = 8_147_326_155; // arbitrary but stable, namespaced to this app
  await driver.transaction(async () => {
    await driver.exec(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    await migrate(driver);
  });
}

// Bootstrap a super-admin from env so the very first login works without a pre-seeded database.
async function seedAdminInstructor(driver: Driver) {
  const email = (process.env.ADMIN_EMAIL ?? "admin@ai-study.local").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return;
  const existing = await driver.all("SELECT 1 FROM instructors WHERE role = 'admin' LIMIT 1", []);
  if (existing.length > 0) return;
  const timestamp = new Date().toISOString();
  await driver.run(
    `INSERT INTO instructors (id, email, name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)
     ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'active',
       password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
    [randomUUID(), email, "관리자", hashPassword(password), timestamp, timestamp],
  );
}

// Rows created before short links existed get one assigned on the next start.
async function backfillShareCodes(driver: Driver, table: "boards" | "cards") {
  const pending = await driver.all(`SELECT id FROM ${table} WHERE share_code IS NULL`, []);
  for (const row of pending as { id: string }[]) {
    let code = generateShareCode();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const clash = await driver.all(`SELECT 1 FROM ${table} WHERE share_code = ?`, [code]);
      if (clash.length === 0) break;
      code = generateShareCode();
    }
    await driver.run(`UPDATE ${table} SET share_code = ? WHERE id = ?`, [code, row.id]);
  }
}
