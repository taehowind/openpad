import { NextResponse } from "next/server";
import { z } from "zod";
import { createInstructor } from "@/lib/accounts";
import { apiError, clientIp, rateLimitedShared } from "@/lib/http";

const schema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(60),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다.").max(200),
});

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (await rateLimitedShared(`signup:${ip}`, 6, 30 * 60_000)) return apiError("가입 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error?.issues?.[0]?.message ?? "가입 정보를 확인해 주세요.");
  const result = (await createInstructor(parsed.data));
  if (!result.ok) return apiError(result.error, 409);
  return NextResponse.json({ ok: true, pending: true }, { status: 201 });
}
