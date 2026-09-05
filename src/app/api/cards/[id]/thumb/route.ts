import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { actorForBoard } from "@/lib/access";
import { getBoardById, now } from "@/lib/board-data";
import { get, run, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { removeUpload, storedNameFor, writeUpload } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };

/** A 900px-wide JPEG of a page; anything near this is not one. */
const THUMB_LIMIT = 2 * 1024 * 1024;

type CardRow = { id: string; board_id: string; participant_id: string | null; thumb_file_id: string | null };

/**
 * Stores the snapshot of a gallery work.
 *
 * The image arrives from the author's browser, which produced it inside a sandboxed frame running
 * the work's own code — so it is untrusted input twice over. It is accepted only from someone who
 * could edit the work anyway, only if it really is a JPEG, and it is served back through
 * /api/files, which pins the content type and refuses to let anything but a picture render inline.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const card = (await get<CardRow>("SELECT id, board_id, participant_id, thumb_file_id FROM cards WHERE id = ?", id));
  if (!card) return apiError("작품을 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const access = await actorForBoard(board, true);
  if (!access) return apiError("쓰기 권한이 없습니다.", 403);
  if (!access.isAdmin && card.participant_id !== access.participant?.participantId) {
    return apiError("본인 작품만 수정할 수 있습니다.", 403);
  }

  const form = await request.formData().catch(() => null);
  const uploaded = form?.get("thumb");
  if (!(uploaded instanceof File) || uploaded.size === 0) return apiError("미리보기 이미지가 없습니다.");
  if (uploaded.size > THUMB_LIMIT) return apiError("미리보기 이미지가 너무 큽니다.", 413);
  const bytes = Buffer.from(await uploaded.arrayBuffer());
  // JPEG magic number. Trusting the declared type would let the frame hand us anything at all.
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return apiError("미리보기 이미지 형식이 올바르지 않습니다.");
  }

  const fileId = randomUUID();
  const storedName = storedNameFor(fileId, "thumb.jpg", ".jpg");
  await writeUpload(storedName, bytes, "image/jpeg");

  const previousId = card.thumb_file_id;
  const previous = previousId
    ? (await get<{ stored_name: string }>("SELECT stored_name FROM files WHERE id = ?", previousId))
    : null;
  try {
    (await transaction(async () => {
      (await run(`INSERT INTO files (id, board_id, original_name, stored_name, mime_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, fileId, board.id, "thumb.jpg", storedName, "image/jpeg", bytes.length, now()));
      await run("UPDATE cards SET thumb_file_id = ? WHERE id = ?", fileId, id);
    }));
  } catch (error) {
    await removeUpload(storedName);
    throw error;
  }

  // Replacing a snapshot leaves the old one unreferenced. It is not part of the board's content,
  // so it goes rather than lingering in storage.
  if (previousId && previous) {
    await run("DELETE FROM files WHERE id = ?", previousId);
    await removeUpload(previous.stored_name);
  }
  return NextResponse.json({ ok: true, thumbFileId: fileId });
}
