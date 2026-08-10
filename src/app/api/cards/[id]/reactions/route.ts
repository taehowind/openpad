import { NextResponse } from "next/server";
import { actorForBoard } from "@/lib/access";
import { getBoardById, now } from "@/lib/board-data";
import { get, run } from "@/lib/db";
import { notifyBoard } from "@/lib/events";
import { apiError, rateLimited } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  const card = (await get<{ id: string; board_id: string }>("SELECT id, board_id FROM cards WHERE id = ?", id));
  if (!card) return apiError("카드를 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id))!;
  // Reactions are allowed for anyone who can view the board, including read-only students.
  const access = await actorForBoard(board, false);
  if (!access) return apiError("보드에 참여한 뒤 이용해 주세요.", 403);
  const identityKey = access.identityKey;
  if (rateLimited(`like:${identityKey}`, 60, 60_000)) return apiError("너무 빠르게 반응하고 있습니다.", 429);
  const existing = (await get("SELECT 1 FROM card_reactions WHERE card_id = ? AND identity_key = ?", id, identityKey));
  if (existing) {
    await run("DELETE FROM card_reactions WHERE card_id = ? AND identity_key = ?", id, identityKey);
  } else {
    await run("INSERT INTO card_reactions (card_id, identity_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", id, identityKey, now());
  }
  const count = (await get<{ c: number }>("SELECT COUNT(*) AS c FROM card_reactions WHERE card_id = ?", id))?.c ?? 0;
  notifyBoard(board.id);
  return NextResponse.json({ liked: !existing, count });
}
