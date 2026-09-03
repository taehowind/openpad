import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { boardManager } from "@/lib/access";
import { getBoardById, now, recordAction, touchPresence, uniqueShareCode } from "@/lib/board-data";
import { getBoardPayload } from "@/lib/board-payload";
import { all, run, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { normalizeBackground } from "@/lib/backgrounds";
import { removeUpload } from "@/lib/storage";

type Context = { params: Promise<{ slug: string }> };
const patchSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  shareMode: z.enum(["readonly", "write"]).optional(),
  audience: z.enum(["link", "members"]).optional(),
  accessPassword: z.string().max(100).optional(),
  background: z.string().trim().max(30).optional(),
  rotateShareLink: z.boolean().optional(),
});

export async function GET(_: Request, context: Context) {
  const { slug: id } = await context.params;
  const board = (await getBoardById(id));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const manager = await boardManager(board);
  if (!manager) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  await touchPresence(board.id, { type: "teacher", name: manager.name, emoji: "🧑‍🏫", deviceId: "teacher", instructorId: manager.id });
  return NextResponse.json((await getBoardPayload(board, { isAdmin: true, identityKey: `ins:${manager.id}` })), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const { slug: id } = await context.params;
  const board = (await getBoardById(id));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const manager = await boardManager(board);
  if (!manager) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("변경할 정보를 다시 확인해 주세요.");
  const shareToken = parsed.data.rotateShareLink ? randomBytes(24).toString("base64url") : board.share_token;
  const shareCode = parsed.data.rotateShareLink ? (await uniqueShareCode()) : board.share_code;
  // Setting a password writes the readable column and drops any legacy hash, so a board only ever
  // has one of the two and the settings screen can always show what it has.
  const accessPassword = parsed.data.accessPassword === undefined
    ? board.access_password
    : (parsed.data.accessPassword.trim() || null);
  const legacyHash = parsed.data.accessPassword === undefined ? board.access_password_hash : null;
  (await transaction(async () => {
    (await run(`UPDATE boards SET title = ?, description = ?, share_mode = ?, audience = ?, access_password = ?, access_password_hash = ?, background = ?, share_token = ?, share_code = ?, updated_at = ? WHERE id = ?`,
      parsed.data.title ?? board.title, parsed.data.description ?? board.description,
      parsed.data.shareMode ?? board.share_mode, parsed.data.audience ?? board.audience, accessPassword, legacyHash,
      parsed.data.background === undefined ? normalizeBackground(board.background) : normalizeBackground(parsed.data.background),
      shareToken, shareCode, now(), id));
    (await recordAction(id, { type: "teacher", name: manager.name },
      parsed.data.rotateShareLink ? "공유 링크를 새로 발급했습니다" : "보드 설정을 변경했습니다", "board", id,
      { shareMode: parsed.data.shareMode ?? board.share_mode }));
  }));
  return NextResponse.json({ ok: true, shareToken, shareCode });
}

export async function DELETE(_: Request, context: Context) {
  const { slug: id } = await context.params;
  const board = (await getBoardById(id));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const manager = await boardManager(board);
  if (!manager) return apiError("이 보드를 관리할 권한이 없습니다.", 403);
  const files = (await all<{ stored_name: string }>("SELECT stored_name FROM files WHERE board_id = ?", id));
  await run("DELETE FROM boards WHERE id = ?", id);
  await Promise.all(files.map((file) => removeUpload(file.stored_name)));
  return NextResponse.json({ ok: true });
}
