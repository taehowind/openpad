import { BoardClient } from "@/components/BoardClient";

export default async function JoinByCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <BoardClient identifier={code} mode="share" />;
}
