import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorForBoard } from "@/lib/access";
import { setParticipantSession } from "@/lib/auth";
import { getBoardById, now, recordAction } from "@/lib/board-data";
import { run, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { isProfileEmoji } from "@/lib/profile";

type Context = { params: Promise<{ slug: string }> };
const schema = z.object({ nickname: z.string().trim().min(1).max(30), emoji: z.string().min(1).max(8) });

export async function PATCH(request: Request, context: Context) {
  const { slug: boardId } = await context.params;
  const board = (await getBoardById(boardId));
  if (!board) return apiError("보드를 찾을 수 없습니다.", 404);
  const access = await actorForBoard(board);
  if (!access || access.isAdmin || !access.participant) return apiError("참여자 프로필을 찾을 수 없습니다.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isProfileEmoji(parsed.data.emoji)) return apiError("닉네임과 이모티콘을 다시 확인해 주세요.");
  const deviceId = access.participant.deviceId ?? randomUUID();
  const timestamp = now();
  (await transaction(async () => {
    (await run(`INSERT INTO device_profiles (device_id, nickname, emoji, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET nickname = excluded.nickname, emoji = excluded.emoji, updated_at = excluded.updated_at`,
      deviceId, parsed.data.nickname, parsed.data.emoji, timestamp, timestamp));
    (await run("UPDATE participants SET nickname = ?, emoji = ?, device_id = ?, updated_at = ? WHERE device_id = ? OR id = ?",
      parsed.data.nickname, parsed.data.emoji, deviceId, timestamp, deviceId, access.participant!.participantId));
    (await recordAction(boardId, {
      type: "guest", name: parsed.data.nickname, emoji: parsed.data.emoji,
      participantId: access.participant!.participantId, deviceId,
    }, "프로필을 변경했습니다", "participant", access.participant!.participantId, { emoji: parsed.data.emoji }, false));
  }));
  await setParticipantSession({
    participantId: access.participant.participantId,
    boardId,
    nickname: parsed.data.nickname,
    emoji: parsed.data.emoji,
    deviceId,
  });
  return NextResponse.json({ ok: true });
}
