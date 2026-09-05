import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorForBoard, isBoardClosed } from "@/lib/access";
import { getBoardById, now, recordAction } from "@/lib/board-data";
import { run, transaction } from "@/lib/db";
import { apiError, rateLimited } from "@/lib/http";

type Context = { params: Promise<{ slug: string }> };
const schema = z.object({ content: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, context: Context) {
  const { slug: boardId } = await context.params;
  const board = (await getBoardById(boardId));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  // Q&A stays open on a read-only board on purpose — actorForBoard is called without requireWrite.
  // A closed board is different: the class is over, so nothing more is added to it.
  if (isBoardClosed(board)) return apiError("마감된 보드입니다. 더 이상 질문을 남길 수 없습니다.", 409, "BOARD_CLOSED");
  const access = await actorForBoard(board);
  if (!access) return apiError("채팅 권한이 없습니다.", 403);
  const actorKey = access.isAdmin ? "teacher" : access.participant!.participantId;
  if (rateLimited(`chat:${actorKey}`, 20, 60_000)) return apiError("메시지를 너무 빠르게 보내고 있습니다.", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("메시지는 1자 이상 1,000자 이하로 작성해 주세요.");
  const id = randomUUID();
  (await transaction(async () => {
    (await run(`INSERT INTO chat_messages
      (id, board_id, participant_id, actor_type, author_name, author_emoji, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, boardId, access.participant?.participantId ?? null,
      access.actor.type, access.actor.name, access.actor.emoji ?? "🙂", parsed.data.content, now()));
    await recordAction(boardId, access.actor, "채팅 질문을 남겼습니다", "chat", id, {}, false);
  }));
  return NextResponse.json({ id }, { status: 201 });
}
