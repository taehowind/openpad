import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorForBoard } from "@/lib/access";
import { getBoardById, now, recordAction } from "@/lib/board-data";
import { all, get, run, transaction } from "@/lib/db";
import { apiError, rateLimited } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ content: z.string().trim().min(1).max(500) });

/**
 * The comments on one card.
 *
 * These used to ride along in the board payload, which meant every viewer received every comment
 * on the board every time their client polled. They are fetched here instead, when a reader opens
 * a card — the payload still carries the per-card count so the badge needs no request.
 *
 * Read access is the same question as "may you see this board", so it goes through actorForBoard
 * without requiring write.
 */
export async function GET(_: Request, context: Context) {
  const { id: cardId } = await context.params;
  const card = (await get<{ board_id: string }>("SELECT board_id FROM cards WHERE id = ?", cardId));
  if (!card) return apiError("카드를 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  if (!(await actorForBoard(board))) return apiError("이 카드를 볼 권한이 없습니다.", 403);

  const rows = (await all<{ id: string; author_name: string; author_emoji: string; content: string; created_at: string }>(
    `SELECT c.id, COALESCE(p.nickname, c.author_name) AS author_name,
            CASE WHEN c.actor_type = 'teacher' THEN '🧑‍🏫' ELSE COALESCE(p.emoji, '🙂') END AS author_emoji,
            c.content, c.created_at
       FROM comments c LEFT JOIN participants p ON p.id = c.participant_id
      WHERE c.card_id = ? ORDER BY c.created_at`, cardId));

  return NextResponse.json({
    comments: rows.map((row) => ({
      id: row.id,
      authorName: row.author_name,
      authorEmoji: row.author_emoji,
      content: row.content,
      createdAt: row.created_at,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: Context) {
  const { id: cardId } = await context.params;
  const card = (await get<{ board_id: string; title: string }>("SELECT board_id, title FROM cards WHERE id = ?", cardId));
  if (!card) return apiError("카드를 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id))!;
  const access = await actorForBoard(board, true);
  if (!access) return apiError("쓰기 권한이 없습니다.", 403);
  if (rateLimited(`comment:${access.isAdmin ? "teacher" : access.participant!.participantId}`, 20, 60_000)) return apiError("댓글을 너무 빠르게 작성하고 있습니다.", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("댓글은 1자 이상 500자 이하로 작성해 주세요.");
  const id = randomUUID();
  (await transaction(async () => {
    (await run(`INSERT INTO comments (id, card_id, participant_id, actor_type, author_name, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, id, cardId, access.participant?.participantId ?? null,
      access.actor.type, access.actor.name, parsed.data.content, now()));
    await recordAction(board.id, access.actor, "댓글을 남겼습니다", "comment", id, { cardTitle: card.title || "제목 없음" });
  }));
  return NextResponse.json({ id }, { status: 201 });
}
