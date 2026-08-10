import { boardManager } from "@/lib/access";
import { getBoardById } from "@/lib/board-data";
import { apiError } from "@/lib/http";
import { supportsRealtimePush } from "@/lib/runtime";
import { boardEventStream } from "@/lib/sse";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  // In-process pub/sub cannot reach other instances, so on serverless the client polls instead.
  if (!supportsRealtimePush()) return new Response(null, { status: 501 });
  const { slug } = await context.params;
  const board = (await getBoardById(slug));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  if (!(await boardManager(board))) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  return boardEventStream(board.id, request.signal);
}
