import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { actorForBoard } from "@/lib/access";
import { getBoardById, now, recordAction } from "@/lib/board-data";
import { get, run, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { removeUpload, safeMimeType, storedNameFor, writeUpload } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };
const GALLERY_LIMIT = 5 * 1024 * 1024;

type CardRow = { id: string; board_id: string; participant_id: string | null; title: string; file_id: string | null };

// Edit a gallery work: title/description and, optionally, replace the HTML.
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const card = (await get<CardRow>("SELECT id, board_id, participant_id, title, file_id FROM cards WHERE id = ?", id));
  if (!card) return apiError("작품을 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const access = await actorForBoard(board, true);
  if (!access) return apiError("쓰기 권한이 없습니다.", 403);
  if (!access.isAdmin && card.participant_id !== access.participant?.participantId) return apiError("본인 작품만 수정할 수 있습니다.", 403);

  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim().slice(0, 120);
  const content = String(form.get("content") ?? "").trim().slice(0, 5000);
  if (!title) return apiError("작품 제목을 입력해 주세요.");
  const uploaded = form.get("file");
  const file = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
  if (file && file.size > GALLERY_LIMIT) return apiError("작품은 최대 5MB까지 올릴 수 있습니다.", 413);

  const timestamp = now();
  let newFileId: string | null = null;
  let newStoredName: string | null = null;
  let oldStoredName: string | null = null;
  const oldFileId = card.file_id;
  if (file) {
    const oldFile = oldFileId ? (await get<{ stored_name: string }>("SELECT stored_name FROM files WHERE id = ?", oldFileId)) : null;
    oldStoredName = oldFile?.stored_name ?? null;
    newFileId = randomUUID();
    newStoredName = storedNameFor(newFileId, file.name, ".html");
    await writeUpload(newStoredName, Buffer.from(await file.arrayBuffer()), safeMimeType(file.type));
  }

  try {
    (await transaction(async () => {
      await run("UPDATE cards SET title = ?, content = ?, updated_at = ? WHERE id = ?", title, content, timestamp, id);
      if (file && newFileId && newStoredName) {
        (await run(`INSERT INTO files (id, board_id, original_name, stored_name, mime_type, size_bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, newFileId, board.id, path.basename(file.name).slice(0, 255), newStoredName,
          safeMimeType(file.type), file.size, timestamp));
        await run("UPDATE cards SET file_id = ? WHERE id = ?", newFileId, id);
      }
      await run("UPDATE boards SET updated_at = ? WHERE id = ?", timestamp, board.id);
      await recordAction(board.id, access.actor, "작품을 수정했습니다", "card", id, { title });
    }));
  } catch (error) {
    if (newStoredName) await removeUpload(newStoredName);
    throw error;
  }

  // The card now points at the new file — clean up the old one.
  if (file && oldFileId && oldStoredName) {
    await run("DELETE FROM files WHERE id = ?", oldFileId);
    await removeUpload(oldStoredName);
  }
  return NextResponse.json({ ok: true });
}
