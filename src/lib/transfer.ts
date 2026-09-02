import { randomUUID } from "node:crypto";
import { nextCardPosition, now, recordAction, uniqueCardShareCode, type Actor } from "@/lib/board-data";
import { all, get, run, transaction } from "@/lib/db";
import { readUpload, removeUpload, storedNameFor, writeUpload } from "@/lib/storage";

export type TransferMode = "move" | "copy";

type CardRow = {
  id: string; column_id: string; participant_id: string | null; actor_type: string; author_name: string;
  title: string; content: string; link_url: string | null; file_id: string | null;
  position: number; created_at: string; updated_at: string;
};
type FileRow = { id: string; original_name: string; stored_name: string; mime_type: string; size_bytes: number };

/** Where a transferred list should land: its own fresh column on the far right. */
async function nextGridCol(boardId: string) {
  return ((await get<{ v: number }>("SELECT COALESCE(MAX(grid_col), -1) + 1 AS v FROM board_columns WHERE board_id = ?", boardId))?.v ?? 0);
}

export async function firstColumnOf(boardId: string) {
  return (await get<{ id: string }>("SELECT id FROM board_columns WHERE board_id = ? ORDER BY grid_col, position LIMIT 1", boardId));
}

/**
 * Duplicates the stored files for a set of cards. Copies happen on disk BEFORE any DB work,
 * because (await transaction()) is synchronous and cannot await; the caller rolls these back by calling
 * the returned cleanup() if the transaction throws.
 *
 * Each copy gets its own files row rather than sharing the original: files are owned by a board
 * (ON DELETE CASCADE), so a shared row would vanish from the copy the moment the source board
 * was deleted.
 */
