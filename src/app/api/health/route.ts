import { NextResponse } from "next/server";
import { get, getDriver } from "@/lib/db";

export async function GET() {
  try {
    await get("SELECT 1 AS ok");
    // Report the engine actually in use rather than a fixed string, so a deployment pointed at
    // the wrong database is visible from the health check instead of silently working.
    const { dialect } = await getDriver();
    return NextResponse.json({ ok: true, service: "aistudy", database: dialect });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
