import { NextResponse } from "next/server";
import { getInstructorSession, getParticipantSession } from "@/lib/auth";

export async function GET() {
  const [account, participant] = await Promise.all([getInstructorSession(), getParticipantSession()]);
  return NextResponse.json({ account, participant });
}
