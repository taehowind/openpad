import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyLogin } from "@/lib/accounts";
import { setInstructorSession } from "@/lib/auth";
import { apiError, clientIp, rateLimitedShared } from "@/lib/http";

const schema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (await rateLimitedShared(`login:${ip}`, 10, 10 * 60_000)) return apiError("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("이메일과 비밀번호를 확인해 주세요.");
  // Per-account throttle as well, so a botnet spread over many IPs cannot brute force one login.
  if (await rateLimitedShared(`login-acct:${parsed.data.email.trim().toLowerCase()}`, 10, 10 * 60_000)) {
    return apiError("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
  }
  const result = await verifyLogin(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    if (result.reason === "pending") return apiError("가입 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다.", 403, "PENDING");
    if (result.reason === "disabled") return apiError("비활성화된 계정입니다. 관리자에게 문의해 주세요.", 403, "DISABLED");
    return apiError("이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }
  await setInstructorSession({ id: result.instructor.id, role: result.instructor.role, tokenVersion: result.instructor.token_version ?? 0 });
  return NextResponse.json({
    ok: true,
    account: { id: result.instructor.id, name: result.instructor.name, email: result.instructor.email, role: result.instructor.role },
  });
}
