import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getInstructorById, type InstructorRole } from "@/lib/accounts";
import { get, run } from "@/lib/db";

const INSTRUCTOR_COOKIE = "aistudy_teacher";
const PARTICIPANT_COOKIE = "aistudy_participant";
const DEVICE_COOKIE = "aistudy_device";
const instructorMaxAge = 60 * 60 * 12;
const participantMaxAge = 60 * 60 * 24 * 30;
const deviceMaxAge = 60 * 60 * 24 * 365;

export type InstructorSession = { id: string; role: InstructorRole; name: string };

export type ParticipantSession = {
  participantId: string;
  boardId: string;
  nickname: string;
  emoji: string;
  deviceId?: string;
};

export type ParticipantIdentity = {
  id: string;
  boardId: string;
  nickname: string;
  emoji: string;
  deviceId: string | null;
};

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must contain at least 32 characters");
    return new TextEncoder().encode("development-only-secret-change-me-now");
  }
  return new TextEncoder().encode(secret);
}

// Token lifetime always matches the cookie it rides in — a stolen instructor token must not
// outlive the 12h session just because the cookie was copied elsewhere.
async function sign(payload: Record<string, string>, maxAgeSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecret());
}

async function verify(token: string | undefined) {
  if (!token) return null;
  try {
    return (await jwtVerify(token, getSecret())).payload;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

export async function setInstructorSession(instructor: { id: string; role: InstructorRole }) {
  (await cookies()).set(INSTRUCTOR_COOKIE, await sign({ typ: "instructor", id: instructor.id, level: instructor.role }, instructorMaxAge), cookieOptions(instructorMaxAge));
}

export async function setDeviceIdentity(deviceId: string) {
  (await cookies()).set(DEVICE_COOKIE, await sign({ role: "device", deviceId }, deviceMaxAge), cookieOptions(deviceMaxAge));
}

export async function getDeviceId() {
  const payload = await verify((await cookies()).get(DEVICE_COOKIE)?.value);
  return payload?.role === "device" && typeof payload.deviceId === "string" ? payload.deviceId : null;
}

export async function setParticipantSession(session: ParticipantSession) {
  const jar = await cookies();
  jar.set(
    PARTICIPANT_COOKIE,
    await sign({
      role: "participant",
      participantId: session.participantId,
      boardId: session.boardId,
      nickname: session.nickname,
      emoji: session.emoji,
      ...(session.deviceId ? { deviceId: session.deviceId } : {}),
    }, participantMaxAge),
    cookieOptions(participantMaxAge),
  );
  if (session.deviceId) jar.set(DEVICE_COOKIE, await sign({ role: "device", deviceId: session.deviceId }, deviceMaxAge), cookieOptions(deviceMaxAge));
}

export async function getInstructorSession(): Promise<InstructorSession | null> {
  const payload = await verify((await cookies()).get(INSTRUCTOR_COOKIE)?.value);
  if (payload?.typ !== "instructor" || typeof payload.id !== "string") return null;
  const instructor = (await getInstructorById(payload.id));
  if (!instructor || instructor.status !== "active") return null;
  return { id: instructor.id, role: instructor.role, name: instructor.name };
}

export async function getParticipantSession(): Promise<ParticipantSession | null> {
  const payload = await verify((await cookies()).get(PARTICIPANT_COOKIE)?.value);
  if (
    payload?.role !== "participant" ||
    typeof payload.participantId !== "string" ||
    typeof payload.boardId !== "string" ||
    typeof payload.nickname !== "string"
  ) return null;
  return {
    participantId: payload.participantId,
    boardId: payload.boardId,
    nickname: payload.nickname,
    emoji: typeof payload.emoji === "string" ? payload.emoji : "🙂",
    deviceId: typeof payload.deviceId === "string" ? payload.deviceId : undefined,
  };
}

async function participantById(participantId: string, boardId: string) {
  return (await get<{ id: string; board_id: string; nickname: string; emoji: string; device_id: string | null }>(
    "SELECT id, board_id, nickname, emoji, device_id FROM participants WHERE id = ? AND board_id = ?",
    participantId, boardId,
  ));
}

export async function resolveParticipantForBoard(boardId: string, autoEnroll = false): Promise<ParticipantIdentity | null> {
  const timestamp = new Date().toISOString();
  const session = await getParticipantSession();
  const cookieDeviceId = await getDeviceId();
  if (session?.boardId === boardId) {
    const row = (await participantById(session.participantId, boardId));
    if (row) {
      let deviceId = row.device_id ?? session.deviceId ?? cookieDeviceId;
      if (!deviceId) deviceId = randomUUID();
      if (!row.device_id) {
        (await run("INSERT INTO device_profiles (device_id, nickname, emoji, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
          deviceId, row.nickname, row.emoji || "🙂", timestamp, timestamp));
        // Another row on this board may already claim the device (two joins from one browser) —
        // the partial unique index would reject the update, so skip it rather than 500.
        await run(
          `UPDATE participants SET device_id = ?, updated_at = ? WHERE id = ?
             AND NOT EXISTS (SELECT 1 FROM participants other
                              WHERE other.board_id = ? AND other.device_id = ? AND other.id <> ?)`,
          deviceId, timestamp, row.id, boardId, deviceId, row.id);
      }
      const identity = { id: row.id, boardId, nickname: row.nickname, emoji: row.emoji || "🙂", deviceId };
      await setParticipantSession({ participantId: identity.id, boardId, nickname: identity.nickname, emoji: identity.emoji, deviceId });
      return identity;
    }
  }

  if (!cookieDeviceId) return null;
  const existing = (await get<{ id: string; board_id: string; nickname: string; emoji: string; device_id: string }>(
    "SELECT id, board_id, nickname, emoji, device_id FROM participants WHERE board_id = ? AND device_id = ?",
    boardId, cookieDeviceId,
  ));
  if (existing) {
    const identity = { id: existing.id, boardId, nickname: existing.nickname, emoji: existing.emoji || "🙂", deviceId: existing.device_id };
    await setParticipantSession({ participantId: identity.id, boardId, nickname: identity.nickname, emoji: identity.emoji, deviceId: identity.deviceId });
    return identity;
  }
  if (!autoEnroll) return null;
  const profile = (await get<{ nickname: string; emoji: string }>("SELECT nickname, emoji FROM device_profiles WHERE device_id = ?", cookieDeviceId));
  if (!profile) return null;
  const participantId = randomUUID();
  // Page load, SSE stream and heartbeat can auto-enroll concurrently — let the unique
  // index arbitrate and read back whichever row won instead of throwing.
  (await run(`INSERT INTO participants (id, board_id, nickname, emoji, device_id, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, participantId, boardId, profile.nickname, profile.emoji, cookieDeviceId, timestamp, timestamp));
  const enrolled = (await get<{ id: string; nickname: string; emoji: string }>(
    "SELECT id, nickname, emoji FROM participants WHERE board_id = ? AND device_id = ?", boardId, cookieDeviceId,
  )) ?? { id: participantId, nickname: profile.nickname, emoji: profile.emoji };
  await setParticipantSession({ participantId: enrolled.id, boardId, nickname: enrolled.nickname, emoji: enrolled.emoji, deviceId: cookieDeviceId });
  return { id: enrolled.id, boardId, nickname: enrolled.nickname, emoji: enrolled.emoji, deviceId: cookieDeviceId };
}

export async function clearInstructorSession() {
  (await cookies()).delete(INSTRUCTOR_COOKIE);
}

export async function clearSessions() {
  const jar = await cookies();
  jar.delete(INSTRUCTOR_COOKIE);
  jar.delete(PARTICIPANT_COOKIE);
}
