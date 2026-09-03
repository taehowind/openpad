import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDeviceId, setParticipantSession } from "@/lib/auth";
import { getBoardByShareId, now, recordAction } from "@/lib/board-data";
import { get, run, transaction } from "@/lib/db";
import { apiError, clientIp, rateLimitedShared } from "@/lib/http";
import { matchesSecret, verifyPassword } from "@/lib/password";
import { isProfileEmoji } from "@/lib/profile";

type Context = { params: Promise<{ token: string }> };
const schema = z.object({
  nickname: z.string().trim().min(1).max(30),
  emoji: z.string().min(1).max(8),
  password: z.string().max(100).optional(),
});

export async function POST(request: Request, context: Context) {
  const ip = clientIp(request);
  if (await rateLimitedShared(`join:${ip}`, 30, 10 * 60_000)) return apiError("참여 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
  const { token } = await context.params;
  const board = (await getBoardByShareId(token));
  if (!board) return apiError("공유 링크가 올바르지 않거나 만료되었습니다.", 404);
  if (board.audience === "members") return apiError("회원 전용 보드입니다. 강사 계정으로 로그인해 주세요.", 403, "MEMBERS_ONLY");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isProfileEmoji(parsed.data.emoji)) return apiError("닉네임과 이모티콘을 선택해 주세요.");
  // Boards set up since the entry code became readable carry it in access_password; older ones
  // still only have a hash, and both have to keep opening the same door.
  if (board.access_password || board.access_password_hash) {
    // Throttle per board as well as per IP — the code is short and shared with a whole class.
    if (await rateLimitedShared(`board-pw:${board.id}:${ip}`, 10, 10 * 60_000) || await rateLimitedShared(`board-pw:${board.id}`, 60, 10 * 60_000)) {
      return apiError("입장 비밀번호 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
    }
    const given = parsed.data.password ?? "";
    const ok = board.access_password
      ? matchesSecret(given, board.access_password)
      : verifyPassword(given, board.access_password_hash!);
    if (!ok) return apiError("입장 비밀번호가 올바르지 않습니다.", 403, "BAD_PASSWORD");
  }
  const deviceId = (await getDeviceId()) ?? randomUUID();
  const timestamp = now();
  // Re-joining from the same browser must update the existing profile, not insert a
  // second row — the (board_id, device_id) unique index would reject that.
  const existing = (await get<{ id: string }>(
    "SELECT id FROM participants WHERE board_id = ? AND device_id = ?", board.id, deviceId,
  ));
  const participantId = existing?.id ?? randomUUID();
  (await transaction(async () => {
    (await run(`INSERT INTO device_profiles (device_id, nickname, emoji, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET nickname = excluded.nickname, emoji = excluded.emoji, updated_at = excluded.updated_at`,
      deviceId, parsed.data.nickname, parsed.data.emoji, timestamp, timestamp));
    if (existing) {
      (await run("UPDATE participants SET nickname = ?, emoji = ?, updated_at = ? WHERE id = ?",
        parsed.data.nickname, parsed.data.emoji, timestamp, participantId));
    } else {
      (await run(`INSERT INTO participants (id, board_id, nickname, emoji, device_id, updated_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)` , participantId, board.id, parsed.data.nickname, parsed.data.emoji, deviceId, timestamp, timestamp));
    }
    (await recordAction(board.id, {
      type: "guest", name: parsed.data.nickname, emoji: parsed.data.emoji, participantId, deviceId,
    }, "보드에 입장했습니다", "participant", participantId, { emoji: parsed.data.emoji }, false));
  }));
  await setParticipantSession({
    participantId, boardId: board.id, nickname: parsed.data.nickname,
    emoji: parsed.data.emoji, deviceId,
  });
  return NextResponse.json({ ok: true });
}
