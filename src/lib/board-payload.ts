import { all } from "@/lib/db";
import { normalizeBackground } from "@/lib/backgrounds";
import type { BoardRow } from "@/lib/board-data";
import { supportsRealtimePush } from "@/lib/runtime";
import type { AuditEntry, BoardPayload, RevisionEntry } from "@/lib/types";

/**
 * Builds the whole view of a board that the client renders.
 *
 * Kept apart from board-data.ts, which is lookups and writes. This is the read side, it is the
 * single hottest route in the app — every open board polls it on a timer — and it is where the
 * rules about what a student may see are enforced. Those are three good reasons for it to be one
 * file you can hold in your head rather than the tail of a grab bag.
 *
 * Admin-only fields (share token, audience, audit log, revision list) are added by this function
 * and nowhere else, so there is exactly one place to check when asking "can a student see this?".
 */
export async function getBoardPayload(
  board: BoardRow,
  viewer: { isAdmin: boolean; identityKey?: string; participantId?: string; nickname?: string; emoji?: string },
): Promise<BoardPayload> {
  const reactionIdentity = viewer.identityKey ?? (viewer.isAdmin ? "teacher" : viewer.participantId ?? "");
  const activeCutoff = new Date(Date.now() - 30_000).toISOString();

  /**
   * None of these reads depends on another, so they go out together instead of one after the next.
   * This is the route every open board polls on a timer, so it is worth the care: eight sequential
   * round trips is eight times the latency for no reason, and the cost shows up per viewer.
   *
   * The audit log is admin-only in the response. It used to be fetched for everyone and thrown
   * away for students — a hundred rows read, shipped and JSON-parsed on every poll of every
   * student's browser, to be discarded. It is now requested only when it will be used, as the
   * revision list already was.
   */
  const [columnRows, commentRows, reactionRows, cardRows, activityRows, revisionRows, presenceRows, chatRows] = await Promise.all([
    all<{ id: string; name: string; color: string; position: number; grid_col: number }>(
      "SELECT id, name, color, position, grid_col FROM board_columns WHERE board_id = ? ORDER BY grid_col, position",
      board.id,
    ),
    all<{ card_id: string; cnt: number }>(
      `SELECT c.card_id, COUNT(*) AS cnt
         FROM comments c JOIN cards x ON x.id = c.card_id
        WHERE x.board_id = ? GROUP BY c.card_id`, board.id),
    all<{ card_id: string; cnt: number; mine: number }>(
      `SELECT r.card_id, COUNT(*) AS cnt, MAX(CASE WHEN r.identity_key = ? THEN 1 ELSE 0 END) AS mine
         FROM card_reactions r JOIN cards x ON x.id = r.card_id
        WHERE x.board_id = ? GROUP BY r.card_id`, reactionIdentity, board.id),
    all<{
      id: string; column_id: string; participant_id: string | null; author_name: string; author_emoji: string; actor_type: "teacher" | "guest"; title: string;
      content: string; link_url: string | null; file_id: string | null; original_name: string | null; share_code: string | null;
      mime_type: string | null; size_bytes: number | null; position: number; created_at: string; updated_at: string;
    }>(`SELECT x.id, x.column_id, x.participant_id, COALESCE(p.nickname, x.author_name) AS author_name,
               CASE WHEN x.actor_type = 'teacher' THEN '🧑‍🏫' ELSE COALESCE(p.emoji, '🙂') END AS author_emoji,
               x.actor_type, x.title, x.content, x.link_url, x.file_id, x.share_code,
               f.original_name, f.mime_type, f.size_bytes, x.position, x.created_at, x.updated_at
          FROM cards x LEFT JOIN files f ON f.id = x.file_id
          LEFT JOIN participants p ON p.id = x.participant_id
         WHERE x.board_id = ? ORDER BY x.position`, board.id),
    viewer.isAdmin ? all<{
      id: string; actor_type: AuditEntry["actorType"]; actor_name: string; action: string; entity_type: string;
      device_id: string | null; details_json: string; created_at: string;
    }>(`SELECT id, actor_type, actor_name, action, entity_type, device_id, details_json, created_at
          FROM audit_logs WHERE board_id = ? ORDER BY created_at DESC LIMIT 100`, board.id) : [],
    viewer.isAdmin ? all<{ id: string; label: string; kind: RevisionEntry["kind"]; created_at: string }>(
      `SELECT id, label, kind, created_at FROM board_revisions
        WHERE board_id = ? ORDER BY created_at DESC LIMIT 100`, board.id) : [],
    all<{ identity_key: string; nickname: string; emoji: string; actor_type: "teacher" | "guest" }>(
      `SELECT identity_key, nickname, emoji, actor_type FROM presence
        WHERE board_id = ? AND last_seen >= ? ORDER BY actor_type, last_seen DESC`, board.id, activeCutoff),
    all<{
      id: string; author_name: string; author_emoji: string; actor_type: "teacher" | "guest"; content: string; created_at: string; hidden: number;
    }>(`SELECT m.id, COALESCE(p.nickname, m.author_name) AS author_name,
               CASE WHEN m.actor_type = 'teacher' THEN '🧑‍🏫' ELSE COALESCE(p.emoji, m.author_emoji) END AS author_emoji,
               m.actor_type, m.content, m.created_at, m.hidden
          FROM chat_messages m LEFT JOIN participants p ON p.id = m.participant_id
         WHERE m.board_id = ? ORDER BY m.created_at DESC LIMIT 200`, board.id),
  ]);

  const columns = columnRows.map((column) => ({ id: column.id, name: column.name, color: column.color, position: column.position, gridCol: column.grid_col }));
  const commentCounts = new Map(commentRows.map((row) => [row.card_id, row.cnt]));
  const reactionMap = new Map(reactionRows.map((row) => [row.card_id, { count: row.cnt, mine: row.mine === 1 }]));
  const cards = cardRows.map((card) => ({
    id: card.id,
    columnId: card.column_id,
    shareCode: card.share_code,
    authorId: card.participant_id,
    authorName: card.author_name,
    authorEmoji: card.author_emoji,
    actorType: card.actor_type,
    title: card.title,
    content: card.content,
    linkUrl: card.link_url,
    fileId: card.file_id,
    fileName: card.original_name,
    fileType: card.mime_type,
    fileSize: card.size_bytes,
    position: card.position,
    createdAt: card.created_at,
    updatedAt: card.updated_at,
    likeCount: reactionMap.get(card.id)?.count ?? 0,
    likedByMe: reactionMap.get(card.id)?.mine ?? false,
    commentCount: commentCounts.get(card.id) ?? 0,
  }));
  const activity = activityRows.map((item) => ({
    id: item.id,
    actorType: item.actor_type,
    actorName: item.actor_name,
    action: item.action,
    entityType: item.entity_type,
    details: {
      ...JSON.parse(item.details_json),
      ...(item.device_id && item.device_id !== "teacher" ? { deviceKey: item.device_id.slice(0, 8) } : {}),
    },
    createdAt: item.created_at,
  }));
  const revisions = revisionRows.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    createdAt: item.created_at,
  }));
  const activeViewers = presenceRows.map((item) => ({
    id: item.identity_key,
    nickname: item.nickname,
    emoji: item.emoji,
    actorType: item.actor_type,
  }));
  const chatMessages = chatRows.reverse().map((message) => ({
    id: message.id,
    authorName: message.author_name,
    authorEmoji: message.author_emoji,
    actorType: message.actor_type,
    // Masked content is not sent to students; teachers still receive it so they can review/unhide.
    content: message.hidden && !viewer.isAdmin ? "" : message.content,
    createdAt: message.created_at,
    hidden: Boolean(message.hidden),
  }));
  return {
    board: {
      id: board.id,
      title: board.title,
      description: board.description,
      shareMode: board.share_mode,
      type: board.type,
      background: normalizeBackground(board.background),
      ...(viewer.isAdmin ? {
        shareToken: board.share_token,
        shareCode: board.share_code,
        audience: board.audience,
        requirePassword: Boolean(board.access_password || board.access_password_hash),
        // Managers only — this branch is inside the isAdmin gate. A student's payload has no
        // such field, so the code they must type never travels to them.
        accessPassword: board.access_password,
      } : {}),
      createdAt: board.created_at,
      updatedAt: board.updated_at,
    },
    columns,
    cards,
    activity: viewer.isAdmin ? activity : [],
    revisions,
    activeViewers,
    chatMessages,
    isAdmin: viewer.isAdmin,
    canWrite: viewer.isAdmin || board.share_mode === "write",
    realtime: supportsRealtimePush(),
    participant: viewer.participantId ? {
      id: viewer.participantId,
      nickname: viewer.nickname ?? "참여자",
      emoji: viewer.emoji ?? "🙂",
    } : null,
  };
}
