import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getInstructorSession } from "@/lib/auth";
import { createRevision, now, recordAction, uniqueShareCode } from "@/lib/board-data";
import { all, run, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { normalizeBackground } from "@/lib/backgrounds";
import type { BoardAudience, BoardType } from "@/lib/board-data";
import type { BoardSummary, ShareMode } from "@/lib/types";

const schema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  shareMode: z.enum(["readonly", "write"]).default("readonly"),
  audience: z.enum(["link", "members"]).default("link"),
  accessPassword: z.string().trim().max(100).optional(),
  type: z.enum(["board", "gallery"]).default("board"),
  background: z.string().trim().max(30).optional(),
});

const defaultColumns = [
  ["질문", "blue"],
  ["아이디어", "green"],
  ["실습 결과", "yellow"],
];
const galleryColumns = [["제출작", "purple"]];

type BoardListRow = {
  id: string; title: string; description: string; share_token: string; share_code: string; share_mode: ShareMode;
  owner_id: string | null; audience: BoardAudience; access_password: string | null; access_password_hash: string | null; type: BoardType; background: string; closed_at: string | null; created_at: string; updated_at: string;
  owner_name: string | null; card_count: number; participant_count: number;
};

function toSummary(row: BoardListRow): BoardSummary {
  return {
    id: row.id, title: row.title, description: row.description, shareToken: row.share_token, shareCode: row.share_code,
    shareMode: row.share_mode, type: row.type, background: normalizeBackground(row.background),
    audience: row.audience, requirePassword: Boolean(row.access_password || row.access_password_hash),
    // Only ever sent to the owner's own dashboard; students receive a board payload that has
    // no such field at all.
    accessPassword: row.access_password,
    closedAt: row.closed_at,
    ownerId: row.owner_id, ownerName: row.owner_name, cardCount: row.card_count, participantCount: row.participant_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function GET() {
  const session = await getInstructorSession();
  if (!session) return apiError("강사 로그인이 필요합니다.", 401);
  const selectBase = `SELECT b.*, o.name AS owner_name,
      (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id) AS card_count,
      (SELECT COUNT(*) FROM participants p WHERE p.board_id = b.id) AS participant_count
    FROM boards b LEFT JOIN instructors o ON o.id = b.owner_id`;
  const rows = session.role === "admin"
    ? (await all<BoardListRow>(`${selectBase} ORDER BY b.updated_at DESC`))
    : (await all<BoardListRow>(`${selectBase} WHERE b.owner_id = ? ORDER BY b.updated_at DESC`, session.id));
  return NextResponse.json(rows.map(toSummary), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getInstructorSession();
  if (!session) return apiError("강사 로그인이 필요합니다.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("보드 정보를 다시 확인해 주세요.");
  const boardId = randomUUID();
  const shareToken = randomBytes(24).toString("base64url");
  const shareCode = (await uniqueShareCode());
  const accessPassword = parsed.data.accessPassword?.trim() || null;
  const timestamp = now();
  (await transaction(async () => {
    (await run(
      `INSERT INTO boards (id, title, description, share_token, share_code, share_mode, owner_id, audience, access_password, type, background, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      boardId, parsed.data.title, parsed.data.description, shareToken, shareCode, parsed.data.shareMode,
      session.id, parsed.data.audience, accessPassword, parsed.data.type, normalizeBackground(parsed.data.background),
      timestamp, timestamp,
    ));
    const seedColumns = parsed.data.type === "gallery" ? galleryColumns : defaultColumns;
    for (const [position, [name, color]] of seedColumns.entries()) {
      await run("INSERT INTO board_columns (id, board_id, name, color, position, grid_col) VALUES (?, ?, ?, ?, ?, ?)",
        randomUUID(), boardId, name, color, position, position);
    }
    await recordAction(boardId, { type: "teacher", name: session.name }, "보드를 만들었습니다", "board", boardId);
    await createRevision(boardId, "최초 최종본", "final");
  }));
  return NextResponse.json({ id: boardId, shareToken, shareCode }, { status: 201 });
}
