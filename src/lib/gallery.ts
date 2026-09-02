import { canViewBoardContent } from "@/lib/access";
import { getBoardById } from "@/lib/board-data";
import { get } from "@/lib/db";
import { logError } from "@/lib/log";
import { readUpload } from "@/lib/storage";

// Uploaded student HTML runs with an opaque origin (no allow-same-origin), so it can never read
// our cookies or DOM. Popups are allowed but stay sandboxed — letting them escape would give an
// upload a fully-privileged window under our domain.
const SANDBOX_CSP = "sandbox allow-scripts allow-popups allow-modals allow-forms;";

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

type GalleryCard = { id: string; board_id: string; file_id: string | null };

// Shared by /api/embed/[id] (iframe preview) and /g/[code] (short share link).
export async function serveGalleryWork(card: GalleryCard | undefined) {
  if (!card || !card.file_id) return textResponse("작품을 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id));
  if (!board) return textResponse("보드를 찾을 수 없습니다.", 404);
  if (!(await canViewBoardContent(board))) return textResponse("이 작품에 접근할 권한이 없습니다.", 403);
  const file = (await get<{ stored_name: string }>("SELECT stored_name FROM files WHERE id = ?", card.file_id));
  if (!file) return textResponse("파일을 찾을 수 없습니다.", 404);
  try {
    const data = await readUpload(file.stored_name);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": SANDBOX_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    logError("gallery.read", error, { cardId: card.id, storedName: file.stored_name });
    return textResponse("작품을 불러올 수 없습니다.", 502);
  }
}
