import { randomUUID } from "node:crypto";
import { getInstructorSession, resolveParticipantForBoard, type InstructorSession } from "@/lib/auth";
import type { BoardRow } from "@/lib/board-data";
import { get, run } from "@/lib/db";

export function canManageBoard(board: BoardRow, session: InstructorSession | null) {
  return !!session && (session.role === "admin" || board.owner_id === session.id);
}

// Returns the instructor session only if they may manage this board (owner or super-admin).
export async function boardManager(board: BoardRow) {
  const session = await getInstructorSession();
  return (await canManageBoard(board, session)) ? session : null;
}

// Ensures a member (non-owner instructor) has a participant row so they can post like a guest.
export async function ensureMemberParticipant(board: BoardRow, session: InstructorSession) {
  const key = `ins:${session.id}`;
  const existing = (await get<{ id: string; nickname: string; emoji: string }>(
    "SELECT id, nickname, emoji FROM participants WHERE board_id = ? AND device_id = ?", board.id, key,
  ));
  if (existing) return { id: existing.id, nickname: existing.nickname, emoji: existing.emoji, deviceId: key };
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  // Concurrent requests (page load + SSE + heartbeat) can race here, so let the unique
  // index arbitrate and read back whichever row won.
  (await run(
    `INSERT INTO participants (id, board_id, nickname, emoji, device_id, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    id, board.id, session.name, "🎓", key, timestamp, timestamp,
  ));
  const row = (await get<{ id: string; nickname: string; emoji: string }>(
    "SELECT id, nickname, emoji FROM participants WHERE board_id = ? AND device_id = ?", board.id, key,
  ));
  return row
    ? { id: row.id, nickname: row.nickname, emoji: row.emoji, deviceId: key }
    : { id, nickname: session.name, emoji: "🎓", deviceId: key };
}

// Gallery works are served raw (sandboxed HTML) outside the board payload, so they need their
// own gate: only a board that is both link-shared AND unprotected is readable by anyone.
export async function canViewBoardContent(board: BoardRow) {
  if (board.audience === "link" && !board.access_password && !board.access_password_hash) return true;
  return Boolean(await actorForBoard(board, false));
}

export async function actorForBoard(board: BoardRow, requireWrite = false) {
  const session = await getInstructorSession();

  // Owner or super-admin → full teacher control. The identity key is per-instructor so two
  // teachers on the same board are counted (and can react) separately.
  if ((await canManageBoard(board, session))) {
    return {
      isAdmin: true,
      identityKey: `ins:${session!.id}`,
      actor: { type: "teacher" as const, name: "강사", emoji: "🧑‍🏫", deviceId: "teacher", instructorId: session!.id },
      participant: null,
    };
  }

  // Members-only boards: anonymous students are blocked; other active members participate per share mode.
  if (board.audience === "members") {
    if (!session) return null;
    if (requireWrite && board.share_mode !== "write") return null;
    const member = (await ensureMemberParticipant(board, session));
    return {
      isAdmin: false,
      identityKey: member.id,
      actor: { type: "guest" as const, name: member.nickname, emoji: member.emoji, participantId: member.id, deviceId: member.deviceId },
      participant: { participantId: member.id, boardId: board.id, nickname: member.nickname, emoji: member.emoji, deviceId: member.deviceId },
    };
  }

  // Link boards: anonymous students via the device/profile flow.
  const participant = await resolveParticipantForBoard(board.id);
  if (!participant) return null;
  if (requireWrite && board.share_mode !== "write") return null;
  return {
    isAdmin: false,
    identityKey: participant.id,
    actor: {
      type: "guest" as const,
      name: participant.nickname,
      emoji: participant.emoji,
      participantId: participant.id,
      deviceId: participant.deviceId ?? undefined,
    },
    participant: {
      participantId: participant.id,
      boardId: participant.boardId,
      nickname: participant.nickname,
      emoji: participant.emoji,
      deviceId: participant.deviceId ?? undefined,
    },
  };
}
