import { NextResponse } from "next/server";
import { z } from "zod";
import { getInstructorById, updateOwnProfile } from "@/lib/accounts";
import { getInstructorSession } from "@/lib/auth";
import { apiError, rateLimitedShared } from "@/lib/http";

/**
 * The signed-in instructor editing their own name and password.
 *
 * Deliberately not folded into /api/instructors/[id], which is the admin's route for role and
 * status: that one answers to "are you an admin", this one to "is this you", and a handler that
 * has to hold both rules at once is a handler that eventually gets one of them wrong.
 *
 * Email is not editable — it is the login identity, and changing it is an account-recovery
 * problem rather than a profile edit.
 */
const schema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z.string().min(8).max(200).optional(),
}).refine((value) => value.name !== undefined || value.newPassword !== undefined, {
  message: "변경할 내용이 없습니다.",
});

export async function PATCH(request: Request) {
  const session = await getInstructorSession();
  if (!session) return apiError("로그인이 필요합니다.", 401);

  // This verifies a password, so it is a guessing target even though the caller is already signed
  // in — a borrowed session plus a few thousand tries would otherwise hand over the account. That
  // makes it an auth path, and auth paths need the database-backed limiter: the in-memory one
  // counts per instance, so on serverless the real limit is 10 times however many instances happen
  // to be warm.
  if (await rateLimitedShared(`profile:${session.id}`, 10, 60_000)) {
    return apiError("잠시 후 다시 시도해 주세요.", 429);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const tooShort = parsed.error.issues.some((issue) => issue.path[0] === "newPassword");
    return apiError(tooShort ? "새 비밀번호는 8자 이상이어야 합니다." : "변경할 정보를 확인해 주세요.");
  }

  const result = await updateOwnProfile(session.id, parsed.data);
  if (!result.ok) return apiError(result.error, result.status);

  const updated = (await getInstructorById(session.id));
  return NextResponse.json({
    ok: true,
    account: updated && { id: updated.id, email: updated.email, name: updated.name, role: updated.role },
  });
}
