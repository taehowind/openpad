import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { boardManager, isBoardClosed } from "@/lib/access";
import { createRevision, getBoardById, now, recordAction, restoreRevision } from "@/lib/board-data";
import { run, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ slug: string }> };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveFinal"), label: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("restore"), revisionId: z.string().uuid() }),
]);

export async function POST(request: Request, context: Context) {
  const { slug: boardId } = await context.params;
  const board = (await getBoardById(boardId));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const manager = await boardManager(board);
  if (!manager) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("버전 작업을 다시 선택해 주세요.");
  if (parsed.data.action === "saveFinal") {
    const revisionId = randomUUID();
    const label = parsed.data.label || "강사 최종본";
    (await transaction(async () => {
      const stateId = (await createRevision(boardId, label, "final"));
      (await run(`INSERT INTO audit_logs (id, board_id, actor_type, actor_name, action, entity_type, entity_id, details_json, created_at)
        VALUES (?, ?, 'teacher', ?, ?, 'revision', ?, '{}', ?)`,
        revisionId, boardId, manager.name, "최종본을 저장했습니다", stateId, now()));
    }));
    return NextResponse.json({ ok: true });
  }
  // Snapshotting a finished class is fine; replaying a snapshot over it is a write.
  if (isBoardClosed(board)) return apiError("마감된 보드입니다. ‘게시’를 눌러 다시 열어 주세요.", 409, "BOARD_CLOSED");
  const revisionId = parsed.data.revisionId;
  (await transaction(async () => {
    if (!(await restoreRevision(boardId, revisionId))) throw new Error("REVISION_NOT_FOUND");
    await recordAction(boardId, { type: "teacher", name: manager.name }, "저장된 버전으로 복원했습니다", "revision", revisionId);
  }));
  return NextResponse.json({ ok: true });
}
