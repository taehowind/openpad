import { canManageBoard } from "@/lib/access";
import { getInstructorSession, getParticipantSession } from "@/lib/auth";
import { getBoardById } from "@/lib/board-data";
import { get } from "@/lib/db";
import { apiError } from "@/lib/http";
import { logError } from "@/lib/log";
import { isInlineViewable, openUpload, safeMimeType } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const file = (await get<{ board_id: string; original_name: string; stored_name: string; mime_type: string }>(
    "SELECT board_id, original_name, stored_name, mime_type FROM files WHERE id = ?", id,
  ));
  if (!file) return apiError("파일을 찾을 수 없습니다.", 404);
  const board = (await getBoardById(file.board_id));
  const [session, participant] = await Promise.all([getInstructorSession(), getParticipantSession()]);
  // A participant cookie only counts while that participant still exists on the board.
  const stillEnrolled = participant?.boardId === file.board_id
    && Boolean((await get("SELECT 1 FROM participants WHERE id = ? AND board_id = ?", participant.participantId, file.board_id)));
  const allowed = (board && (await canManageBoard(board, session))) || stillEnrolled;
  if (!allowed) return apiError("파일 접근 권한이 없습니다.", 403);
  // Streamed rather than read into memory first: a teacher may attach up to 100MB, and buffering
  // that holds the whole file in the function for as long as the download takes, once per reader.
  let upload;
  try {
    upload = await openUpload(file.stored_name);
  } catch (error) {
    logError("files.read", error, { fileId: id, storedName: file.stored_name });
    return apiError("파일을 불러올 수 없습니다.", 502);
  }
  // The row says there is a file but the store disagrees — a genuine 404 for the reader.
  if (!upload) return apiError("파일을 찾을 수 없습니다.", 404);

  // The uploader controls mime_type, so it is validated first and anything off the inline
  // allowlist is forced to download — an uploaded .html or .svg must never render here.
  const mimeType = safeMimeType(file.mime_type);
  const inline = isInlineViewable(mimeType);
  return new Response(upload.body, {
    headers: {
      "Content-Type": mimeType,
      // Only when the store told us; a wrong length is worse than none.
      ...(upload.size !== null ? { "Content-Length": String(upload.size) } : {}),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      "Content-Security-Policy": "sandbox;",
      // A file id never points at different bytes: uploads are written fail-if-exists, and
      // replacing an attachment mints a new id. So the browser can keep it and stop asking —
      // which is what makes a gallery snapshot cost one request instead of one per visit.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
