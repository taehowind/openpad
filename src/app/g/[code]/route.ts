import { getCardByShareCode } from "@/lib/board-data";
import { serveGalleryWork } from "@/lib/gallery";

type Context = { params: Promise<{ code: string }> };

// Short shareable link for a gallery work — same sandboxed delivery as the iframe preview.
export async function GET(_: Request, context: Context) {
  const { code } = await context.params;
  return serveGalleryWork((await getCardByShareCode(code)));
}
