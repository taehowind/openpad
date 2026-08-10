import { NextResponse } from "next/server";
import { listInstructors } from "@/lib/accounts";
import { getInstructorSession } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function GET() {
  const session = await getInstructorSession();
  if (!session || session.role !== "admin") return apiError("관리자만 접근할 수 있습니다.", 403);
  return NextResponse.json(await listInstructors(), { headers: { "Cache-Control": "no-store" } });
}
