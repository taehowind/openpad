import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageBoard } from "@/lib/access";
import { getInstructorSession } from "@/lib/auth";
import { getBoardById } from "@/lib/board-data";
import { get } from "@/lib/db";
import { apiError } from "@/lib/http";
import { transferColumn } from "@/lib/transfer";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  targetBoardId: z.string().uuid(),
  mode: z.enum(["move", "copy"]),
});

type ColumnRow = { id: string; board_id: string; name: string; color: string };

// Moves or copies a whole list, with its cards, comments and attachments, onto another board.
// Requires management rights on BOTH boards, so content can never be pushed into a board the
// caller does not control.
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const column = (await get<ColumnRow>("SELECT id, board_id, name, color FROM board_columns WHERE id = ?", id));
  if (!column) return apiError("목록을 찾을 수 없습니다.", 404);

  const session = await getInstructorSession();
  const source = (await getBoardById(column.board_id));
  if (!source) return apiError("보드를 찾을 수 없습니다.", 404);
  if (!(await canManageBoard(source, session))) return apiError("이 보드를 관리할 권한이 없습니다.", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("이동할 보드를 다시 선택해 주세요.");
  if (parsed.data.targetBoardId === source.id) return apiError("같은 보드로는 옮길 수 없습니다.");

  const target = (await getBoardById(parsed.data.targetBoardId));
  if (!target) return apiError("대상 보드를 찾을 수 없습니다.", 404);
  if (!(await canManageBoard(target, session))) return apiError("대상 보드를 관리할 권한이 없습니다.", 403);
  if (target.type !== source.type) return apiError("같은 종류의 보드끼리만 옮길 수 있습니다.");

  if (parsed.data.mode === "move") {
    const columnCount = (await get<{ v: number }>("SELECT COUNT(*) AS v FROM board_columns WHERE board_id = ?", source.id))?.v ?? 0;
    if (columnCount <= 1) return apiError("보드에는 최소 한 개의 목록이 필요합니다.", 409);
  }

  const actor = { type: "teacher" as const, name: session!.name, emoji: "🧑‍🏫", deviceId: "teacher", instructorId: session!.id };
  const result = await transferColumn(column, target.id, parsed.data.mode, actor);
  return NextResponse.json({ ok: true, ...result, targetBoardId: target.id });
}
