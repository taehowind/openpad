import { getBoardByShareId } from "@/lib/board-data";
import { apiError } from "@/lib/http";
import { supportsRealtimePush } from "@/lib/runtime";
import { boardEventStream } from "@/lib/sse";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

// The stream only carries contentless "update" pings, so it just needs a valid board.
export async function GET(request: Request, context: Context) {
  // In-process pub/sub cannot reach other instances, so on serverless the client polls instead.
  if (!supportsRealtimePush()) return new Response(null, { status: 501 });
  const { token } = await context.params;
  const board = (await getBoardByShareId(token));
  if (!board) return apiError("공유 링크가 올바르지 않거나 만료되었습니다.", 404);
  return boardEventStream(board.id, request.signal);
}
