import { get } from "@/lib/db";
import { serveGalleryWork } from "@/lib/gallery";

type Context = { params: Promise<{ id: string }> };

// Serves a gallery work's HTML inside a sandboxed opaque origin — see serveGalleryWork().
export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  return serveGalleryWork((await get<{ id: string; board_id: string; file_id: string | null }>(
    "SELECT id, board_id, file_id FROM cards WHERE id = ?", id,
  )));
}
