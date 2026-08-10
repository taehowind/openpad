import { NextResponse } from "next/server";
import { z } from "zod";
import { boardManager } from "@/lib/access";
import { getBoardById, recordAction } from "@/lib/board-data";
import { get, run } from "@/lib/db";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };
const patchSchema = z.object({ hidden: z.boolean() });

async function loadMessage(id: string) {
  return (await get<{ id: string; board_id: string }>("SELECT id, board_id FROM chat_messages WHERE id = ?", id));
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const message = await loadMessage(id);
  if (!message) return apiError("메시지를 찾을 수 없습니다.", 404);
  const board = (await getBoardById(message.board_id))!;
  const manager = await boardManager(board);
  if (!manager) return apiError("메시지를 관리할 권한이 없습니다.", 403);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("요청을 확인해 주세요.");
  await run("UPDATE chat_messages SET hidden = ? WHERE id = ?", parsed.data.hidden ? 1 : 0, id);
  (await recordAction(board.id, { type: "teacher", name: manager.name },
    parsed.data.hidden ? "채팅 메시지를 가렸습니다" : "채팅 메시지를 다시 표시했습니다", "chat", id, {}, false));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  const message = await loadMessage(id);
  if (!message) return apiError("메시지를 찾을 수 없습니다.", 404);
  const board = (await getBoardById(message.board_id))!;
  const manager = await boardManager(board);
  if (!manager) return apiError("메시지를 관리할 권한이 없습니다.", 403);
  await run("DELETE FROM chat_messages WHERE id = ?", id);
  await recordAction(board.id, { type: "teacher", name: manager.name }, "채팅 메시지를 삭제했습니다", "chat", id, {}, false);
  return NextResponse.json({ ok: true });
}
