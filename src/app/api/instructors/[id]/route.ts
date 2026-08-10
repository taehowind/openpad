import { NextResponse } from "next/server";
import { z } from "zod";
import { countActiveAdmins, deleteInstructor, getInstructorById, updateInstructor } from "@/lib/accounts";
import { getInstructorSession } from "@/lib/auth";
import { run } from "@/lib/db";
import { apiError } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };
const patchSchema = z.object({
  status: z.enum(["pending", "active", "disabled"]).optional(),
  role: z.enum(["admin", "instructor"]).optional(),
}).refine((value) => value.status !== undefined || value.role !== undefined);

export async function PATCH(request: Request, context: Context) {
  const session = await getInstructorSession();
  if (!session || session.role !== "admin") return apiError("관리자만 접근할 수 있습니다.", 403);
  const { id } = await context.params;
  const target = (await getInstructorById(id));
  if (!target) return apiError("회원을 찾을 수 없습니다.", 404);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("변경할 정보를 확인해 주세요.");
  const losesAdmin = target.role === "admin" && target.status === "active"
    && ((parsed.data.role !== undefined && parsed.data.role !== "admin") || (parsed.data.status !== undefined && parsed.data.status !== "active"));
  if (losesAdmin && (await countActiveAdmins()) <= 1) return apiError("마지막 관리자는 비활성화하거나 권한을 낮출 수 없습니다.", 409);
  await updateInstructor(id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, context: Context) {
  const session = await getInstructorSession();
  if (!session || session.role !== "admin") return apiError("관리자만 접근할 수 있습니다.", 403);
  const { id } = await context.params;
  const target = (await getInstructorById(id));
  if (!target) return apiError("회원을 찾을 수 없습니다.", 404);
  if (target.id === session.id) return apiError("본인 계정은 삭제할 수 없습니다.", 409);
  if (target.role === "admin" && target.status === "active" && (await countActiveAdmins()) <= 1) return apiError("마지막 관리자는 삭제할 수 없습니다.", 409);
  await run("UPDATE boards SET owner_id = NULL WHERE owner_id = ?", id);
  await deleteInstructor(id);
  return NextResponse.json({ ok: true });
}
