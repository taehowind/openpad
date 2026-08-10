import { canManageBoard } from "@/lib/access";
import { getInstructorSession, getParticipantSession } from "@/lib/auth";
import { getBoardById } from "@/lib/board-data";
import { get } from "@/lib/db";
import { apiError } from "@/lib/http";
import { isInlineViewable, readUpload, safeMimeType } from "@/lib/storage";

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
  try {
    const data = await readUpload(file.stored_name);
    // The uploader controls mime_type, so it is validated first and anything off the inline
    // allowlist is forced to download — an uploaded .html or .svg must never render here.
    const mimeType = safeMimeType(file.mime_type);
    const inline = isInlineViewable(mimeType);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(data.byteLength),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
        "Content-Security-Policy": "sandbox;",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return apiError("파일을 불러올 수 없습니다.", 404);
  }
}
