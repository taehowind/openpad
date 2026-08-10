import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { actorForBoard } from "@/lib/access";
import { getBoardById, nextCardPosition, now, recordAction, uniqueCardShareCode } from "@/lib/board-data";
import { get, run, transaction } from "@/lib/db";
import { apiError, rateLimited, safeHttpUrl } from "@/lib/http";
import { isObjectStorage, removeUpload, safeMimeType, storedNameFor, uploadExists, uploadSize, writeUpload } from "@/lib/storage";

type Context = { params: Promise<{ slug: string }> };
const GUEST_LIMIT = 10 * 1024 * 1024;
const GALLERY_LIMIT = 5 * 1024 * 1024;
// Teachers are trusted but not unbounded — an accidental huge upload must not fill the volume.
const TEACHER_LIMIT = 100 * 1024 * 1024;

export async function POST(request: Request, context: Context) {
  const { slug: boardId } = await context.params;
  const board = (await getBoardById(boardId));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const access = await actorForBoard(board, true);
  if (!access) return apiError(board.share_mode === "readonly" ? "읽기 전용 보드입니다." : "쓰기 권한이 없습니다.", 403);
  const actorKey = access.isAdmin ? "teacher" : access.participant!.participantId;
  if (rateLimited(`card:${actorKey}`, 12, 60_000)) return apiError("카드를 너무 빠르게 만들고 있습니다.", 429);

  const form = await request.formData();
  const columnId = String(form.get("columnId") ?? "");
  const title = String(form.get("title") ?? "").trim().slice(0, 120);
  const content = String(form.get("content") ?? "").trim().slice(0, 5000);
  const rawLink = String(form.get("linkUrl") ?? "").trim();
  const linkUrl = rawLink ? safeHttpUrl(rawLink) : null;
  if (rawLink && !linkUrl) return apiError("링크는 http 또는 https 주소만 사용할 수 있습니다.");
  if (!(await get("SELECT id FROM board_columns WHERE id = ? AND board_id = ?", columnId, boardId))) return apiError("목록을 다시 선택해 주세요.");
  const uploaded = form.get("file");
  const file = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;

  // Where the browser uploaded straight to object storage (see the /uploads route), it sends the
  // resulting object's name instead of the bytes. Verify the object really exists before wiring
  // it to a card, so a client cannot claim a file it never sent — or point at someone else's.
  const preUploadedName = String(form.get("storedName") ?? "").trim();
  const preUploaded = preUploadedName && isObjectStorage()
    ? { storedName: path.basename(preUploadedName), originalName: String(form.get("fileName") ?? "file").slice(0, 255) }
    : null;
  if (preUploaded && !(await uploadExists(preUploaded.storedName))) {
    return apiError("업로드된 파일을 찾을 수 없습니다. 다시 시도해 주세요.", 409);
  }
  const hasAttachment = Boolean(file || preUploaded);
  // For a direct upload the bytes never passed through here, so measure the stored object.
  const attachmentSize = file ? file.size : preUploaded ? await uploadSize(preUploaded.storedName) : 0;
  if (board.type === "gallery") {
    if (!hasAttachment) return apiError("HTML 파일 또는 코드를 올려 주세요.");
    if (attachmentSize > GALLERY_LIMIT) return apiError("갤러리 작품은 최대 5MB까지 올릴 수 있습니다.", 413);
  } else {
    if (!title && !content && !linkUrl && !hasAttachment) return apiError("텍스트, 링크 또는 파일을 하나 이상 입력해 주세요.");
    if (hasAttachment && !access.isAdmin && attachmentSize > GUEST_LIMIT) return apiError("수강생은 파일당 최대 10MB까지 업로드할 수 있습니다.", 413);
    if (hasAttachment && access.isAdmin && attachmentSize > TEACHER_LIMIT) return apiError("파일은 최대 100MB까지 업로드할 수 있습니다.", 413);
  }

  const cardId = randomUUID();
  let fileId: string | null = null;
  let storedName: string | null = null;
  if (file) {
    fileId = randomUUID();
    storedName = storedNameFor(fileId, file.name);
    await writeUpload(storedName, Buffer.from(await file.arrayBuffer()), safeMimeType(file.type));
  } else if (preUploaded) {
    fileId = randomUUID();
    storedName = preUploaded.storedName;
  }
  const timestamp = now();
  try {
    (await transaction(async () => {
      if (fileId && storedName) {
        const originalName = file ? path.basename(file.name).slice(0, 255) : preUploaded!.originalName;
        const mimeType = safeMimeType(file ? file.type : String(form.get("fileType") ?? ""));
        (await run(`INSERT INTO files (id, board_id, original_name, stored_name, mime_type, size_bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, fileId, boardId, originalName, storedName,
          mimeType, attachmentSize, timestamp));
      }
      (await run(`INSERT INTO cards
        (id, board_id, column_id, participant_id, actor_type, author_name, title, content, link_url, file_id, share_code, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        cardId, boardId, columnId, access.participant?.participantId ?? null, access.actor.type, access.actor.name,
        title, content, linkUrl, fileId, (await uniqueCardShareCode()), await nextCardPosition(columnId), timestamp, timestamp));
      await run("UPDATE boards SET updated_at = ? WHERE id = ?", timestamp, boardId);
      await recordAction(boardId, access.actor, "카드를 추가했습니다", "card", cardId, { title: title || "제목 없음", fileName: file?.name ?? preUploaded?.originalName });
    }));
  } catch (error) {
    if (storedName) await removeUpload(storedName);
    throw error;
  }
  return NextResponse.json({ id: cardId }, { status: 201 });
}
