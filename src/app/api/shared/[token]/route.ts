import { NextResponse } from "next/server";
import { canManageBoard, ensureMemberParticipant } from "@/lib/access";
import { getInstructorSession, resolveParticipantForBoard } from "@/lib/auth";
import { getBoardByShareId, getBoardPayload, touchPresence } from "@/lib/board-data";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ token: string }> };

export async function GET(_: Request, context: Context) {
  const { token } = await context.params;
  const board = (await getBoardByShareId(token));
  if (!board) return apiError("공유 링크가 올바르지 않거나 만료되었습니다.", 404);
  const session = await getInstructorSession();

  // Owner / super-admin → full teacher view.
  if ((await canManageBoard(board, session))) {
    await touchPresence(board.id, { type: "teacher", name: session!.name, emoji: "🧑‍🏫", deviceId: "teacher", instructorId: session!.id });
    return NextResponse.json((await getBoardPayload(board, { isAdmin: true, identityKey: `ins:${session!.id}` })), { headers: { "Cache-Control": "no-store" } });
  }

  // Members-only boards: block anonymous students; other logged-in members participate.
  if (board.audience === "members") {
    if (!session) return apiError("회원 전용 보드입니다. 강사 계정으로 로그인한 뒤 이용해 주세요.", 401, "MEMBERS_ONLY");
    const member = (await ensureMemberParticipant(board, session));
    await touchPresence(board.id, { type: "guest", name: member.nickname, emoji: member.emoji, participantId: member.id, deviceId: member.deviceId });
    return NextResponse.json((await getBoardPayload(board, {
      isAdmin: false, identityKey: member.id, participantId: member.id, nickname: member.nickname, emoji: member.emoji,
    })), { headers: { "Cache-Control": "no-store" } });
  }

  // Link boards (students). Password-protected boards never auto-enroll — a new visitor must pass the gate.
  const autoEnroll = !board.access_password_hash;
  const participant = await resolveParticipantForBoard(board.id, autoEnroll);
  if (!participant) {
    return NextResponse.json(
      { error: "프로필을 만들고 보드에 참여해 주세요.", code: "JOIN_REQUIRED", passwordRequired: Boolean(board.access_password_hash) },
      { status: 401 },
    );
  }
  (await touchPresence(board.id, {
    type: "guest", name: participant.nickname, emoji: participant.emoji,
    participantId: participant.id, deviceId: participant.deviceId ?? undefined,
  }));
  return NextResponse.json((await getBoardPayload(board, {
    isAdmin: false, identityKey: participant.id, participantId: participant.id, nickname: participant.nickname, emoji: participant.emoji,
  })), { headers: { "Cache-Control": "no-store" } });
}
