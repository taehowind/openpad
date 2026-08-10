import { randomUUID } from "node:crypto";
import { all, get, run } from "@/lib/db";
import { notifyBoard } from "@/lib/events";
import { generateShareCode } from "@/lib/share";
import type { ShareMode } from "@/lib/types";

export type BoardAudience = "link" | "members";
export type BoardType = "board" | "gallery";

export type BoardRow = {
  id: string;
  title: string;
  description: string;
  share_token: string;
  share_code: string;
  share_mode: ShareMode;
  owner_id: string | null;
  audience: BoardAudience;
  access_password_hash: string | null;
  type: BoardType;
  background: string;
  created_at: string;
  updated_at: string;
};

export type Actor = {
  type: "teacher" | "guest" | "system";
  name: string;
  emoji?: string;
  participantId?: string;
  deviceId?: string;
  /** Set for teachers so presence and reactions can tell two instructors apart. */
  instructorId?: string;
};

export const now = () => new Date().toISOString();

export async function getBoardById(id: string) {
  return (await get<BoardRow>("SELECT * FROM boards WHERE id = ?", id));
}

export async function getBoardByToken(token: string) {
  return (await get<BoardRow>("SELECT * FROM boards WHERE share_token = ?", token));
}

// Resolves the board from either the long secure token or the short human-typable code.
export async function getBoardByShareId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return (await get<BoardRow>(
    "SELECT * FROM boards WHERE share_token = ? OR share_code = ?",
    trimmed, trimmed.toUpperCase(),
  ));
}

export async function uniqueShareCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateShareCode();
    if (!(await get("SELECT 1 FROM boards WHERE share_code = ?", code))) return code;
  }
  return generateShareCode(10);
}

export async function uniqueCardShareCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateShareCode();
    if (!(await get("SELECT 1 FROM cards WHERE share_code = ?", code))) return code;
  }
  return generateShareCode(10);
}

/** Next free position at the end of a column. Replaces a Date.now() stamp, which overflowed
 *  Postgres INTEGER — positions only ever need to be monotonic within their column. */
export async function nextCardPosition(columnId: string) {
  const row = await get<{ value: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS value FROM cards WHERE column_id = ?", columnId,
  );
  return row?.value ?? 0;
}

export async function getCardByShareCode(code: string) {
  return (await get<{ id: string; board_id: string; file_id: string | null }>(
    "SELECT id, board_id, file_id FROM cards WHERE share_code = ?", code.trim().toUpperCase(),
  ));
}

async function readState(boardId: string) {
  const board = (await getBoardById(boardId));
  if (!board) throw new Error("Board not found");
  return {
    board: { title: board.title, description: board.description, shareMode: board.share_mode },
    columns: (await all<Record<string, unknown>>("SELECT * FROM board_columns WHERE board_id = ? ORDER BY position", boardId)),
    cards: (await all<Record<string, unknown>>("SELECT * FROM cards WHERE board_id = ? ORDER BY position", boardId)),
    comments: (await all<Record<string, unknown>>(
      "SELECT c.* FROM comments c JOIN cards x ON x.id = c.card_id WHERE x.board_id = ? ORDER BY c.created_at",
      boardId,
    )),
  };
}

// Every teacher action snapshots the whole board, so old automatic snapshots are trimmed.
// Manual "final" saves are never pruned — those are the ones a teacher deliberately kept.
const MAX_AUTO_REVISIONS = 40;
const MAX_AUDIT_ENTRIES = 500;

export async function createRevision(boardId: string, label: string, kind: "auto" | "final") {
  const id = randomUUID();
  (await run(
    "INSERT INTO board_revisions (id, board_id, label, kind, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, boardId, label, kind, JSON.stringify(await readState(boardId)), now(),
  ));
  if (kind === "auto") {
    (await run(
      `DELETE FROM board_revisions WHERE board_id = ? AND kind = 'auto' AND id NOT IN (
         SELECT id FROM board_revisions WHERE board_id = ? AND kind = 'auto'
          ORDER BY created_at DESC, id DESC LIMIT ?)`,
      boardId, boardId, MAX_AUTO_REVISIONS,
    ));
  }
  return id;
}

