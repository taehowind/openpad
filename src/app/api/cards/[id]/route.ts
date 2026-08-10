import { NextResponse } from "next/server";
import { z } from "zod";
import { actorForBoard } from "@/lib/access";
import { getBoardById, now, recordAction } from "@/lib/board-data";
import { all, get, run, transaction } from "@/lib/db";
import { apiError, safeHttpUrl } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  columnId: z.string().uuid().optional(),
  title: z.string().trim().max(120).optional(),
  content: z.string().trim().max(5000).optional(),
  linkUrl: z.string().trim().max(1000).nullable().optional(),
  targetCardId: z.string().uuid().optional(),
  placement: z.enum(["before", "after"]).optional(),
});

type CardRow = { id: string; board_id: string; participant_id: string | null; title: string; column_id: string };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const card = (await get<CardRow>("SELECT id, board_id, participant_id, title, column_id FROM cards WHERE id = ?", id));
  if (!card) return apiError("카드를 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id))!;
  const access = await actorForBoard(board, true);
  if (!access) return apiError("쓰기 권한이 없습니다.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("카드 정보를 다시 확인해 주세요.");

  // Anyone with write access may re-arrange the board, but the words on a card belong to whoever
  // wrote them — editing the text is limited to the author and the board's teacher.
  const editsContent = parsed.data.title !== undefined || parsed.data.content !== undefined || parsed.data.linkUrl !== undefined;
  const ownsCard = access.isAdmin || (card.participant_id !== null && card.participant_id === access.participant?.participantId);
  if (editsContent && !ownsCard) return apiError("본인이 만든 카드만 수정할 수 있습니다.", 403);

  const targetCard = parsed.data.targetCardId
    ? (await get<CardRow>("SELECT id, board_id, participant_id, title, column_id FROM cards WHERE id = ? AND board_id = ?", parsed.data.targetCardId, board.id))
    : null;
  if (parsed.data.targetCardId && !targetCard) return apiError("이동할 위치의 카드를 찾을 수 없습니다.", 404);
  const destColumnId = targetCard ? targetCard.column_id : parsed.data.columnId;
  if (destColumnId && !(await get("SELECT id FROM board_columns WHERE id = ? AND board_id = ?", destColumnId, board.id))) {
    return apiError("이동할 목록을 찾을 수 없습니다.");
  }
  const isReorder = Boolean(parsed.data.targetCardId) || (destColumnId !== undefined && destColumnId !== card.column_id) || parsed.data.columnId !== undefined;

  const rawLink = parsed.data.linkUrl;
  const linkUrl = rawLink ? safeHttpUrl(rawLink) : rawLink;
  if (rawLink && !linkUrl) return apiError("링크는 http 또는 https 주소만 사용할 수 있습니다.");
  const timestamp = now();
  (await transaction(async () => {
    // Field edits (title/content/link).
    if (editsContent) {
      (await run(`UPDATE cards SET title = COALESCE(?, title), content = COALESCE(?, content),
        link_url = CASE WHEN ? = 1 THEN ? ELSE link_url END, updated_at = ? WHERE id = ?`,
        parsed.data.title ?? null, parsed.data.content ?? null,
        parsed.data.linkUrl !== undefined ? 1 : 0, linkUrl ?? null, timestamp, id));
    }
    // Move / reorder: place the card into destColumn at the requested spot and renumber that column.
    if (isReorder) {
      const dest = destColumnId ?? card.column_id;
      const ordered = (await all<{ id: string }>(
        "SELECT id FROM cards WHERE column_id = ? AND id != ? ORDER BY position ASC, created_at ASC",
        dest, id,
      ));
      let insertAt = ordered.length;
      if (targetCard) {
        const targetIndex = ordered.findIndex((item) => item.id === targetCard.id);
        if (targetIndex >= 0) insertAt = targetIndex + (parsed.data.placement === "after" ? 1 : 0);
      } else if (dest === card.column_id) {
        // moving to the same column with no target → keep at end
        insertAt = ordered.length;
      }
      ordered.splice(insertAt, 0, { id });
      for (const [position, item] of ordered.entries()) {
        await run("UPDATE cards SET position = ?, column_id = ?, updated_at = ? WHERE id = ?", position, dest, timestamp, item.id);
      }
    }
    await run("UPDATE boards SET updated_at = ? WHERE id = ?", timestamp, board.id);
    (await recordAction(board.id, access.actor,
      isReorder && destColumnId && destColumnId !== card.column_id ? "카드를 이동했습니다" : isReorder ? "카드 순서를 변경했습니다" : "카드를 수정했습니다",
      "card", id, { title: parsed.data.title ?? card.title }));
  }));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  const card = (await get<CardRow>("SELECT id, board_id, participant_id, title, column_id FROM cards WHERE id = ?", id));
  if (!card) return apiError("카드를 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id))!;
  const access = await actorForBoard(board, true);
  if (!access) return apiError("쓰기 권한이 없습니다.", 403);
  if (!access.isAdmin && card.participant_id !== access.participant?.participantId) return apiError("본인이 만든 카드만 삭제할 수 있습니다.", 403);
  (await transaction(async () => {
    await run("DELETE FROM cards WHERE id = ?", id);
    await run("UPDATE boards SET updated_at = ? WHERE id = ?", now(), board.id);
    await recordAction(board.id, access.actor, "카드를 삭제했습니다", "card", id, { title: card.title || "제목 없음" });
  }));
  return NextResponse.json({ ok: true });
}
