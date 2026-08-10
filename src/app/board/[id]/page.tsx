import { BoardClient } from "@/components/BoardClient";

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoardClient identifier={id} mode="admin" />;
}
