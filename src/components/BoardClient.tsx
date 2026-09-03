"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Activity, ArrowLeft, ArrowRightLeft, Check, ChevronLeft, ChevronRight, Clock3, Code2, Copy, Download, ExternalLink, Eye, File,
  FileClock, GripVertical, Heart, History, Link2, Lock, LockKeyhole, Maximize2, MessageSquare, MonitorPlay, MoreHorizontal, Paperclip,
  Palette, Pencil, Plus, QrCode, RefreshCw, RotateCcw, Save, Send, Settings2, Shield, ShieldCheck, Sparkles, Trash2, Upload, X,
  FolderInput,
} from "lucide-react";
import { ActiveViewers } from "@/components/ActiveViewers";
import { BoardChat } from "@/components/BoardChat";
import { Brand } from "@/components/Brand";
import { useDialog } from "@/components/DialogProvider";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { ProfileForm } from "@/components/ProfileForm";
import { QrModal } from "@/components/QrModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/components/ToastProvider";
import { attachFile, responseError } from "@/lib/api-client";
import { BOARD_BACKGROUNDS, type BoardBackground } from "@/lib/backgrounds";
import { renderMarkdown } from "@/lib/markdown";
import type { BoardCard, BoardComment, BoardPayload, BoardSummary, RevisionEntry } from "@/lib/types";

type BoardClientProps = { identifier: string; mode: "admin" | "share" };
type ColumnColor = "gray" | "blue" | "cyan" | "green" | "lime" | "yellow" | "orange" | "red" | "pink" | "purple";

