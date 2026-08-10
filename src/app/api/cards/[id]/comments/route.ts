import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorForBoard } from "@/lib/access";
import { getBoardById, now, recordAction } from "@/lib/board-data";
import { get, run, transaction } from "@/lib/db";
import { apiError, rateLimited } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ content: z.string().trim().min(1).max(500) });

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
