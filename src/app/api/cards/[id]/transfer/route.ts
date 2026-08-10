import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageBoard } from "@/lib/access";
import { getInstructorSession } from "@/lib/auth";
import { getBoardById } from "@/lib/board-data";
import { get } from "@/lib/db";
import { apiError } from "@/lib/http";
import { firstColumnOf, transferCard } from "@/lib/transfer";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  targetBoardId: z.string().uuid(),
  mode: z.enum(["move", "copy"]),
});

type CardRow = {
  id: string; board_id: string; column_id: string; participant_id: string | null; actor_type: string;
  author_name: string; title: string; content: string; link_url: string | null; file_id: string | null;
  position: number; created_at: string; updated_at: string;
};

// Moves or copies a single card (a gallery work) onto another board. Same rule as lists:
// management rights on both sides.
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const card = (await get<CardRow>(
    `SELECT id, board_id, column_id, participant_id, actor_type, author_name, title, content, link_url,
            file_id, position, created_at, updated_at FROM cards WHERE id = ?`, id,
  ));
  if (!card) return apiError("작품을 찾을 수 없습니다.", 404);

  const session = await getInstructorSession();
  const source = (await getBoardById(card.board_id));
  if (!source) return apiError("보드를 찾을 수 없습니다.", 404);
  if (!(await canManageBoard(source, session))) return apiError("이 보드를 관리할 권한이 없습니다.", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("이동할 보드를 다시 선택해 주세요.");
  if (parsed.data.targetBoardId === source.id) return apiError("같은 보드로는 옮길 수 없습니다.");

  const target = (await getBoardById(parsed.data.targetBoardId));
  if (!target) return apiError("대상 보드를 찾을 수 없습니다.", 404);
  if (!(await canManageBoard(target, session))) return apiError("대상 보드를 관리할 권한이 없습니다.", 403);
  if (target.type !== source.type) return apiError("같은 종류의 보드끼리만 옮길 수 있습니다.");

  const targetColumn = (await firstColumnOf(target.id));
  if (!targetColumn) return apiError("대상 보드에 목록이 없습니다.", 409);

  const actor = { type: "teacher" as const, name: session!.name, emoji: "🧑‍🏫", deviceId: "teacher", instructorId: session!.id };
  const result = await transferCard(card, target.id, targetColumn.id, parsed.data.mode, actor);
  return NextResponse.json({ ok: true, ...result, targetBoardId: target.id });
}