const COLUMN_COLORS: { value: ColumnColor; label: string }[] = [
  { value: "gray", label: "회색" },
  { value: "blue", label: "파랑" },
  { value: "cyan", label: "청록" },
  { value: "green", label: "초록" },
  { value: "lime", label: "연두" },
  { value: "yellow", label: "노랑" },
  { value: "orange", label: "주황" },
  { value: "red", label: "빨강" },
  { value: "pink", label: "분홍" },
  { value: "purple", label: "보라" },
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function fileSize(value: number | null) {
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

export function BoardClient({ identifier, mode }: BoardClientProps) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinRequired, setJoinRequired] = useState(false);
  const [membersOnly, setMembersOnly] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [composerColumn, setComposerColumn] = useState<string | null>(null);
  const [editCard, setEditCard] = useState<BoardCard | null>(null);
  const [moveMenuCard, setMoveMenuCard] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [panel, setPanel] = useState<"activity" | "versions" | "settings" | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [slideshow, setSlideshow] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [galleryComposerOpen, setGalleryComposerOpen] = useState(false);
  const [galleryPreview, setGalleryPreview] = useState<BoardCard | null>(null);
  const [galleryShare, setGalleryShare] = useState<BoardCard | null>(null);
  const [detailCard, setDetailCard] = useState<BoardCard | null>(null);
  const [galleryTab, setGalleryTab] = useState<"code" | "file">("code");
  const [galleryCode, setGalleryCode] = useState("");
  const [galleryFileName, setGalleryFileName] = useState("");
  const [galleryEdit, setGalleryEdit] = useState<BoardCard | null>(null);
  const [galleryEditTab, setGalleryEditTab] = useState<"code" | "file">("code");
  const [galleryEditCode, setGalleryEditCode] = useState("");
  const [galleryEditFileName, setGalleryEditFileName] = useState("");
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [commentsOpen, setCommentsOpen] = useState<Record<string, boolean>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  // Comment bodies are fetched per card rather than shipped with every poll of the board. undefined
  // means "not fetched yet", which is what tells the list to say 불러오는 중 instead of 댓글 없음.
  const [commentsByCard, setCommentsByCard] = useState<Record<string, BoardComment[] | undefined>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [cardDropTarget, setCardDropTarget] = useState<{ id: string; placement: "before" | "after" } | null>(null);
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<{ id: string; placement: "before" | "after" } | null>(null);
  const [menuCard, setMenuCard] = useState<string | null>(null);
  const [menuColumn, setMenuColumn] = useState<string | null>(null);
  const [columnNameDraft, setColumnNameDraft] = useState("");
  const [gridColDropTarget, setGridColDropTarget] = useState<number | null>(null);
  const [fileDropColumn, setFileDropColumn] = useState<string | null>(null);
  // Viewport coordinates for the open "…" card menu — it renders fixed so list scrolling never clips it.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const pendingPickerRef = useRef<"create" | "edit" | null>(null);
  // Moving/copying a list (or a gallery work) onto another board — managers only.
  const [transferTarget, setTransferTarget] = useState<{ kind: "column" | "card"; id: string; name: string } | null>(null);
  const [transferBoards, setTransferBoards] = useState<BoardSummary[] | null>(null);
  const [transferBoardId, setTransferBoardId] = useState("");
  const [transferMode, setTransferMode] = useState<"move" | "copy">("copy");
  const [settingsBackground, setSettingsBackground] = useState<BoardBackground | null>(null);
  const panRef = useRef({ active: false, startX: 0, startY: 0, left: 0, top: 0 });

  const endpoint = mode === "admin" ? `/api/boards/${identifier}` : `/api/shared/${identifier}`;
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.status === 401 && mode === "share") {
      const info = await response.json().catch(() => ({}));
      if (info.code === "MEMBERS_ONLY") {
        setMembersOnly(true);
        setJoinRequired(false);
      } else {
        setJoinRequired(true);
        setMembersOnly(false);
        setPasswordRequired(Boolean(info.passwordRequired));
      }
      setData(null);
    } else if (response.status === 404) {
      setNotFound(true);
    } else if (response.ok) {
      const text = await response.text();
      const parsed = JSON.parse(text) as BoardPayload;
      setData((prev) => (prev && JSON.stringify(prev) === text ? prev : parsed));
      setJoinRequired(false);
      setMembersOnly(false);
      setNotFound(false);
      if (!quiet) setError("");
    } else if (!quiet) {
      setError(await responseError(response, "보드를 불러오지 못했습니다."));
    }
    if (!quiet) setLoading(false);
  }, [endpoint, mode]);

  const loadComments = useCallback(async (cardId: string) => {
    try {
      const response = await fetch(`/api/cards/${cardId}/comments`, { cache: "no-store" });
      if (!response.ok) return;
      const { comments } = await response.json() as { comments: BoardComment[] };
      setCommentsByCard((current) => ({ ...current, [cardId]: comments }));
    } catch {
      // A failed fetch leaves the cache untouched; the next open or poll tries again.
    }
  }, []);

  // Which comment lists are on screen. Held in a ref so the heartbeat below can read it without
  // taking a dependency on it — depending on it would tear down and restart the poll every time
  // someone opened a card.
  const openCommentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const open = new Set(Object.entries(commentsOpen).filter(([, isOpen]) => isOpen).map(([id]) => id));
    if (detailCard) open.add(detailCard.id);
    openCommentsRef.current = open;
  }, [commentsOpen, detailCard]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    // Heartbeat keeps presence fresh and acts as a fallback if the SSE stream drops.
    const heartbeat = window.setInterval(() => {
      void load(true);
      // Comment bodies no longer ride along with the payload, so refresh the ones being read.
      // Normally that is nothing, occasionally one card.
      for (const cardId of openCommentsRef.current) void loadComments(cardId);
    }, 15000);
    const eventsUrl = mode === "admin" ? `/api/boards/${identifier}/events` : `/api/shared/${identifier}/events`;
    let source: EventSource | null = null;
    try {
      source = new EventSource(eventsUrl);
      source.onmessage = (event) => { if (event.data === "update") void load(true); };
      // Deployments without push answer 501. Closing here stops EventSource from reconnecting
      // on a loop; the heartbeat above keeps the board in sync on its own.
      source.onerror = () => { source?.close(); source = null; };
    } catch {
      // EventSource unsupported → heartbeat polling still keeps things in sync.
    }
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(heartbeat);
      source?.close();
    };
  }, [load, loadComments, mode, identifier]);

  // Opens the OS file picker as soon as the freshly rendered file tab is on screen.
  useEffect(() => {
    const pending = pendingPickerRef.current;
    if (!pending) return;
    if (pending === "create" && galleryTab !== "file") return;
    if (pending === "edit" && galleryEditTab !== "file") return;
    pendingPickerRef.current = null;
    document.querySelector<HTMLInputElement>(pending === "create" ? "#gallery-file-input" : "#gallery-edit-file-input")?.click();
  }, [galleryTab, galleryEditTab]);

  // Arrow keys walk the gallery viewer; Escape closes it.
  const cards = data?.cards;
  useEffect(() => {
    if (!galleryPreview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setGalleryPreview(null); return; }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const ordered = [...(cards ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setGalleryPreview((current) => {
        if (!current) return current;
        const index = ordered.findIndex((item) => item.id === current.id);
        return ordered[index + (event.key === "ArrowRight" ? 1 : -1)] ?? current;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryPreview, cards]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    if (!detailCard) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailCard(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailCard]);

  // Close any open "…" menu (card / list) when clicking outside of it.
  useEffect(() => {
    if (!menuCard && !menuColumn) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".card-menu, .list-menu")) {
        setMenuCard(null);
        setMoveMenuCard(null);
        setMenuColumn(null);
      }
    };
    // The card menu is viewport-positioned so it can escape the list's scroll area —
    // any scroll would detach it from its card, so close it instead.
    const onScroll = () => { setMenuCard(null); setMoveMenuCard(null); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menuCard, menuColumn]);

  // Refresh the time reference for the NEW badge periodically.
  useEffect(() => {
    const interval = window.setInterval(() => setNowTs(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const grouped = useMemo(() => {
    const result = new Map<string, BoardCard[]>();
    for (const card of data?.cards ?? []) result.set(card.columnId, [...(result.get(card.columnId) ?? []), card]);
    return result;
  }, [data?.cards]);

  // Presentation order: column by column (reading order), cards by position within each.
  const slideCards = useMemo(() => {
    if (!data) return [] as BoardCard[];
    return data.columns.flatMap((column) => data.cards.filter((card) => card.columnId === column.id));
  }, [data]);

  useEffect(() => {
    if (!slideshow) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSlideshow(false);
      else if (event.key === "ArrowRight" || event.key === " ") setSlideIndex((index) => Math.min(index + 1, slideCards.length - 1));
      else if (event.key === "ArrowLeft") setSlideIndex((index) => Math.max(index - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slideshow, slideCards.length]);

  async function runAction<T>(loadingMessage: string, successMessage: string, fallbackMessage: string, action: () => Promise<T>) {
    const toastId = toast.show(loadingMessage, "loading");
    try {
      const result = await action();
      toast.update(toastId, successMessage, "success");
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : fallbackMessage;
      setError(message);
      toast.update(toastId, message, "error", 4500);
      return null;
    }
  }

  async function copyShareLink() {
    try {
      if (!data?.board.shareCode) throw new Error("복사할 공유 링크가 없습니다.");
      await navigator.clipboard.writeText(`${window.location.origin}/wz/${data.board.shareCode}`);
      toast.show("공유 링크를 클립보드에 복사했습니다.", "success");
    } catch {
      toast.show("링크를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.", "error", 4500);
    }
  }

  async function copyAccessPassword() {
    try {
      if (!data?.board.accessPassword) throw new Error("복사할 입장 비밀번호가 없습니다.");
      await navigator.clipboard.writeText(data.board.accessPassword);
      toast.show("입장 비밀번호를 클립보드에 복사했습니다.", "success");
    } catch {
      toast.show("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.", "error", 4500);
    }
  }

  async function clearBoardAccessPassword() {
    if (!data?.isAdmin) return;
    const ok = await dialog.confirm({
      title: "입장 비밀번호 사용 안 함",
      message: "앞으로는 링크를 가진 사람이 비밀번호 없이 입장합니다. 계속할까요?",
      confirmLabel: "사용 안 함",
      tone: "danger",
    });
    if (!ok) return;
    await runAction("설정을 저장하는 중…", "입장 비밀번호를 해제했습니다.", "설정을 변경하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessPassword: "" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "설정을 변경하지 못했습니다."));
      await load(true);
    });
  }

  async function refreshBoard() {
    await runAction("보드를 새로고침하는 중…", "최신 내용으로 새로고침했습니다.", "보드를 새로고침하지 못했습니다.", async () => {
      await load();
    });
  }

  async function join(profile: { nickname: string; emoji: string }) {
    setBusy(true);
    setError("");
    await runAction("프로필을 저장하는 중…", "프로필을 저장하고 보드에 입장했습니다.", "보드에 입장하지 못했습니다.", async () => {
      const response = await fetch(`/api/shared/${identifier}/join`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profile, ...(passwordRequired ? { password: joinPassword } : {}) }),
      });
      if (!response.ok) throw new Error(await responseError(response, "보드에 입장하지 못했습니다."));
      setJoinPassword("");
      await load();
    });
    setBusy(false);
  }

  async function updateProfile(profile: { nickname: string; emoji: string }) {
    if (!data?.participant) return;
    setBusy(true);
    const updated = await runAction("프로필을 변경하는 중…", "프로필을 변경했습니다.", "프로필을 변경하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/profile`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error(await responseError(response, "프로필을 변경하지 못했습니다."));
      await load(true);
      return true;
    });
    if (updated) setProfileOpen(false);
    setBusy(false);
  }


  async function createCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const picked = form.get("file");
    const created = await runAction("카드를 업로드하는 중…", "카드를 목록에 추가했습니다.", "카드를 추가하지 못했습니다.", async () => {
      if (picked instanceof globalThis.File && picked.size > 0) {
        form.delete("file");
        await attachFile(data.board.id, form, picked);
      } else {
        form.delete("file");
      }
      const response = await fetch(`/api/boards/${data.board.id}/cards`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await responseError(response, `카드를 추가하지 못했습니다. (${response.status})`));
      await load(true).catch(() => undefined);
      return true;
    });
    setBusy(false);
    if (created) {
      setComposerColumn(null);
      setSelectedFileName("");
    }
  }

  // Drop OS files onto a list to register them as cards.
  async function handleFileDrop(columnId: string, files: File[]) {
    if (!data?.canWrite || files.length === 0) return;
    for (const file of files) {
      if (!file || file.size === 0) continue;
      if (!data.isAdmin && file.size > 10 * 1024 * 1024) { setError(`'${file.name}'은 10MB를 초과해 올릴 수 없습니다.`); continue; }
      const form = new FormData();
      form.append("columnId", columnId);
      form.append("title", file.name.replace(/\.[^.]+$/, "").slice(0, 120));
      await runAction("파일을 카드로 올리는 중…", `'${file.name}'을(를) 카드로 등록했습니다.`, "파일을 올리지 못했습니다.", async () => {
        await attachFile(data.board.id, form, file);
        const response = await fetch(`/api/boards/${data.board.id}/cards`, { method: "POST", body: form });
        if (!response.ok) throw new Error(await responseError(response, "파일을 올리지 못했습니다."));
        await load(true).catch(() => undefined);
      });
    }
  }

  async function saveCardEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !editCard) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const rawLink = String(form.get("linkUrl") ?? "").trim();
    const saved = await runAction("카드를 수정하는 중…", "카드를 수정했습니다.", "카드를 수정하지 못했습니다.", async () => {
      const response = await fetch(`/api/cards/${editCard.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? "").trim(),
          content: String(form.get("content") ?? "").trim(),
          linkUrl: rawLink || null,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "카드를 수정하지 못했습니다."));
      await load(true);
      return true;
    });
    setBusy(false);
    if (saved) setEditCard(null);
  }

  async function moveCardToColumn(card: BoardCard, columnId: string) {
    if (!data?.canWrite || card.columnId === columnId) { setMoveMenuCard(null); setMenuCard(null); return; }
    setMoveMenuCard(null);
    setMenuCard(null);
    const previousCards = data.cards;
    setData({ ...data, cards: data.cards.map((item) => item.id === card.id ? { ...item, columnId } : item) });
    const moved = await runAction("카드를 이동하는 중…", "카드를 새 목록으로 이동했습니다.", "카드를 이동하지 못했습니다.", async () => {
      const response = await fetch(`/api/cards/${card.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ columnId }),
      });
      if (!response.ok) throw new Error(await responseError(response, "카드를 이동하지 못했습니다."));
      return true;
    });
    if (!moved) {
      setData((current) => current ? { ...current, cards: previousCards } : current);
      await load(true);
    }
  }

  async function uploadGalleryItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    let file: File | null = null;
    if (galleryTab === "code") {
      const code = galleryCode.trim();
      if (!code) { setError("HTML 코드를 입력해 주세요."); return; }
      file = new globalThis.File([code], "index.html", { type: "text/html" });
    } else {
      const uploaded = form.get("htmlfile");
      file = uploaded instanceof globalThis.File && uploaded.size > 0 ? uploaded : null;
      if (!file) { setError("HTML 파일을 선택해 주세요."); return; }
      // Normalise the upload: some browsers report an empty MIME type for .html files,
      // and odd file names would end up as the stored extension.
      file = new globalThis.File([file], /\.(html?|htm)$/i.test(file.name) ? file.name : `${file.name}.html`, { type: "text/html" });
    }
    if (!title) { setError("작품 제목을 입력해 주세요."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("작품은 최대 5MB까지 올릴 수 있습니다."); return; }
    const columnId = data.columns[0]?.id;
    if (!columnId) { setError("이 갤러리에 목록이 없습니다. 강사에게 문의해 주세요."); return; }
    setBusy(true);
    setError("");
    const upload = new FormData();
    upload.append("columnId", columnId);
    upload.append("title", title);
    upload.append("content", description);
    await attachFile(data.board.id, upload, file);
    const done = await runAction("작품을 올리는 중…", "작품을 갤러리에 올렸습니다.", "작품을 올리지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/cards`, { method: "POST", body: upload });
      if (!response.ok) throw new Error(await responseError(response, `작품을 올리지 못했습니다. (${response.status})`));
      // The board refresh is best-effort — the work is already saved at this point.
      await load(true).catch(() => undefined);
      return true;
    });
    setBusy(false);
    if (done) { setGalleryComposerOpen(false); setGalleryCode(""); setGalleryFileName(""); }
  }

  // Anchors the fixed-position "…" menu just under its trigger, clamped to the viewport.
  function anchorMenu(trigger: HTMLElement) {
    const rect = trigger.getBoundingClientRect();
    return {
      top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 300)),
      right: Math.max(8, window.innerWidth - rect.right),
    };
  }

  async function openTransfer(kind: "column" | "card", id: string, name: string) {
    if (!data?.isAdmin) return;
    setMenuCard(null);
    setMenuColumn(null);
    setTransferTarget({ kind, id, name });
    setTransferBoardId("");
    setTransferMode("copy");
    setTransferBoards(null);
    setError("");
    try {
      const response = await fetch("/api/boards", { cache: "no-store" });
      if (!response.ok) throw new Error("보드 목록을 불러오지 못했습니다.");
      const boards = (await response.json()) as BoardSummary[];
      // Only boards of the same kind, and never the one we are standing on.
      setTransferBoards(boards.filter((board) => board.id !== data.board.id && board.type === data.board.type));
    } catch {
      setTransferBoards([]);
      setError("보드 목록을 불러오지 못했습니다.");
    }
  }

  async function runTransfer() {
    if (!data || !transferTarget || !transferBoardId || busy) return;
    const endpoint = transferTarget.kind === "column"
      ? `/api/columns/${transferTarget.id}/transfer`
      : `/api/cards/${transferTarget.id}/transfer`;
    const noun = transferTarget.kind === "column" ? "목록" : "작품";
    const verb = transferMode === "move" ? "이동" : "복사";
    setBusy(true);
    const done = await runAction(`${noun}을 ${verb}하는 중…`, `${noun}을 ${verb}했습니다.`, `${noun}을 ${verb}하지 못했습니다.`, async () => {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetBoardId: transferBoardId, mode: transferMode }),
      });
      if (!response.ok) throw new Error(await responseError(response, `${noun}을 ${verb}하지 못했습니다.`));
      await load(true).catch(() => undefined);
      return true;
    });
    setBusy(false);
    if (done) setTransferTarget(null);
  }

  async function copyCardText(card: BoardCard) {
    // Copy the body only; fall back to the title if there is no body.
    const text = card.content?.trim() || card.title?.trim() || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.show("카드 본문을 복사했습니다.", "success");
    } catch {
      toast.show("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.", "error", 4500);
    }
  }

  function openGalleryComposer() {
    setGalleryTab("code");
    setGalleryCode("");
    setGalleryFileName("");
    setError("");
    setGalleryComposerOpen(true);
  }

  // Switching to the file tab should feel like "upload a file", so open the picker for them.
  // The input only exists after the tab renders, so the effect below fires it.
  function chooseGalleryFile(target: "create" | "edit") {
    pendingPickerRef.current = target;
    if (target === "create") setGalleryTab("file"); else setGalleryEditTab("file");
  }

  async function openGalleryEdit(card: BoardCard) {
    setGalleryEdit(card);
    setGalleryEditTab("code");
    setGalleryEditFileName("");
    setGalleryEditCode("");
    setError("");
    try {
      const response = await fetch(`/api/embed/${card.id}`, { cache: "no-store" });
      if (response.ok) setGalleryEditCode(await response.text());
    } catch {
      // best-effort prefill
    }
  }

  async function saveGalleryEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !galleryEdit) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!title) { setError("작품 제목을 입력해 주세요."); return; }
    let file: File | null = null;
    if (galleryEditTab === "code") {
      const code = galleryEditCode.trim();
      if (!code) { setError("HTML 코드를 입력해 주세요."); return; }
      file = new globalThis.File([code], "index.html", { type: "text/html" });
    } else {
      const uploaded = form.get("htmlfile");
      file = uploaded instanceof globalThis.File && uploaded.size > 0 ? uploaded : null; // optional: keep existing if none
    }
    if (file && file.size > 5 * 1024 * 1024) { setError("작품은 최대 5MB까지 올릴 수 있습니다."); return; }
    setBusy(true);
    setError("");
    const upload = new FormData();
    upload.append("title", title);
    upload.append("content", description);
    if (file) upload.append("file", file);
    const done = await runAction("작품을 수정하는 중…", "작품을 수정했습니다.", "작품을 수정하지 못했습니다.", async () => {
      const response = await fetch(`/api/cards/${galleryEdit.id}/gallery`, { method: "PATCH", body: upload });
      if (!response.ok) throw new Error(await responseError(response, `작품을 수정하지 못했습니다. (${response.status})`));
      await load(true).catch(() => undefined);
      return true;
    });
    setBusy(false);
    if (done) { setGalleryEdit(null); setGalleryEditCode(""); setGalleryEditFileName(""); }
  }

  async function toggleLike(card: BoardCard) {
    if (!data) return;
    const liked = !card.likedByMe;
    setData((current) => current ? {
      ...current,
      cards: current.cards.map((item) => item.id === card.id
        ? { ...item, likedByMe: liked, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) }
        : item),
    } : current);
    try {
      const response = await fetch(`/api/cards/${card.id}/reactions`, { method: "POST" });
      if (!response.ok) throw new Error("reaction failed");
      const result = await response.json() as { liked: boolean; count: number };
      setData((current) => current ? {
        ...current,
        cards: current.cards.map((item) => item.id === card.id ? { ...item, likedByMe: result.liked, likeCount: result.count } : item),
      } : current);
    } catch {
      await load(true);
    }
  }

  function toggleComments(cardId: string) {
    // Decide first, then set, then fetch. Firing the request from inside the updater would make it
    // impure, and React is entitled to call an updater more than once.
    const opening = !commentsOpen[cardId];
    setCommentsOpen((current) => ({ ...current, [cardId]: !current[cardId] }));
    if (opening) void loadComments(cardId);
  }

  async function addComment(cardId: string) {
    const content = commentDraft[cardId]?.trim();
    if (!content) return;
    const added = await runAction("댓글을 등록하는 중…", "댓글을 등록했습니다.", "댓글을 남기지 못했습니다.", async () => {
      const response = await fetch(`/api/cards/${cardId}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error(await responseError(response, "댓글을 남기지 못했습니다."));
      // The board payload refreshes the count; the list itself is fetched per card now.
      await Promise.all([load(true), loadComments(cardId)]);
      return true;
    });
    if (added) setCommentDraft((current) => ({ ...current, [cardId]: "" }));
  }

  async function sendChat(content: string) {
    if (!data) return false;
    const sent = await runAction("질문을 보내는 중…", "Q&A에 질문을 남겼습니다.", "질문을 보내지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error(await responseError(response, "질문을 보내지 못했습니다."));
      await load(true);
      return true;
    });
    return Boolean(sent);
  }

  async function hideChatMessage(id: string, hidden: boolean) {
    await runAction(
      hidden ? "메시지를 가리는 중…" : "메시지를 다시 표시하는 중…",
      hidden ? "메시지를 가렸습니다." : "메시지를 다시 표시했습니다.",
      "메시지를 변경하지 못했습니다.",
      async () => {
        const response = await fetch(`/api/chat/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden }),
        });
        if (!response.ok) throw new Error(await responseError(response, "메시지를 변경하지 못했습니다."));
        await load(true);
      },
    );
  }

  async function deleteChatMessage(id: string) {
    const ok = await dialog.confirm({
      title: "메시지를 삭제할까요?",
      message: "이 채팅 메시지를 영구적으로 삭제합니다. 되돌릴 수 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    await runAction("메시지를 삭제하는 중…", "메시지를 삭제했습니다.", "메시지를 삭제하지 못했습니다.", async () => {
      const response = await fetch(`/api/chat/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "메시지를 삭제하지 못했습니다."));
      await load(true);
    });
  }

  async function deleteCard(card: BoardCard) {
    setMenuCard(null);
    const ok = await dialog.confirm({
      title: "카드를 삭제할까요?",
      message: `‘${card.title || "제목 없는 카드"}’ 카드가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    const deleted = await runAction("카드를 삭제하는 중…", "카드를 삭제했습니다.", "카드를 삭제하지 못했습니다.", async () => {
      const response = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "카드를 삭제하지 못했습니다."));
      await load(true);
      return true;
    });
    if (deleted) setMenuCard(null);
  }

  async function moveCard(event: DragEvent, columnId: string) {
    event.preventDefault();
    if (!dragging || !data?.canWrite) return;
    const cardId = dragging;
    const previousCards = data.cards;
    setData({ ...data, cards: data.cards.map((card) => card.id === dragging ? { ...card, columnId } : card) });
    setDragging(null);
    const moved = await runAction("카드를 이동하는 중…", "카드를 새 목록으로 이동했습니다.", "카드를 이동하지 못했습니다.", async () => {
      const response = await fetch(`/api/cards/${cardId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ columnId }),
      });
      if (!response.ok) throw new Error(await responseError(response, "카드를 이동하지 못했습니다."));
      return true;
    });
    if (!moved) {
      setData((current) => current ? { ...current, cards: previousCards } : current);
      await load(true);
    }
  }

  // Drop a card onto another card → reorder within the list (above/below by pointer position).
  async function reorderCard(event: DragEvent<HTMLElement>, targetCardId: string) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = dragging;
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
    setDragging(null);
    setCardDropTarget(null);
    if (!sourceId || !data?.canWrite || sourceId === targetCardId) return;
    await runAction("카드 순서를 바꾸는 중…", "카드 순서를 변경했습니다.", "카드 순서를 변경하지 못했습니다.", async () => {
      const response = await fetch(`/api/cards/${sourceId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetCardId, placement }),
      });
      if (!response.ok) throw new Error(await responseError(response, "카드 순서를 변경하지 못했습니다."));
      await load(true);
      return true;
    });
  }

  function columnPlacement(event: DragEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height / 2 ? "after" as const : "before" as const;
  }

  // Trello-style drag-to-scroll: dragging the empty board background pans the board.
  function startPan(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".trello-list, button, a, input, textarea, select")) return;
    const el = event.currentTarget;
    panRef.current = { active: true, startX: event.clientX, startY: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(event.pointerId);
    el.classList.add("panning");
  }
  function movePan(event: ReactPointerEvent<HTMLElement>) {
    if (!panRef.current.active) return;
    event.currentTarget.scrollLeft = panRef.current.left - (event.clientX - panRef.current.startX);
    event.currentTarget.scrollTop = panRef.current.top - (event.clientY - panRef.current.startY);
  }
  function endPan(event: ReactPointerEvent<HTMLElement>) {
    if (!panRef.current.active) return;
    panRef.current.active = false;
    event.currentTarget.classList.remove("panning");
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  }

  function handleColumnDragOver(event: DragEvent<HTMLElement>, columnId: string) {
    if (!draggingColumn || !data?.isAdmin) return;
    event.preventDefault();
    event.stopPropagation();
    setGridColDropTarget(null);
    event.dataTransfer.dropEffect = "move";
    if (draggingColumn === columnId) {
      setColumnDropTarget(null);
      return;
    }
    const placement = columnPlacement(event);
    setColumnDropTarget((current) => current?.id === columnId && current.placement === placement ? current : { id: columnId, placement });
  }

  // Drop a list onto another list → place it directly above/below that list (same vertical column).
  async function reorderColumn(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData("application/x-aistudy-column") || draggingColumn;
    const placement = columnDropTarget?.id === targetId ? columnDropTarget.placement : columnPlacement(event);
    setDraggingColumn(null);
    setColumnDropTarget(null);
    setGridColDropTarget(null);
    if (!sourceId || !data?.isAdmin || sourceId === targetId) return;
    await runAction("목록 위치를 저장하는 중…", "목록 위치를 변경했습니다.", "목록 위치를 변경하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/columns`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sourceId, targetId, placement }),
      });
      if (!response.ok) throw new Error(await responseError(response, "목록 위치를 변경하지 못했습니다."));
      await load(true);
      return true;
    });
  }

  // Drop a list onto a column's empty area → append it to the bottom of that column.
  async function moveColumnToGrid(sourceId: string, gridCol: number) {
    setDraggingColumn(null);
    setColumnDropTarget(null);
    setGridColDropTarget(null);
    if (!sourceId || !data?.isAdmin) return;
    const source = data.columns.find((column) => column.id === sourceId);
    if (source && source.gridCol === gridCol) return;
    await runAction("목록 위치를 저장하는 중…", "목록을 옮겼습니다.", "목록을 옮기지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/columns`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sourceId, gridCol }),
      });
      if (!response.ok) throw new Error(await responseError(response, "목록을 옮기지 못했습니다."));
      await load(true);
      return true;
    });
  }

  async function addColumn(gridCol: number) {
    if (!data?.isAdmin) return;
    const name = await dialog.prompt({
      title: "새 목록 추가",
      label: "목록 이름",
      placeholder: "예: 실습 결과, 질문 모음",
      confirmLabel: "목록 추가",
      maxLength: 60,
    });
    if (!name?.trim()) return;
    await runAction("새 목록을 만드는 중…", "새 목록을 추가했습니다.", "목록을 추가하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/columns`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, gridCol }),
      });
      if (!response.ok) throw new Error(await responseError(response, "목록을 추가하지 못했습니다."));
      await load(true);
    });
  }

  async function updateColumn(columnId: string, changes: { name?: string; color?: ColumnColor }) {
    if (!data?.isAdmin || busy) return;
    setBusy(true);
    setError("");
    try {
      const label = changes.name !== undefined ? "목록 이름" : "목록 색상";
      const updated = await runAction(`${label}을 저장하는 중…`, `${label}을 변경했습니다.`, `${label}을 변경하지 못했습니다.`, async () => {
        const response = await fetch(`/api/boards/${data.board.id}/columns`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: columnId, ...changes }),
        });
        if (!response.ok) throw new Error(await responseError(response, `${label}을 변경하지 못했습니다.`));
        await load(true);
        return true;
      });
      if (updated) setMenuColumn(null);
    } finally {
      setBusy(false);
    }
  }

  async function renameColumn(event: FormEvent<HTMLFormElement>, columnId: string) {
    event.preventDefault();
    const name = columnNameDraft.trim();
    if (!name) return;
    await updateColumn(columnId, { name });
  }

  async function deleteColumn(columnId: string, columnName: string) {
    if (!data?.isAdmin || busy) return;
    if (data.columns.length <= 1) {
      const message = "보드에는 최소 한 개의 목록이 필요합니다.";
      setError(message);
      toast.show(message, "error");
      setMenuColumn(null);
      return;
    }
    if (data.cards.some((card) => card.columnId === columnId)) {
      const message = "목록의 카드를 다른 목록으로 옮긴 후 삭제해 주세요.";
      setError(message);
      toast.show(message, "error");
      setMenuColumn(null);
      return;
    }
    const ok = await dialog.confirm({
      title: "목록을 삭제할까요?",
      message: `‘${columnName}’ 목록을 삭제합니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const deleted = await runAction("목록을 삭제하는 중…", "목록을 삭제했습니다.", "목록을 삭제하지 못했습니다.", async () => {
        const response = await fetch(`/api/boards/${data.board.id}/columns`, {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: columnId }),
        });
        if (!response.ok) throw new Error(await responseError(response, "목록을 삭제하지 못했습니다."));
        await load(true);
        return true;
      });
      if (deleted) setMenuColumn(null);
    } finally {
      setBusy(false);
    }
  }

  async function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.isAdmin) return;
    const form = new FormData(event.currentTarget);
    const updated = await runAction("보드 설정을 저장하는 중…", "보드 설정을 저장했습니다.", "설정을 저장하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"), description: form.get("description"),
          shareMode: form.get("shareMode"), audience: form.get("audience"),
          background: settingsBackground ?? data.board.background,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "설정을 저장하지 못했습니다."));
      await load(true);
      return true;
    });
    if (updated) setPanel(null);
  }

  async function setBoardAccessPassword() {
    if (!data?.isAdmin) return;
    const value = await dialog.prompt({
      title: "입장 비밀번호 설정",
      message: "수강생이 처음 입장할 때 입력하는 값입니다. 설정 화면에 그대로 표시되니 강사 본인 비밀번호는 쓰지 마세요.",
      label: "입장 비밀번호",
      placeholder: data.board.requirePassword ? "새 입장 비밀번호" : "예: KMPT47",
      confirmLabel: "저장",
      required: false,
      maxLength: 100,
    });
    if (value === null) return;
    await runAction("비밀번호를 저장하는 중…", "입장 비밀번호를 변경했습니다.", "비밀번호를 변경하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessPassword: value }),
      });
      if (!response.ok) throw new Error(await responseError(response, "비밀번호를 변경하지 못했습니다."));
      await load(true);
    });
  }

  async function saveFinal() {
    if (!data?.isAdmin) return;
    const label = await dialog.prompt({
      title: "최종본 저장",
      message: "현재 보드 상태를 이름 붙여 최종본으로 보관합니다. 언제든 이 시점으로 복원할 수 있습니다.",
      label: "최종본 이름",
      defaultValue: `최종본 ${new Date().toLocaleDateString("ko-KR")}`,
      confirmLabel: "최종본 저장",
      maxLength: 80,
    });
    if (label === null) return;
    await runAction("최종본을 저장하는 중…", "현재 상태를 최종본으로 저장했습니다.", "최종본을 저장하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveFinal", label }),
      });
      if (!response.ok) throw new Error(await responseError(response, "최종본을 저장하지 못했습니다."));
      await load(true);
    });
  }

  async function restore(revision: RevisionEntry) {
    if (!data?.isAdmin) return;
    const ok = await dialog.confirm({
      title: "이 버전으로 복원할까요?",
      message: `‘${revision.label}’ 상태로 보드를 되돌립니다. 지금 상태도 자동 이력에 남으니 안심하세요.`,
      confirmLabel: "복원",
    });
    if (!ok) return;
    await runAction("선택한 버전으로 복원하는 중…", `‘${revision.label}’ 버전으로 복원했습니다.`, "버전을 복원하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${data.board.id}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", revisionId: revision.id }),
      });
      if (!response.ok) throw new Error(await responseError(response, "버전을 복원하지 못했습니다."));
      await load(true);
    });
  }

  if (loading && !data && !joinRequired && !notFound) return <main className="center-screen"><div className="spinner" /><p>강의 보드를 펼치고 있습니다.</p></main>;
  if (notFound) return <main className="center-screen"><span className="empty-symbol"><LockKeyhole size={30} /></span><h1>보드를 찾을 수 없습니다</h1><p>공유 링크가 변경되었거나 보드가 삭제되었습니다.</p><button className="secondary-button" onClick={() => router.push("/")}><ArrowLeft size={16} /> 홈으로</button></main>;

  if (membersOnly) {
    return (
      <main className="share-gate">
        <ThemeToggle className="theme-fab" />
        <section className="share-gate-card">
          <Brand />
          <span className="gate-icon"><Shield size={24} /></span>
          <h1>회원 전용 보드</h1>
          <p>이 보드는 강사 회원만 입장할 수 있습니다. 강사 계정으로 로그인한 뒤 다시 시도해 주세요.</p>
          <button className="primary-button" onClick={() => router.push("/")}>강사 로그인으로 이동<ArrowLeft className="arrow-forward" size={18} /></button>
        </section>
      </main>
    );
  }

  if (joinRequired) {
    return (
      <main className="share-gate">
        <ThemeToggle className="theme-fab" />
        <section className="share-gate-card profile-gate-card">
          <Brand />
          <span className="kicker">WELCOME TO AI STUDY</span>
          <h1>내 프로필 만들기</h1>
          <p>처음 한 번만 이모티콘과 닉네임을 선택해 주세요.<br />이 브라우저에서는 다음부터 바로 입장합니다.</p>
          {passwordRequired && (
            <label className="gate-password"><span><Lock size={13} /> 보드 비밀번호</span><input type="password" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="강사에게 받은 비밀번호를 입력하세요" autoComplete="off" /></label>
          )}
          <ProfileForm busy={busy} submitLabel="프로필 저장하고 입장" onSubmit={join} />
          {error && <p className="form-error">{error}</p>}
          <small><ShieldCheck size={14} /> 프로필은 익명 기기 ID와 함께 안전하게 저장됩니다.</small>
        </section>
      </main>
    );
  }

  if (!data) return null;
  const shareUrl = data.board.shareCode ? `${window.location.origin}/wz/${data.board.shareCode}` : "";
  const canManageCard = (card: BoardCard) => data.isAdmin || (!!data.participant && card.authorId === data.participant.id);
  const isGallery = data.board.type === "gallery";
  const galleryItems = isGallery ? [...data.cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const previewCard = galleryPreview ? data.cards.find((c) => c.id === galleryPreview.id) ?? galleryPreview : null;
  const detailCardLive = detailCard ? data.cards.find((c) => c.id === detailCard.id) ?? detailCard : null;

  // Manual layout: each list has a grid column (gridCol) and stacks vertically by position.
  // Admins get one extra empty trailing column to start a new column in.
  const maxGridCol = data.columns.reduce((max, column) => Math.max(max, column.gridCol), -1);
  const gridColCount = Math.max(1, maxGridCol + 1 + (data.isAdmin ? 1 : 0));
  const gridColumns: (typeof data.columns)[] = Array.from({ length: gridColCount }, () => []);
  data.columns.forEach((column) => gridColumns[Math.max(0, Math.min(gridColCount - 1, column.gridCol))].push(column));

  return (
    <main className="trello-shell" data-board-bg={data.board.background}>
      {/* One bar for everything — the board title used to repeat in a hero section below. */}
      <header className="board-topbar">
        <Brand compact />
        <div className="board-topbar-title" title={data.board.description || undefined}>
          <strong>{data.board.title}</strong>
          <span>{data.isAdmin ? "강사 모드" : "수강생 모드"} · {data.board.shareMode === "write" ? "읽기·쓰기" : "읽기 전용"}</span>
        </div>
        <ActiveViewers viewers={data.activeViewers} />
        <div className="board-topbar-actions">
          {isGallery
            ? galleryItems.length > 0 && <button onClick={() => setGalleryPreview(galleryItems[0])} title="첫 작품부터 크게 보기"><MonitorPlay size={17} /><span>발표</span></button>
            : slideCards.length > 0 && <button onClick={() => { setSlideIndex(0); setSlideshow(true); }} title="발표 모드"><MonitorPlay size={17} /><span>발표</span></button>}
          {data.isAdmin && <>
            <button onClick={() => void copyShareLink()} title="공유 링크 복사"><Copy size={17} /><span>링크</span></button>
            <button onClick={() => setQrOpen(true)} disabled={!shareUrl} title="공유 QR 코드"><QrCode size={17} /><span>QR</span></button>
            <button onClick={() => void saveFinal()} title="최종본 저장"><Save size={17} /><span>최종본</span></button>
          </>}
          <ThemeToggle className="" />
          <button className="icon-only" onClick={() => void refreshBoard()} aria-label="새로고침" title="새로고침"><RefreshCw size={17} /></button>
          {data.isAdmin && <button className="icon-only" onClick={() => setPanel("activity")} aria-label="활동 기록" title="활동 기록"><Activity size={17} /></button>}
          {data.isAdmin && <button className="icon-only" onClick={() => setPanel("versions")} aria-label="버전 관리" title="버전 관리"><History size={17} /></button>}
          {data.isAdmin && <button className="icon-only" onClick={() => { setSettingsBackground(data.board.background); setPanel("settings"); }} aria-label="보드 설정" title="보드 설정"><Settings2 size={17} /></button>}
          {data.isAdmin && <button className="icon-only" onClick={() => router.push("/")} aria-label="대시보드로" title="대시보드로"><ArrowLeft size={17} /></button>}
          {!data.isAdmin && data.participant && (
            <button className="my-profile-button" onClick={() => setProfileOpen(true)} title="내 프로필 변경">
              <span>{data.participant.emoji}</span><b>{data.participant.nickname}</b>
            </button>
          )}
        </div>
      </header>

      {error && <div className="floating-error">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
      {!data.canWrite && <div className="readonly-banner"><Eye size={16} /><span>보드 카드는 읽기 전용입니다. 오른쪽 Q&amp;A 채팅에는 질문을 남길 수 있습니다.</span></div>}

      <div className="board-workspace">
        {isGallery ? (
        <section className="gallery-board">
          {data.canWrite && (
            <div className="gallery-head">
              <button className="primary-button compact" onClick={openGalleryComposer}><Plus size={18} /> 작품 올리기</button>
            </div>
          )}
          {galleryItems.length === 0 ? (
            <div className="gallery-empty"><span><Sparkles size={30} /></span><b>아직 올라온 작품이 없어요</b><p>{data.canWrite ? "첫 작품을 올려 자랑해 보세요." : "곧 멋진 작품들이 올라올 거예요."}</p></div>
          ) : (
            <div className="gallery-grid">
              {galleryItems.map((card) => {
                const isNew = nowTs - new Date(card.createdAt).getTime() < 86400000;
                const isHot = card.likeCount >= 5;
                return (
                  <article className="gallery-item" key={card.id}>
                    <button type="button" className="gallery-thumb" onClick={() => setGalleryPreview(card)} aria-label={`${card.title || "작품"} 크게 보기`}>
                      <iframe src={`/api/embed/${card.id}?v=${encodeURIComponent(card.updatedAt)}`} title={card.title || "작품 미리보기"} sandbox="allow-scripts allow-popups" scrolling="no" tabIndex={-1} loading="lazy" />
                      <span className="gallery-thumb-overlay"><Maximize2 size={16} /> 크게 보기</span>
                      <div className="gallery-badges">{isHot && <span className="badge badge-hot">HOT</span>}{isNew && <span className="badge badge-new">NEW</span>}</div>
                    </button>
                    <div className="gallery-body">
                      <div className="gallery-author"><span>{card.authorEmoji}</span><b>{card.authorName}</b>{card.actorType === "teacher" && <em>강사</em>}</div>
                      {card.title && <h3>{card.title}</h3>}
                      {card.content && <p className="gallery-desc">{card.content}</p>}
                      <div className="gallery-footer">
                        <button className={`like-button ${card.likedByMe ? "liked" : ""}`} aria-pressed={card.likedByMe} aria-label="좋아요" onClick={() => void toggleLike(card)}><Heart size={15} fill={card.likedByMe ? "currentColor" : "none"} /> {card.likeCount > 0 ? card.likeCount : "좋아요"}</button>
                        <button onClick={() => toggleComments(card.id)}><MessageSquare size={15} /> {card.commentCount || "댓글"}</button>
                        <button onClick={() => setGalleryShare(card)}><QrCode size={15} /> 공유</button>
                        {canManageCard(card) && <div className="card-menu"><button aria-label="작품 메뉴" aria-expanded={menuCard === card.id} onClick={(event) => { const opening = menuCard !== card.id; setMenuPos(opening ? anchorMenu(event.currentTarget) : null); setMenuCard(opening ? card.id : null); }}><MoreHorizontal size={16} /></button>{menuCard === card.id && <div className="card-menu-pop" role="menu" style={menuPos ?? undefined}><button role="menuitem" onClick={() => { setMenuCard(null); void openGalleryEdit(card); }}><Pencil size={15} /> 작품 수정</button>{data.isAdmin && <button role="menuitem" onClick={() => void openTransfer("card", card.id, card.title || "작품")}><FolderInput size={15} /> 다른 보드로 이동·복사</button>}<div className="card-menu-sep" /><button className="danger" role="menuitem" onClick={() => void deleteCard(card)}><Trash2 size={15} /> 작품 삭제</button></div>}</div>}
                      </div>
                      {commentsOpen[card.id] && <div className="comments-area">{(commentsByCard[card.id] ?? []).map((comment) => <div className="comment-row" key={comment.id}><span>{comment.authorEmoji}</span><div><b>{comment.authorName}</b><p>{comment.content}</p></div></div>)}{commentsByCard[card.id] === undefined ? <p className="no-comment">댓글을 불러오는 중…</p> : commentsByCard[card.id]!.length === 0 && <p className="no-comment">아직 댓글이 없습니다.</p>}{data.canWrite && <div className="comment-compose"><input value={commentDraft[card.id] ?? ""} onChange={(event) => setCommentDraft((current) => ({ ...current, [card.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void addComment(card.id); } }} maxLength={500} placeholder="댓글 쓰기" /><button onClick={() => void addComment(card.id)}><Send size={14} /></button></div>}</div>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {data.canWrite && galleryItems.length > 0 && (
            <div className="gallery-head gallery-foot">
              <button className="primary-button compact" onClick={openGalleryComposer}><Plus size={18} /> 작품 올리기</button>
            </div>
          )}
        </section>
        ) : (
        <section className="trello-board" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
          <div className="masonry">
          {gridColumns.map((colLists, gridIndex) => {
            if (!data.isAdmin && colLists.length === 0) return null;
            return (
            <div
              className={`masonry-col ${gridColDropTarget === gridIndex ? "col-drop" : ""}`}
              key={gridIndex}
              onDragOver={(event) => { if (draggingColumn && data.isAdmin) { event.preventDefault(); setGridColDropTarget(gridIndex); } }}
              onDragLeave={() => setGridColDropTarget((current) => (current === gridIndex ? null : current))}
              onDrop={(event) => { if (draggingColumn && data.isAdmin) { event.preventDefault(); void moveColumnToGrid(draggingColumn, gridIndex); } }}
            >
          {colLists.map((column) => (
            <article
              className={`trello-list list-theme-${column.color} ${draggingColumn === column.id ? "list-dragging" : ""} ${columnDropTarget?.id === column.id ? `list-drop-${columnDropTarget.placement}` : ""} ${fileDropColumn === column.id ? "list-file-over" : ""}`}
              key={column.id}
              draggable={data.isAdmin}
              title={data.isAdmin ? "제목을 드래그해 다른 목록 위/아래나 다른 열로 이동" : undefined}
              onDragStart={(event) => {
                if (!data.isAdmin || (event.target as HTMLElement).closest("button, input, textarea, select, a, .trello-card")) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-aistudy-column", column.id);
                setDraggingColumn(column.id);
                setMenuColumn(null);
              }}
              onDragEnd={() => { setDraggingColumn(null); setColumnDropTarget(null); setGridColDropTarget(null); }}
              onDragOver={(event) => {
                if (data.canWrite && Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (fileDropColumn !== column.id) setFileDropColumn(column.id); return; }
                if (draggingColumn) handleColumnDragOver(event, column.id); else if (data.canWrite) event.preventDefault();
              }}
              onDragLeave={(event) => { if (fileDropColumn === column.id && !event.currentTarget.contains(event.relatedTarget as Node)) setFileDropColumn(null); }}
              onDrop={(event) => {
                if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.stopPropagation(); setFileDropColumn(null); void handleFileDrop(column.id, Array.from(event.dataTransfer.files)); return; }
                if (draggingColumn) void reorderColumn(event, column.id); else void moveCard(event, column.id);
              }}
            >
              <header>
                <div className="list-heading">
                  {data.isAdmin && <GripVertical className="list-drag-handle" size={17} aria-hidden="true" />}
                  <span className={`list-dot color-${column.color}`} /><h2>{column.name}</h2><small>{grouped.get(column.id)?.length ?? 0}</small>
                </div>
                {data.isAdmin && (
                  <div className="list-menu">
                    <button
                      type="button"
                      aria-label={`${column.name} 목록 메뉴`}
                      aria-expanded={menuColumn === column.id}
                      onClick={() => {
                        const opening = menuColumn !== column.id;
                        setMenuColumn(opening ? column.id : null);
                        setColumnNameDraft(opening ? column.name : "");
                      }}
                    ><MoreHorizontal size={18} /></button>
                    {menuColumn === column.id && (
                      <div className="list-menu-pop" role="dialog" aria-label={`${column.name} 목록 설정`}>
                        <form className="list-rename-form" onSubmit={(event) => void renameColumn(event, column.id)}>
                          <label htmlFor={`column-name-${column.id}`}>목록 이름</label>
                          <div><input id={`column-name-${column.id}`} value={columnNameDraft} onChange={(event) => setColumnNameDraft(event.target.value)} maxLength={60} autoFocus /><button disabled={busy || !columnNameDraft.trim()} aria-label="목록 이름 저장"><Check size={15} /></button></div>
                        </form>
                        <div className="list-color-section"><span><Palette size={14} /> 목록 색상</span><div>{COLUMN_COLORS.map((item) => <button type="button" className={`column-color-option color-${item.value} ${column.color === item.value ? "selected" : ""}`} aria-label={`${item.label}으로 변경`} title={item.label} disabled={busy} onClick={() => void updateColumn(column.id, { color: item.value })} key={item.value}>{column.color === item.value && <Check size={12} />}</button>)}</div></div>
                        <p className="list-drag-help"><GripVertical size={14} /> 목록 제목을 드래그해 순서를 바꿀 수 있습니다.</p>
                        <button type="button" className="list-transfer-button" onClick={() => void openTransfer("column", column.id, column.name)}><FolderInput size={15} /> 다른 보드로 이동·복사</button>
                        <button type="button" className="delete-list-button" disabled={busy} onClick={() => void deleteColumn(column.id, column.name)}><Trash2 size={15} /> 목록 삭제</button>
                      </div>
                    )}
                  </div>
                )}
              </header>
              {/* Top add button mirrors the one at the bottom so long lists stay reachable. */}
              {data.canWrite && (grouped.get(column.id)?.length ?? 0) > 0 && (
                <button className="add-card-button add-card-top" onClick={() => { setSelectedFileName(""); setComposerColumn(column.id); }}><Plus size={17} /> 카드 추가</button>
              )}
              <div className="trello-cards">
                {(grouped.get(column.id) ?? []).map((card) => (
                  <article
                    className={`trello-card ${dragging === card.id ? "dragging" : ""} ${cardDropTarget?.id === card.id ? `card-drop-${cardDropTarget.placement}` : ""}`}
                    key={card.id}
                    draggable={data.canWrite}
                    onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-aistudy-card", card.id); setDragging(card.id); }}
                    onDragEnd={() => { setDragging(null); setCardDropTarget(null); }}
                    onDragOver={(event) => {
                      if (!dragging || dragging === card.id || !data.canWrite) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      const placement = event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
                      setCardDropTarget((current) => current?.id === card.id && current.placement === placement ? current : { id: card.id, placement });
                    }}
                    onDrop={(event) => { if (dragging) void reorderCard(event, card.id); }}
                  >
                    <div className="card-author"><span className={card.actorType === "teacher" ? "teacher-avatar" : ""}>{card.authorEmoji}</span><div><b>{card.authorName}{card.actorType === "teacher" && <em>강사</em>}</b><small>{formatTime(card.createdAt)}</small></div>{data.canWrite && (
                      <div className="card-menu">
                        <button aria-label="카드 메뉴" aria-expanded={menuCard === card.id} onClick={(event) => { const opening = menuCard !== card.id; setMenuPos(opening ? anchorMenu(event.currentTarget) : null); setMenuCard(opening ? card.id : null); setMoveMenuCard(null); }}><MoreHorizontal size={17} /></button>
                        {menuCard === card.id && (
                          <div className="card-menu-pop" role="menu" style={menuPos ?? undefined}>
                            {canManageCard(card) && <button role="menuitem" onClick={() => { setEditCard(card); setMenuCard(null); }}><Pencil size={15} /> 카드 수정</button>}
                            {data.columns.length > 1 && (moveMenuCard === card.id ? (
                              <>
                                <div className="card-menu-label">이동할 목록</div>
                                {data.columns.filter((item) => item.id !== card.columnId).map((item) => (
                                  <button role="menuitem" key={item.id} onClick={() => void moveCardToColumn(card, item.id)}><span className={`list-dot color-${item.color}`} /> {item.name}</button>
                                ))}
                              </>
                            ) : (
                              <button role="menuitem" onClick={() => setMoveMenuCard(card.id)}><ArrowRightLeft size={15} /> 다른 목록으로 이동</button>
                            ))}
                            {canManageCard(card) && <><div className="card-menu-sep" /><button role="menuitem" className="danger" onClick={() => void deleteCard(card)}><Trash2 size={15} /> 카드 삭제</button></>}
                          </div>
                        )}
                      </div>
                    )}</div>
                    {card.title && <h3 className="card-openable" onClick={() => { setDetailCard(card); void loadComments(card.id); }}>{card.title}</h3>}
                    {card.content && <div className="card-content card-openable" onClick={(event) => { if (!(event.target as HTMLElement).closest("a")) { setDetailCard(card); void loadComments(card.id); } }} dangerouslySetInnerHTML={{ __html: renderMarkdown(card.content) }} />}
                    {card.fileId && card.fileType?.startsWith("image/") && card.fileType !== "image/svg+xml" && <button type="button" className="card-image" onClick={() => setLightbox(`/api/files/${card.fileId}`)} aria-label="이미지 크게 보기"><Image src={`/api/files/${card.fileId}`} width={520} height={320} unoptimized alt={card.fileName ?? "첨부 이미지"} /></button>}
                    {card.fileId && (!card.fileType?.startsWith("image/") || card.fileType === "image/svg+xml") && <a href={`/api/files/${card.fileId}`} target="_blank" className="card-file"><File size={21} /><span><b>{card.fileName}</b><small>{fileSize(card.fileSize)}</small></span><Download size={16} /></a>}
                    {card.linkUrl && <a href={card.linkUrl} target="_blank" rel="noreferrer" className="card-link"><Link2 size={15} /><span>{new URL(card.linkUrl).hostname}</span><ExternalLink size={13} /></a>}
                    <div className="card-footer"><button className={`like-button ${card.likedByMe ? "liked" : ""}`} aria-pressed={card.likedByMe} aria-label="좋아요" onClick={() => void toggleLike(card)}><Heart size={15} fill={card.likedByMe ? "currentColor" : "none"} /> {card.likeCount > 0 ? card.likeCount : "좋아요"}</button><button onClick={() => toggleComments(card.id)}><MessageSquare size={15} /> {card.commentCount ? card.commentCount : "댓글"}</button>{(card.title || card.content) && <button aria-label="본문 복사" onClick={() => void copyCardText(card)}><Copy size={14} /> 복사</button>}{card.fileId && <span><Paperclip size={14} /> 첨부</span>}</div>
                    {commentsOpen[card.id] && <div className="comments-area">{(commentsByCard[card.id] ?? []).map((comment) => <div className="comment-row" key={comment.id}><span>{comment.authorEmoji}</span><div><b>{comment.authorName}</b><p>{comment.content}</p></div></div>)}{commentsByCard[card.id] === undefined ? <p className="no-comment">댓글을 불러오는 중…</p> : commentsByCard[card.id]!.length === 0 && <p className="no-comment">아직 댓글이 없습니다.</p>}{data.canWrite && <div className="comment-compose"><input value={commentDraft[card.id] ?? ""} onChange={(event) => setCommentDraft((current) => ({ ...current, [card.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void addComment(card.id); } }} maxLength={500} placeholder="댓글 쓰기" /><button onClick={() => void addComment(card.id)}><Send size={14} /></button></div>}</div>}
                  </article>
                ))}
              </div>
              {data.canWrite && <button className="add-card-button" onClick={() => { setSelectedFileName(""); setComposerColumn(column.id); }}><Plus size={17} /> 카드 추가</button>}
            </article>
          ))}
          {data.isAdmin && <button className="add-list-button" onClick={() => void addColumn(gridIndex)}><Plus size={17} /> {colLists.length === 0 ? "여기에 새 열" : "목록 추가"}</button>}
            </div>
            );
          })}
          </div>
        </section>
        )}
        {!isGallery && <BoardChat messages={data.chatMessages} onSend={sendChat} canModerate={data.isAdmin} onHide={hideChatMessage} onDelete={deleteChatMessage} />}
      </div>

      {composerColumn && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setComposerColumn(null); setSelectedFileName(""); } }}>
          <form className="modal-card card-composer" role="dialog" aria-modal="true" aria-labelledby="card-composer-title" onSubmit={createCard}>
            <button type="button" className="modal-close" aria-label="카드 추가 창 닫기" onClick={() => { setComposerColumn(null); setSelectedFileName(""); }}><X size={18} /></button>
            <span className="kicker">ADD CARD</span><h2 id="card-composer-title">새 카드</h2><p>텍스트, 이미지, 일반 파일과 링크를 함께 올릴 수 있습니다.</p>
            <input type="hidden" name="columnId" value={composerColumn} />
            <label><span>제목</span><input name="title" maxLength={120} placeholder="핵심 내용을 한 줄로 적어 주세요." autoFocus /></label>
            <div className="field"><label htmlFor="card-content-new">내용</label><MarkdownEditor id="card-content-new" name="content" placeholder="질문, 아이디어 또는 실습 결과를 적어 주세요." /></div>
            <label><span>관련 링크</span><input name="linkUrl" type="url" placeholder="https://" /></label>
            <label className="upload-field"><input name="file" type="file" onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? "")} /><span><Paperclip size={18} /><span className="upload-name">{selectedFileName || "파일 선택"}</span><small>{data.isAdmin ? "강사 용량 제한 없음" : "최대 10MB"}</small></span></label>
            <button className="primary-button" disabled={busy}>{busy ? "올리는 중…" : <><Check size={17} /> 카드 추가</>}</button>
          </form>
        </div>
      )}

      {editCard && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditCard(null); }}>
          <form className="modal-card card-composer" role="dialog" aria-modal="true" aria-labelledby="card-edit-title" onSubmit={saveCardEdit}>
            <button type="button" className="modal-close" aria-label="카드 수정 창 닫기" onClick={() => setEditCard(null)}><X size={18} /></button>
            <span className="kicker">EDIT CARD</span><h2 id="card-edit-title">카드 수정</h2>
            <label><span>제목</span><input name="title" maxLength={120} defaultValue={editCard.title} placeholder="핵심 내용을 한 줄로 적어 주세요." autoFocus /></label>
            <div className="field"><label htmlFor="card-content-edit">내용</label><MarkdownEditor id="card-content-edit" name="content" defaultValue={editCard.content} placeholder="질문, 아이디어 또는 실습 결과를 적어 주세요." /></div>
            <label><span>관련 링크</span><input name="linkUrl" type="url" defaultValue={editCard.linkUrl ?? ""} placeholder="https://" /></label>
            {editCard.fileName && <p className="card-edit-note"><Paperclip size={15} /> 첨부 파일 ‘{editCard.fileName}’은 그대로 유지됩니다.</p>}
            <button className="primary-button" disabled={busy}>{busy ? "저장 중…" : <><Check size={17} /> 변경 사항 저장</>}</button>
          </form>
        </div>
      )}

      {profileOpen && data.participant && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setProfileOpen(false)}>
          <div className="modal-card profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
            <button type="button" className="modal-close" aria-label="프로필 변경 창 닫기" onClick={() => setProfileOpen(false)}><X size={18} /></button>
            <span className="kicker">MY PROFILE</span><h2 id="profile-modal-title">프로필 변경</h2><p>변경한 닉네임과 이모티콘은 작성한 카드, 댓글과 채팅에도 바로 반영됩니다.</p>
            <ProfileForm initialNickname={data.participant.nickname} initialEmoji={data.participant.emoji} busy={busy} submitLabel="프로필 저장" onSubmit={updateProfile} />
          </div>
        </div>
      )}

      {slideshow && slideCards.length > 0 && (() => {
        const card = slideCards[Math.min(slideIndex, slideCards.length - 1)];
        const index = Math.min(slideIndex, slideCards.length - 1);
        return (
          <div className="slideshow" role="dialog" aria-modal="true" aria-label="발표 모드">
            <button type="button" className="slideshow-close" aria-label="발표 종료" onClick={() => setSlideshow(false)}><X size={22} /></button>
            <button type="button" className="slide-nav" aria-label="이전 카드" disabled={index === 0} onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}><ChevronLeft size={30} /></button>
            <div className="slide-card">
              <div className="slide-author"><span>{card.authorEmoji}</span><b>{card.authorName}</b>{card.actorType === "teacher" && <em>강사</em>}</div>
              {card.title && <h2>{card.title}</h2>}
              {card.fileId && card.fileType?.startsWith("image/") && card.fileType !== "image/svg+xml" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="slide-image" src={`/api/files/${card.fileId}`} alt={card.fileName ?? "첨부 이미지"} />
              )}
              {card.content && <div className="slide-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.content) }} />}
              {card.linkUrl && <a className="slide-link" href={card.linkUrl} target="_blank" rel="noreferrer"><Link2 size={16} /> {new URL(card.linkUrl).hostname}</a>}
              <div className="slide-meta"><span><Heart size={16} /> {card.likeCount}</span><span><MessageSquare size={16} /> {card.commentCount}</span></div>
            </div>
            <button type="button" className="slide-nav" aria-label="다음 카드" disabled={index >= slideCards.length - 1} onClick={() => setSlideIndex((i) => Math.min(slideCards.length - 1, i + 1))}><ChevronRight size={30} /></button>
            <div className="slide-counter">{index + 1} / {slideCards.length}</div>
          </div>
        );
      })()}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="이미지 확대 보기" onClick={() => setLightbox(null)}>
          <button type="button" className="lightbox-close" aria-label="닫기" onClick={() => setLightbox(null)}><X size={22} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="첨부 이미지 확대" className="lightbox-img" onClick={(event) => event.stopPropagation()} />
          <a className="lightbox-open" href={lightbox} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><ExternalLink size={15} /> 원본 열기</a>
        </div>
      )}

      {detailCardLive && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailCard(null); }}>
          <div className="modal-card card-detail" role="dialog" aria-modal="true" aria-label="카드 자세히 보기">
            <button type="button" className="modal-close" aria-label="닫기" onClick={() => setDetailCard(null)}><X size={18} /></button>
            <div className="card-author"><span className={detailCardLive.actorType === "teacher" ? "teacher-avatar" : ""}>{detailCardLive.authorEmoji}</span><div><b>{detailCardLive.authorName}{detailCardLive.actorType === "teacher" && <em>강사</em>}</b><small>{formatTime(detailCardLive.createdAt)}</small></div></div>
            {detailCardLive.title && <h2 className="card-detail-title">{detailCardLive.title}</h2>}
            {detailCardLive.fileId && detailCardLive.fileType?.startsWith("image/") && detailCardLive.fileType !== "image/svg+xml" && <button type="button" className="card-image" onClick={() => setLightbox(`/api/files/${detailCardLive.fileId}`)} aria-label="이미지 크게 보기"><Image src={`/api/files/${detailCardLive.fileId}`} width={760} height={460} unoptimized alt={detailCardLive.fileName ?? "첨부 이미지"} /></button>}
            {detailCardLive.content && <div className="card-content card-detail-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(detailCardLive.content) }} />}
            {detailCardLive.fileId && (!detailCardLive.fileType?.startsWith("image/") || detailCardLive.fileType === "image/svg+xml") && <a href={`/api/files/${detailCardLive.fileId}`} target="_blank" className="card-file"><File size={21} /><span><b>{detailCardLive.fileName}</b><small>{fileSize(detailCardLive.fileSize)}</small></span><Download size={16} /></a>}
            {detailCardLive.linkUrl && <a href={detailCardLive.linkUrl} target="_blank" rel="noreferrer" className="card-link"><Link2 size={15} /><span>{new URL(detailCardLive.linkUrl).hostname}</span><ExternalLink size={13} /></a>}
            <div className="card-detail-footer">
              <button className={`like-button ${detailCardLive.likedByMe ? "liked" : ""}`} aria-pressed={detailCardLive.likedByMe} aria-label="좋아요" onClick={() => void toggleLike(detailCardLive)}><Heart size={16} fill={detailCardLive.likedByMe ? "currentColor" : "none"} /> {detailCardLive.likeCount > 0 ? detailCardLive.likeCount : "좋아요"}</button>
              <span className="detail-comment-count"><MessageSquare size={16} /> {detailCardLive.commentCount}</span>
              {(detailCardLive.title || detailCardLive.content) && <button onClick={() => void copyCardText(detailCardLive)}><Copy size={15} /> 복사</button>}
              {canManageCard(detailCardLive) && <button onClick={() => { setEditCard(detailCardLive); setDetailCard(null); }}><Pencil size={15} /> 수정</button>}
            </div>
            <div className="comments-area detail-comments">
              {(commentsByCard[detailCardLive.id] ?? []).map((comment) => <div className="comment-row" key={comment.id}><span>{comment.authorEmoji}</span><div><b>{comment.authorName}</b><p>{comment.content}</p></div></div>)}
              {commentsByCard[detailCardLive.id] === undefined ? <p className="no-comment">댓글을 불러오는 중…</p> : commentsByCard[detailCardLive.id]!.length === 0 && <p className="no-comment">아직 댓글이 없습니다.</p>}
              {data.canWrite && <div className="comment-compose"><input value={commentDraft[detailCardLive.id] ?? ""} onChange={(event) => setCommentDraft((current) => ({ ...current, [detailCardLive.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void addComment(detailCardLive.id); } }} maxLength={500} placeholder="댓글 쓰기" /><button onClick={() => void addComment(detailCardLive.id)}><Send size={14} /></button></div>}
            </div>
          </div>
        </div>
      )}

      {transferTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTransferTarget(null); }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
            <button type="button" className="modal-close" aria-label="닫기" onClick={() => setTransferTarget(null)}><X size={18} /></button>
            <span className="kicker">MOVE OR COPY</span>
            <h2 id="transfer-title">다른 보드로 {transferTarget.kind === "column" ? "목록" : "작품"} 보내기</h2>
            <p>‘{transferTarget.name}’을(를) 옮기거나 복사합니다. 첨부 파일과 댓글도 함께 이동합니다.</p>

            <div className="field"><span>방식</span>
              <div className="transfer-modes">
                <button type="button" className={transferMode === "copy" ? "active" : ""} aria-pressed={transferMode === "copy"} onClick={() => setTransferMode("copy")}>
                  <b>복사</b><small>원본은 이 보드에 그대로 남습니다</small>
                </button>
                <button type="button" className={transferMode === "move" ? "active" : ""} aria-pressed={transferMode === "move"} onClick={() => setTransferMode("move")}>
                  <b>이동</b><small>이 보드에서는 사라집니다</small>
                </button>
              </div>
            </div>

            <div className="field"><span>대상 보드</span>
              {transferBoards === null ? (
                <p className="transfer-empty">보드 목록을 불러오는 중…</p>
              ) : transferBoards.length === 0 ? (
                <p className="transfer-empty">보낼 수 있는 보드가 없습니다. 같은 종류의 보드가 하나 더 있어야 합니다.</p>
              ) : (
                <div className="transfer-boards" role="radiogroup" aria-label="대상 보드">
                  {transferBoards.map((board) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={transferBoardId === board.id}
                      className={transferBoardId === board.id ? "active" : ""}
                      key={board.id}
                      onClick={() => setTransferBoardId(board.id)}
                    >
                      <b>{board.title}</b>
                      <small>카드 {board.cardCount} · {board.ownerName ?? "소유자 없음"}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="primary-button" disabled={busy || !transferBoardId} onClick={() => void runTransfer()}>
              {busy ? "보내는 중…" : <><Check size={17} /> {transferMode === "move" ? "이동" : "복사"}하기</>}
            </button>
          </div>
        </div>
      )}

      {galleryComposerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGalleryComposerOpen(false); }}>
          <form className="modal-card gallery-composer" role="dialog" aria-modal="true" aria-labelledby="gallery-composer-title" onSubmit={uploadGalleryItem}>
            <button type="button" className="modal-close" aria-label="작품 올리기 창 닫기" onClick={() => setGalleryComposerOpen(false)}><X size={18} /></button>
            <span className="kicker">SHOW YOUR WORK</span><h2 id="gallery-composer-title">작품 올리기</h2><p>직접 만든 HTML을 올리고 자랑해 보세요. 최대 5MB.</p>
            <label><span>작품 제목</span><input name="title" maxLength={120} required autoFocus placeholder="예: 반응형 랜딩 페이지" /></label>
            <label><span>설명 (선택)</span><textarea name="description" maxLength={500} rows={2} placeholder="어떤 작품인지 간단히 소개해 주세요." /></label>
            <div className="gallery-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={galleryTab === "code"} className={galleryTab === "code" ? "active" : ""} onClick={() => setGalleryTab("code")}><Code2 size={15} /> 코드 붙여넣기</button>
              <button type="button" role="tab" aria-selected={galleryTab === "file"} className={galleryTab === "file" ? "active" : ""} onClick={() => chooseGalleryFile("create")}><Upload size={15} /> 파일 업로드</button>
            </div>
            {galleryTab === "code" ? (
              <label><span>HTML 코드</span><textarea className="code-input" value={galleryCode} onChange={(event) => setGalleryCode(event.target.value)} rows={8} spellCheck={false} placeholder={"<!DOCTYPE html>\n<html> … </html>"} /></label>
            ) : (
              <label className="upload-field"><input id="gallery-file-input" name="htmlfile" type="file" accept=".html,.htm,text/html" onChange={(event) => setGalleryFileName(event.target.files?.[0]?.name ?? "")} /><span><Upload size={18} /><span className="upload-name">{galleryFileName || "HTML 파일 선택 (.html)"}</span><small>최대 5MB</small></span></label>
            )}
            <button className="primary-button" disabled={busy}>{busy ? "올리는 중…" : <><Check size={17} /> 작품 올리기</>}</button>
          </form>
        </div>
      )}

      {galleryEdit && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGalleryEdit(null); }}>
          <form className="modal-card gallery-composer" role="dialog" aria-modal="true" aria-labelledby="gallery-edit-title" onSubmit={saveGalleryEdit}>
            <button type="button" className="modal-close" aria-label="작품 수정 창 닫기" onClick={() => setGalleryEdit(null)}><X size={18} /></button>
            <span className="kicker">EDIT WORK</span><h2 id="gallery-edit-title">작품 수정</h2><p>제목·설명과 HTML을 수정할 수 있습니다.</p>
            <label><span>작품 제목</span><input name="title" maxLength={120} required autoFocus defaultValue={galleryEdit.title} /></label>
            <label><span>설명 (선택)</span><textarea name="description" maxLength={500} rows={2} defaultValue={galleryEdit.content} /></label>
            <div className="gallery-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={galleryEditTab === "code"} className={galleryEditTab === "code" ? "active" : ""} onClick={() => setGalleryEditTab("code")}><Code2 size={15} /> 코드 수정</button>
              <button type="button" role="tab" aria-selected={galleryEditTab === "file"} className={galleryEditTab === "file" ? "active" : ""} onClick={() => chooseGalleryFile("edit")}><Upload size={15} /> 파일로 교체</button>
            </div>
            {galleryEditTab === "code" ? (
              <label><span>HTML 코드</span><textarea className="code-input" value={galleryEditCode} onChange={(event) => setGalleryEditCode(event.target.value)} rows={8} spellCheck={false} placeholder={"<!DOCTYPE html> …"} /></label>
            ) : (
              <label className="upload-field"><input id="gallery-edit-file-input" name="htmlfile" type="file" accept=".html,.htm,text/html" onChange={(event) => setGalleryEditFileName(event.target.files?.[0]?.name ?? "")} /><span><Upload size={18} /><span className="upload-name">{galleryEditFileName || "새 HTML 파일 (선택 안 하면 기존 유지)"}</span><small>최대 5MB</small></span></label>
            )}
            <button className="primary-button" disabled={busy}>{busy ? "저장 중…" : <><Check size={17} /> 변경 사항 저장</>}</button>
          </form>
        </div>
      )}

      {previewCard && (() => {
        const viewIndex = galleryItems.findIndex((item) => item.id === previewCard.id);
        const step = (delta: number) => {
          const next = galleryItems[viewIndex + delta];
          if (next) setGalleryPreview(next);
        };
        return (
        <div className="gallery-viewer" role="dialog" aria-modal="true" aria-label="작품 보기">
          <header className="gallery-viewer-bar">
            <div className="gallery-author"><span>{previewCard.authorEmoji}</span><div className="gallery-viewer-title"><b>{previewCard.title || "작품"}</b><small>{previewCard.authorName}</small></div></div>
            <div className="gallery-viewer-actions">
              <button className={`like-button ${previewCard.likedByMe ? "liked" : ""}`} aria-label="좋아요" onClick={() => void toggleLike(previewCard)}><Heart size={16} fill={previewCard.likedByMe ? "currentColor" : "none"} /> {previewCard.likeCount}</button>
              <button onClick={() => setGalleryShare(previewCard)}><QrCode size={16} /> 공유</button>
              {canManageCard(previewCard) && <button aria-label="작품 수정" onClick={() => { const c = previewCard; setGalleryPreview(null); void openGalleryEdit(c); }}><Pencil size={16} /> 수정</button>}
              <a href={`/api/embed/${previewCard.id}?v=${encodeURIComponent(previewCard.updatedAt)}`} target="_blank" rel="noreferrer"><ExternalLink size={16} /> 새 탭</a>
              <button aria-label="작품 보기 닫기" onClick={() => setGalleryPreview(null)}><X size={19} /></button>
            </div>
          </header>
          <div className="gallery-viewer-stage">
            <iframe className="gallery-viewer-frame" src={`/api/embed/${previewCard.id}?v=${encodeURIComponent(previewCard.updatedAt)}`} title={previewCard.title || "작품"} sandbox="allow-scripts allow-popups allow-forms allow-modals" />
            {galleryItems.length > 1 && (
              <>
                <button type="button" className="viewer-nav prev" aria-label="이전 작품" title="이전 작품" disabled={viewIndex <= 0} onClick={() => step(-1)}><ChevronLeft size={30} /></button>
                <button type="button" className="viewer-nav next" aria-label="다음 작품" title="다음 작품" disabled={viewIndex >= galleryItems.length - 1} onClick={() => step(1)}><ChevronRight size={30} /></button>
                <div className="viewer-counter">{viewIndex + 1} / {galleryItems.length}</div>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {galleryShare && (
        <QrModal
          url={galleryShare.shareCode ? `${window.location.origin}/g/${galleryShare.shareCode}` : `${window.location.origin}/api/embed/${galleryShare.id}`}
          title="작품 공유"
          subtitle="아래 짧은 링크나 QR로 작품을 공유하세요."
          onClose={() => setGalleryShare(null)}
        />
      )}

      {qrOpen && shareUrl && (
        <QrModal url={shareUrl} code={data.board.shareCode} onClose={() => setQrOpen(false)} onCopyLink={() => void copyShareLink()} />
      )}

      {panel && data.isAdmin && (
        <div className="side-panel-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPanel(null)}>
          <aside className="side-panel" role="dialog" aria-modal="true" aria-labelledby="instructor-panel-title">
            <header><div><span className="kicker">INSTRUCTOR CONTROL</span><h2 id="instructor-panel-title">{panel === "activity" ? "활동 기록" : panel === "versions" ? "버전 관리" : "보드 설정"}</h2></div><button aria-label="강사 관리 패널 닫기" onClick={() => setPanel(null)}><X size={19} /></button></header>
            {panel === "activity" && <div className="timeline">{data.activity.map((entry) => <div className="timeline-item" key={entry.id}><span className={entry.actorType === "teacher" ? "teacher-event" : "guest-event"}>{entry.actorType === "teacher" ? <ShieldCheck size={15} /> : <Activity size={15} />}</span><div><b>{entry.actorName}</b><p>{entry.action}</p><small><Clock3 size={12} /> {formatTime(entry.createdAt)}{typeof entry.details.deviceKey === "string" && ` · 기기 ${entry.details.deviceKey}`}</small></div></div>)}{data.activity.length === 0 && <p className="panel-empty">아직 활동 기록이 없습니다.</p>}</div>}
            {panel === "versions" && <div className="version-panel"><div className="version-intro"><FileClock size={23} /><div><b>모든 강사 작업은 자동 저장됩니다.</b><p>최종본 또는 원하는 자동 버전으로 언제든 복원할 수 있습니다.</p></div></div><button className="primary-button compact full" onClick={() => void saveFinal()}><Save size={16} /> 현재 상태를 최종본으로 저장</button><div className="version-list">{data.revisions.map((revision) => <div className={`version-item ${revision.kind === "final" ? "final-version" : ""}`} key={revision.id}><span>{revision.kind === "final" ? <Save size={16} /> : <History size={16} />}</span><div><b>{revision.label}</b><small>{formatTime(revision.createdAt)} · {revision.kind === "final" ? "최종본" : "자동 저장"}</small></div><button onClick={() => void restore(revision)}><RotateCcw size={15} /> 복원</button></div>)}</div></div>}
            {panel === "settings" && <form className="settings-form" onSubmit={updateSettings}><label><span>보드 제목</span><input name="title" defaultValue={data.board.title} maxLength={120} required /></label><label><span>설명</span><textarea name="description" defaultValue={data.board.description} maxLength={500} rows={4} /></label><label><span>접근 대상</span><select name="audience" defaultValue={data.board.audience ?? "link"}><option value="link">링크 가진 누구나 (수강생 포함)</option><option value="members">회원 전용 (로그인한 강사만)</option></select></label><label><span>권한</span><select name="shareMode" defaultValue={data.board.shareMode}><option value="readonly">읽기 전용</option><option value="write">읽기·쓰기 가능</option></select></label><div className="field"><span>보드 배경</span><div className="bg-picker">{BOARD_BACKGROUNDS.map((item) => (<button type="button" key={item.value} className={`bg-swatch ${settingsBackground === item.value ? "selected" : ""}`} data-board-bg={item.value} aria-label={item.label} aria-pressed={settingsBackground === item.value} title={item.label} onClick={() => setSettingsBackground(item.value)}><i />{settingsBackground === item.value && <Check size={16} />}</button>))}</div></div>{data.board.accessPassword ? (<div className="share-code-block"><span className="share-code-label">입장 비밀번호</span><strong className="share-code-value">{data.board.accessPassword}</strong><button type="button" className="share-code-copy" aria-label="입장 비밀번호 복사" onClick={() => void copyAccessPassword()}><Copy size={15} /> 복사</button><small>수강생이 처음 입장할 때 입력합니다.</small><div className="share-code-actions"><button type="button" onClick={() => void setBoardAccessPassword()}>변경</button><button type="button" className="danger" onClick={() => void clearBoardAccessPassword()}>사용 안 함</button></div></div>) : (<div className="share-link-box"><Lock size={16} /><span>{data.board.requirePassword ? "입장 비밀번호 설정됨 (이전 방식이라 표시할 수 없습니다)" : "입장 비밀번호 없음"}</span><button type="button" onClick={() => void setBoardAccessPassword()}>{data.board.requirePassword ? "다시 설정" : "설정"}</button></div>)}<div className="share-link-box"><Link2 size={17} /><span>{shareUrl}</span><button type="button" aria-label="공유 링크 복사" onClick={() => void copyShareLink()}><Copy size={16} /></button></div><button className="primary-button"><Save size={16} /> 설정 저장</button></form>}
          </aside>
        </div>
      )}
    </main>
  );
}
