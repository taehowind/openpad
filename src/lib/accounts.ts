import { randomUUID } from "node:crypto";
import { all, get, run } from "@/lib/db";
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

export async function deleteInstructor(id: string) {
  await run("DELETE FROM instructors WHERE id = ?", id);
}

export async function countActiveAdmins() {
  return (await get<{ count: number }>("SELECT COUNT(*) AS count FROM instructors WHERE role = 'admin' AND status = 'active'"))?.count ?? 0;
}