async function duplicateFiles(cards: CardRow[], targetBoardId: string) {
  const plans: { sourceCardId: string; row: FileRow; newId: string; newStoredName: string }[] = [];
  for (const card of cards) {
    if (!card.file_id) continue;
    const row = (await get<FileRow>("SELECT id, original_name, stored_name, mime_type, size_bytes FROM files WHERE id = ?", card.file_id));
    if (!row) continue;
    const newId = randomUUID();
    const newStoredName = storedNameFor(newId, row.stored_name);
    try {
      await writeUpload(newStoredName, await readUpload(row.stored_name), row.mime_type);
    } catch {
      continue; // source file missing on disk — copy the card without its attachment
    }
    plans.push({ sourceCardId: card.id, row, newId, newStoredName });
  }
  const timestamp = now();
  return {
    plans,
    insertRows: async () => {
      for (const plan of plans) {
        (await run(`INSERT INTO files (id, board_id, original_name, stored_name, mime_type, size_bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          plan.newId, targetBoardId, plan.row.original_name, plan.newStoredName,
          plan.row.mime_type, plan.row.size_bytes, timestamp));
      }
    },
    fileIdFor: (cardId: string) => plans.find((plan) => plan.sourceCardId === cardId)?.newId ?? null,
    cleanup: async () => { for (const plan of plans) await removeUpload(plan.newStoredName); },
  };
}

/** Copies a card's comments across, freezing attribution (see the participant_id note below). */
async function copyComments(sourceCardId: string, newCardId: string) {
  const comments = (await all<{ actor_type: string; author_name: string; content: string; created_at: string }>(
    "SELECT actor_type, author_name, content, created_at FROM comments WHERE card_id = ? ORDER BY created_at", sourceCardId,
  ));
  for (const comment of comments) {
    (await run(`INSERT INTO comments (id, card_id, participant_id, actor_type, author_name, content, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      randomUUID(), newCardId, comment.actor_type, comment.author_name, comment.content, comment.created_at));
  }
}

export async function transferColumn(
  column: { id: string; board_id: string; name: string; color: string },
  targetBoardId: string,
  mode: TransferMode,
  actor: Actor,
) {
  const cards = (await all<CardRow>(
    `SELECT id, column_id, participant_id, actor_type, author_name, title, content, link_url, file_id,
            position, created_at, updated_at
       FROM cards WHERE column_id = ? ORDER BY position, created_at`, column.id,
  ));
  const timestamp = now();
  const gridCol = (await nextGridCol(targetBoardId));

  if (mode === "move") {
    (await transaction(async () => {
      await run("UPDATE board_columns SET board_id = ?, grid_col = ?, position = 0 WHERE id = ?", targetBoardId, gridCol, column.id);
      await run("UPDATE cards SET board_id = ? WHERE column_id = ?", targetBoardId, column.id);
      // Attachments are scoped to a board for access control, so they have to follow the cards
      // or students on the destination board would get a 403 opening them.
      const fileIds = cards.map((card) => card.file_id).filter((id): id is string => !!id);
      // One statement rather than one round trip per attachment. Only the number of placeholders is
      // computed here — the ids are still bound — so this stays parameterised on both engines.
      if (fileIds.length > 0) {
        const slots = fileIds.map(() => "?").join(", ");
        (await run(`UPDATE files SET board_id = ? WHERE id IN (${slots})`, targetBoardId, ...fileIds));
      }
      await run("UPDATE boards SET updated_at = ? WHERE id IN (?, ?)", timestamp, column.board_id, targetBoardId);
      await recordAction(column.board_id, actor, "목록을 다른 보드로 옮겼습니다", "column", column.id, { name: column.name });
      await recordAction(targetBoardId, actor, "다른 보드에서 목록을 가져왔습니다", "column", column.id, { name: column.name, cards: cards.length });
    }));
    return { columnId: column.id, cards: cards.length };
  }

  const files = await duplicateFiles(cards, targetBoardId);
  const newColumnId = randomUUID();
  try {
    (await transaction(async () => {
      await files.insertRows();
      (await run("INSERT INTO board_columns (id, board_id, name, color, position, grid_col) VALUES (?, ?, ?, ?, 0, ?)",
        newColumnId, targetBoardId, column.name, column.color, gridCol));
      for (const [index, card] of cards.entries()) {
        const newCardId = randomUUID();
        // participant_id is deliberately NULL on a copy: participants belong to a single board, so
        // the original author is not a member here. author_name still carries the attribution.
        await run(`INSERT INTO cards
             (id, board_id, column_id, participant_id, actor_type, author_name, title, content, link_url,
              file_id, share_code, position, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newCardId, targetBoardId, newColumnId, card.actor_type, card.author_name, card.title, card.content,
          card.link_url, files.fileIdFor(card.id), await uniqueCardShareCode(), index, card.created_at, timestamp);
        await copyComments(card.id, newCardId);
      }
      await run("UPDATE boards SET updated_at = ? WHERE id = ?", timestamp, targetBoardId);
      await recordAction(targetBoardId, actor, "다른 보드의 목록을 복사해 왔습니다", "column", newColumnId, { name: column.name, cards: cards.length });
    }));
  } catch (error) {
    await files.cleanup();
    throw error;
  }
  return { columnId: newColumnId, cards: cards.length };
}

export async function transferCard(
  card: CardRow & { board_id: string; title: string },
  targetBoardId: string,
  targetColumnId: string,
  mode: TransferMode,
  actor: Actor,
) {
  const timestamp = now();

  if (mode === "move") {
    (await transaction(async () => {
      (await run("UPDATE cards SET board_id = ?, column_id = ?, position = ?, updated_at = ? WHERE id = ?",
        targetBoardId, targetColumnId, await nextCardPosition(targetColumnId), timestamp, card.id));
      if (card.file_id) (await run("UPDATE files SET board_id = ? WHERE id = ?", targetBoardId, card.file_id));
      await run("UPDATE boards SET updated_at = ? WHERE id IN (?, ?)", timestamp, card.board_id, targetBoardId);
      await recordAction(card.board_id, actor, "작품을 다른 보드로 옮겼습니다", "card", card.id, { title: card.title || "제목 없음" });
      await recordAction(targetBoardId, actor, "다른 보드에서 작품을 가져왔습니다", "card", card.id, { title: card.title || "제목 없음" });
    }));
    return { cardId: card.id };
  }

  const files = await duplicateFiles([card], targetBoardId);
  const newCardId = randomUUID();
  try {
    (await transaction(async () => {
      await files.insertRows();
      (await run(`INSERT INTO cards
           (id, board_id, column_id, participant_id, actor_type, author_name, title, content, link_url,
            file_id, share_code, position, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newCardId, targetBoardId, targetColumnId, card.actor_type, card.author_name, card.title, card.content,
        card.link_url, files.fileIdFor(card.id), (await uniqueCardShareCode()), await nextCardPosition(targetColumnId), card.created_at, timestamp));
      await copyComments(card.id, newCardId);
      await run("UPDATE boards SET updated_at = ? WHERE id = ?", timestamp, targetBoardId);
      await recordAction(targetBoardId, actor, "다른 보드의 작품을 복사해 왔습니다", "card", newCardId, { title: card.title || "제목 없음" });
    }));
  } catch (error) {
    await files.cleanup();
    throw error;
  }
  return { cardId: newCardId };
}
