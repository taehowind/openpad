import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { boardManager, isBoardClosed } from "@/lib/access";
import { getBoardById, now, recordAction } from "@/lib/board-data";
import { all, get, run, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ slug: string }> };
const createSchema = z.object({ name: z.string().trim().min(1).max(60), gridCol: z.number().int().min(0).max(50).optional() });
const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60).optional(),
  color: z.enum(["gray", "blue", "cyan", "green", "lime", "yellow", "orange", "red", "pink", "purple"]).optional(),
  gridCol: z.number().int().min(0).max(50).optional(),
  targetId: z.string().min(1).optional(),
  placement: z.enum(["before", "after"]).optional(),
}).refine((value) => value.name !== undefined || value.color !== undefined || value.gridCol !== undefined || value.targetId !== undefined);
const deleteSchema = z.object({ id: z.string().min(1) });

type ColumnRow = { id: string; name: string; color: string; position: number; grid_col: number };

export async function POST(request: Request, context: Context) {
  const { slug: boardId } = await context.params;
  const board = (await getBoardById(boardId));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const manager = await boardManager(board);
  if (!manager) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  if (isBoardClosed(board)) return apiError("마감된 보드입니다. ‘게시’를 눌러 다시 열어 주세요.", 409, "BOARD_CLOSED");
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("목록 이름을 입력해 주세요.");
  const id = randomUUID();
  const gridCol = parsed.data.gridCol ?? 0;
  const position = ((await get<{ value: number }>("SELECT COALESCE(MAX(position), -1) + 1 AS value FROM board_columns WHERE board_id = ? AND grid_col = ?", boardId, gridCol))?.value ?? 0);
  (await transaction(async () => {
    await run("INSERT INTO board_columns (id, board_id, name, color, position, grid_col) VALUES (?, ?, ?, ?, ?, ?)", id, boardId, parsed.data.name, "gray", position, gridCol);
    await run("UPDATE boards SET updated_at = ? WHERE id = ?", now(), boardId);
    await recordAction(boardId, { type: "teacher", name: manager.name }, "목록을 추가했습니다", "column", id, { name: parsed.data.name });
  }));
  return NextResponse.json({ id }, { status: 201 });
}

export async function PATCH(request: Request, context: Context) {
  const { slug: boardId } = await context.params;
  const board = (await getBoardById(boardId));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const manager = await boardManager(board);
  if (!manager) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  if (isBoardClosed(board)) return apiError("마감된 보드입니다. ‘게시’를 눌러 다시 열어 주세요.", 409, "BOARD_CLOSED");
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("변경할 목록 정보를 확인해 주세요.");

  const column = (await get<ColumnRow>("SELECT id, name, color, position, grid_col FROM board_columns WHERE id = ? AND board_id = ?", parsed.data.id, boardId));
  if (!column) return apiError("목록을 찾을 수 없습니다.", 404);
  const target = parsed.data.targetId
    ? (await get<ColumnRow>("SELECT id, name, color, position, grid_col FROM board_columns WHERE id = ? AND board_id = ?", parsed.data.targetId, boardId))
    : null;
  if (parsed.data.targetId && !target) return apiError("이동할 위치의 목록을 찾을 수 없습니다.", 404);

  const isMove = parsed.data.gridCol !== undefined || parsed.data.targetId !== undefined;

  (await transaction(async () => {
    if (isMove) {
      const destCol = target ? target.grid_col : (parsed.data.gridCol ?? column.grid_col);
      // Lists already in the destination column, in order, excluding the one being moved.
      const ordered = (await all<{ id: string }>(
        "SELECT id FROM board_columns WHERE board_id = ? AND grid_col = ? AND id != ? ORDER BY position ASC, id ASC",
        boardId, destCol, column.id,
      ));
      let insertAt = ordered.length;
      if (target) {
        const targetIndex = ordered.findIndex((item) => item.id === target.id);
        if (targetIndex >= 0) insertAt = targetIndex + (parsed.data.placement === "after" ? 1 : 0);
      }
      ordered.splice(insertAt, 0, { id: column.id });
      for (const [position, item] of ordered.entries()) {
        await run("UPDATE board_columns SET position = ?, grid_col = ? WHERE id = ?", position, destCol, item.id);
      }
    }
    if (parsed.data.name !== undefined) (await run("UPDATE board_columns SET name = ? WHERE id = ?", parsed.data.name, column.id));
    if (parsed.data.color !== undefined) (await run("UPDATE board_columns SET color = ? WHERE id = ?", parsed.data.color, column.id));
    await run("UPDATE boards SET updated_at = ? WHERE id = ?", now(), boardId);

    const action = isMove ? "목록 위치를 변경했습니다" : parsed.data.name !== undefined ? "목록 이름을 변경했습니다" : "목록 색상을 변경했습니다";
    (await recordAction(boardId, { type: "teacher", name: manager.name }, action, "column", column.id, {
      previousName: column.name,
      name: parsed.data.name ?? column.name,
      color: parsed.data.color ?? column.color,
    }));
  }));

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: Context) {
  const { slug: boardId } = await context.params;
  const board = (await getBoardById(boardId));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const manager = await boardManager(board);
  if (!manager) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  if (isBoardClosed(board)) return apiError("마감된 보드입니다. ‘게시’를 눌러 다시 열어 주세요.", 409, "BOARD_CLOSED");
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("삭제할 목록을 확인해 주세요.");

  const column = (await get<ColumnRow>("SELECT id, name, color, position, grid_col FROM board_columns WHERE id = ? AND board_id = ?", parsed.data.id, boardId));
  if (!column) return apiError("목록을 찾을 수 없습니다.", 404);
  const columnCount = (await get<{ value: number }>("SELECT COUNT(*) AS value FROM board_columns WHERE board_id = ?", boardId))?.value ?? 0;
  if (columnCount <= 1) return apiError("보드에는 최소 한 개의 목록이 필요합니다.", 409);
  const cardCount = (await get<{ value: number }>("SELECT COUNT(*) AS value FROM cards WHERE column_id = ?", column.id))?.value ?? 0;
  if (cardCount > 0) return apiError("목록의 카드를 다른 목록으로 옮긴 후 삭제해 주세요.", 409);

  (await transaction(async () => {
    await run("DELETE FROM board_columns WHERE id = ?", column.id);
    await run("UPDATE boards SET updated_at = ? WHERE id = ?", now(), boardId);
    await recordAction(boardId, { type: "teacher", name: manager.name }, "목록을 삭제했습니다", "column", column.id, { name: column.name });
  }));

  return NextResponse.json({ ok: true });
}
