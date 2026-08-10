import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorForBoard } from "@/lib/access";
import { getBoardById } from "@/lib/board-data";
import { apiError, rateLimited } from "@/lib/http";
import { createUploadTicket, isObjectStorage, storedNameFor } from "@/lib/storage";

type Context = { params: Promise<{ slug: string }> };
const schema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
});

const GUEST_LIMIT = 10 * 1024 * 1024;
const GALLERY_LIMIT = 5 * 1024 * 1024;
const TEACHER_LIMIT = 100 * 1024 * 1024;

/**
 * Hands the browser a short-lived URL to upload straight to object storage.
 *
 * Serverless functions cap request bodies at 4.5MB, which is below both the 10MB attachment and
 * 5MB gallery limits, so anything larger can never travel through the API. The browser PUTs to
 * this URL and then posts only the resulting stored name to the cards route.
 *
 * Only available when object storage is configured; self-hosted deployments keep uploading
 * through the API, where there is no such cap.
 */
export async function POST(request: Request, context: Context) {
  if (!isObjectStorage()) return apiError("이 서버는 직접 업로드를 사용하지 않습니다.", 501, "DIRECT_UPLOAD_UNAVAILABLE");

  const { slug: boardId } = await context.params;
  const board = await getBoardById(boardId);
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const access = await actorForBoard(board, true);
  if (!access) return apiError("쓰기 권한이 없습니다.", 403);

  const actorKey = access.isAdmin ? "teacher" : access.participant!.participantId;
  if (rateLimited(`upload-ticket:${actorKey}`, 20, 60_000)) return apiError("업로드를 너무 빠르게 요청하고 있습니다.", 429);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("업로드 정보를 확인해 주세요.");

  // The same ceilings the API path enforces, applied before a ticket is ever issued.
  const limit = board.type === "gallery" ? GALLERY_LIMIT : access.isAdmin ? TEACHER_LIMIT : GUEST_LIMIT;
  if (parsed.data.size > limit) {
    return apiError(`파일은 최대 ${Math.floor(limit / 1024 / 1024)}MB까지 올릴 수 있습니다.`, 413);
  }

  const fileId = randomUUID();
  const storedName = storedNameFor(fileId, parsed.data.fileName, board.type === "gallery" ? ".html" : "");
  const ticket = await createUploadTicket(storedName);
  if (!ticket) return apiError("업로드 URL을 만들지 못했습니다.", 500);

  return NextResponse.json({ fileId, storedName: ticket.storedName, uploadUrl: ticket.uploadUrl });
}
