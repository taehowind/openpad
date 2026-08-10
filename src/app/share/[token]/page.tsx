import { BoardClient } from "@/components/BoardClient";

export default async function SharedBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BoardClient identifier={token} mode="share" />;
}
