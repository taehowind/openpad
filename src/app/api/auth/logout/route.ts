import { NextResponse } from "next/server";
import { clearSessions } from "@/lib/auth";

export async function POST() {
  await clearSessions();
  return NextResponse.json({ ok: true });
}