export async function recordAction(
  boardId: string,
  actor: Actor,
  action: string,
  entityType: string,
  entityId?: string,
  details: Record<string, unknown> = {},
  snapshotTeacher = true,
) {
  (await run(
    `INSERT INTO audit_logs
      (id, board_id, actor_type, actor_name, action, entity_type, entity_id, device_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), boardId, actor.type, actor.name, action, entityType, entityId ?? null,
    actor.deviceId ?? null, JSON.stringify(details), now(),
  ));
  // The board view only ever reads the newest 100 entries; keep a margin and drop the rest.
  (await run(
    `DELETE FROM audit_logs WHERE board_id = ? AND id NOT IN (
       SELECT id FROM audit_logs WHERE board_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
    boardId, boardId, MAX_AUDIT_ENTRIES,
  ));
  if (actor.type === "teacher" && snapshotTeacher) (await createRevision(boardId, action, "auto"));
  notifyBoard(boardId);
}

export async function touchPresence(boardId: string, actor: Actor) {
  const identityKey = actor.type === "teacher"
    ? (actor.instructorId ? `ins:${actor.instructorId}` : "teacher")
    : actor.participantId ?? actor.deviceId;
  if (!identityKey || actor.type === "system") return;
  (await run(`INSERT INTO presence (board_id, identity_key, participant_id, actor_type, nickname, emoji, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(board_id, identity_key) DO UPDATE SET
         participant_id = excluded.participant_id,
         actor_type = excluded.actor_type,
         nickname = excluded.nickname,
         emoji = excluded.emoji,
         last_seen = excluded.last_seen`,
    boardId, identityKey, actor.participantId ?? null, actor.type, actor.name,
    actor.emoji ?? (actor.type === "teacher" ? "🧑‍🏫" : "🙂"), now()));
}

export async function restoreRevision(boardId: string, revisionId: string) {
  const revision = (await get<{ state_json: string }>(
    "SELECT state_json FROM board_revisions WHERE id = ? AND board_id = ?",
    revisionId, boardId,
  ));
  if (!revision) return false;
  const state = JSON.parse(revision.state_json) as {
    board: { title: string; description: string; shareMode: ShareMode };
    columns: Record<string, string | number | null>[];
    cards: Record<string, string | number | null>[];
    comments: Record<string, string | number | null>[];
  };
  // Uses the shared helpers rather than driver-level prepared statements so the restore runs
  // unchanged on either engine. Callers wrap this in a transaction.
  await run("DELETE FROM comments WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?)", boardId);
  await run("DELETE FROM cards WHERE board_id = ?", boardId);
  await run("DELETE FROM board_columns WHERE board_id = ?", boardId);
  await run("UPDATE boards SET title = ?, description = ?, share_mode = ?, updated_at = ? WHERE id = ?",
    state.board.title, state.board.description, state.board.shareMode, now(), boardId);

  for (const column of state.columns) {
    await run("INSERT INTO board_columns (id, board_id, name, color, position, grid_col) VALUES (?, ?, ?, ?, ?, ?)",
      column.id, boardId, column.name, column.color, column.position, column.grid_col ?? column.position ?? 0);
  }
  // share_code must survive a restore — it is the short link printed on handouts and QR codes.
  for (const card of state.cards) {
    await run(`INSERT INTO cards
      (id, board_id, column_id, participant_id, actor_type, author_name, title, content, link_url, file_id, share_code, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      card.id, boardId, card.column_id, card.participant_id, card.actor_type, card.author_name,
      card.title, card.content, card.link_url, card.file_id, card.share_code ?? (await uniqueCardShareCode()),
      card.position, card.created_at, card.updated_at);
  }
  for (const comment of state.comments) {
    await run(`INSERT INTO comments
      (id, card_id, participant_id, actor_type, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      comment.id, comment.card_id, comment.participant_id, comment.actor_type,
      comment.author_name, comment.content, comment.created_at);
  }
  return true;
}

