import { randomUUID } from "node:crypto";
import { all, get, run, transaction } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export type InstructorRole = "admin" | "instructor";
export type InstructorStatus = "pending" | "active" | "disabled";

export type InstructorRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: InstructorRole;
  status: InstructorStatus;
  created_at: string;
  updated_at: string;
};

export type InstructorSummary = {
  id: string;
  email: string;
  name: string;
  role: InstructorRole;
  status: InstructorStatus;
  createdAt: string;
  boardCount: number;
};

const now = () => new Date().toISOString();

export async function getInstructorById(id: string) {
  return (await get<InstructorRow>("SELECT * FROM instructors WHERE id = ?", id));
}

export async function getInstructorByEmail(email: string) {
  return (await get<InstructorRow>("SELECT * FROM instructors WHERE email = ?", email.trim().toLowerCase()));
}

export async function createInstructor(input: { email: string; name: string; password: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if ((await getInstructorByEmail(email))) return { ok: false, error: "이미 가입된 이메일입니다." };
  const id = randomUUID();
  const timestamp = now();
  (await run(
    `INSERT INTO instructors (id, email, name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'instructor', 'pending', ?, ?)`,
    id, email, input.name.trim(), hashPassword(input.password), timestamp, timestamp,
  ));
  return { ok: true, id };
}

export type LoginResult =
  | { ok: true; instructor: InstructorRow }
  | { ok: false; reason: "invalid" | "pending" | "disabled" };

// A bcrypt hash of a value nobody can supply. Comparing against it when the account does not
// exist keeps the response time flat, so an attacker cannot enumerate registered emails.
const ABSENT_ACCOUNT_HASH = hashPassword(randomUUID());

export async function verifyLogin(email: string, password: string): Promise<LoginResult> {
  const instructor = (await getInstructorByEmail(email));
  if (!instructor) {
    verifyPassword(password, ABSENT_ACCOUNT_HASH);
    return { ok: false, reason: "invalid" };
  }
  if (!verifyPassword(password, instructor.password_hash)) return { ok: false, reason: "invalid" };
  if (instructor.status === "pending") return { ok: false, reason: "pending" };
  if (instructor.status === "disabled") return { ok: false, reason: "disabled" };
  return { ok: true, instructor };
}

export async function listInstructors(): Promise<InstructorSummary[]> {
  return (await all<InstructorRow & { board_count: number }>(
    `SELECT i.*, (SELECT COUNT(*) FROM boards b WHERE b.owner_id = i.id) AS board_count
       FROM instructors i ORDER BY CASE i.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, i.created_at DESC`,
  )).map((row) => ({
    id: row.id, email: row.email, name: row.name, role: row.role, status: row.status,
    createdAt: row.created_at, boardCount: row.board_count,
  }));
}

export async function updateInstructor(id: string, changes: { status?: InstructorStatus; role?: InstructorRole }) {
  const instructor = (await getInstructorById(id));
  if (!instructor) return { error: "회원을 찾을 수 없습니다." as const };
  (await run(
    "UPDATE instructors SET status = COALESCE(?, status), role = COALESCE(?, role), updated_at = ? WHERE id = ?",
    changes.status ?? null, changes.role ?? null, now(), id,
  ));
  return { ok: true as const };
}

/**
 * Self-service edit of one's own name and password. Separate from updateInstructor, which is the
 * admin's tool for role and status — the two answer to different rules and should not share a path.
 *
 * Changing the password always costs the current one. The session outlives the change either way:
 * the cookie carries no password material, and there is no token version to bump, so other devices
 * stay signed in. That is a known gap, noted in the design doc.
 */
export async function updateOwnProfile(
  id: string,
  changes: { name?: string; currentPassword?: string; newPassword?: string },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const instructor = (await getInstructorById(id));
  if (!instructor) return { ok: false, status: 404, error: "계정을 찾을 수 없습니다." };

  const name = changes.name?.trim();
  const wantsPassword = Boolean(changes.newPassword);
  if (!name && !wantsPassword) return { ok: false, status: 400, error: "변경할 내용을 입력해 주세요." };

  let passwordHash: string | null = null;
  if (wantsPassword) {
    if (!verifyPassword(changes.currentPassword ?? "", instructor.password_hash)) {
      return { ok: false, status: 403, error: "현재 비밀번호가 올바르지 않습니다." };
    }
    passwordHash = hashPassword(changes.newPassword!);
  }

  const timestamp = now();
  await transaction(async () => {
    (await run(
      "UPDATE instructors SET name = COALESCE(?, name), password_hash = COALESCE(?, password_hash), updated_at = ? WHERE id = ?",
      name ?? null, passwordHash, timestamp, id,
    ));
    if (name && name !== instructor.name) await renameAuthoredContent(id, name, timestamp);
  });
  return { ok: true };
}

/**
 * Carries a new name across the places it was copied to when the content was written.
 *
 * Only content written as a *member* is affected. On a board they manage, an instructor writes as
 * the teacher actor, whose stored name is the literal "강사" rather than theirs — nothing to rename
 * there. Elsewhere they get a participant row keyed `ins:<id>`, and that is what ties rows back to
 * a person; there is no foreign key to follow.
 *
 * audit_logs and board_revisions keep the old name on purpose: they record who did what at a
 * point in time, and rewriting them afterwards would empty them of their value. presence is left
 * alone too — the heartbeat rewrites it within 30 seconds.
 */
async function renameAuthoredContent(instructorId: string, name: string, timestamp: string) {
  const deviceKey = `ins:${instructorId}`;
  const mine = (await all<{ id: string }>("SELECT id FROM participants WHERE device_id = ?", deviceKey));
  (await run("UPDATE participants SET nickname = ?, updated_at = ? WHERE device_id = ?", name, timestamp, deviceKey));
  for (const { id } of mine) {
    await run("UPDATE cards SET author_name = ? WHERE participant_id = ?", name, id);
    await run("UPDATE comments SET author_name = ? WHERE participant_id = ?", name, id);
    await run("UPDATE chat_messages SET author_name = ? WHERE participant_id = ?", name, id);
  }
}

export async function deleteInstructor(id: string) {
  await run("DELETE FROM instructors WHERE id = ?", id);
}

export async function countActiveAdmins() {
  return (await get<{ count: number }>("SELECT COUNT(*) AS count FROM instructors WHERE role = 'admin' AND status = 'active'"))?.count ?? 0;
}
