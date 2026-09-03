"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Archive, BookOpen, Check, ChevronRight, Copy, Eye, Link2, Lock,
  LockKeyhole, LogOut, MoreHorizontal, Pencil, Plus, QrCode, RefreshCw, Shield, ShieldCheck,
  Trash2, UserCheck, UserPlus, Users, UserX, X,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { useDialog } from "@/components/DialogProvider";
import { QrModal } from "@/components/QrModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/components/ToastProvider";
import { responseError } from "@/lib/api-client";
import { BOARD_BACKGROUNDS, type BoardBackground } from "@/lib/backgrounds";
import type { AccountInfo, BoardAudience, BoardSummary, BoardType, InstructorListItem, InstructorRole, InstructorStatus, ShareMode } from "@/lib/types";

const STATUS_LABEL: Record<InstructorStatus, string> = { pending: "승인 대기", active: "활성", disabled: "비활성" };

export function AdminClient() {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  // Distinguishes "no boards" from "boards have not arrived yet". Without it the empty state
  // renders in the gap between the session resolving and the list loading, so a teacher who
  // has boards sees an invitation to create their first one flash past on every visit.
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("aistudy_saved_email") ?? "" : ""));
  const [rememberEmail, setRememberEmail] = useState(() => (typeof window !== "undefined" ? Boolean(localStorage.getItem("aistudy_saved_email")) : false));
  const [password, setPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [shareBoard, setShareBoard] = useState<BoardSummary | null>(null);
  const [qrBoard, setQrBoard] = useState<BoardSummary | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<InstructorListItem[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileError, setProfileError] = useState("");
  const [createAudience, setCreateAudience] = useState<BoardAudience>("link");
  const [createBackground, setCreateBackground] = useState<BoardBackground>("default");
  const [createType, setCreateType] = useState<BoardType>("board");
  const [useAccessPassword, setUseAccessPassword] = useState(false);
  const [createPassword, setCreatePassword] = useState("");

  const loadBoards = useCallback(async () => {
    const response = await fetch("/api/boards", { cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); setAccount(null); return; }
    if (!response.ok) { setError(await responseError(response, "보드 목록을 불러오지 못했습니다.")); return; }
    setBoards(await response.json());
    setBoardsLoaded(true);
  }, []);

  const init = useCallback(async () => {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await response.json().catch(() => ({ account: null }));
    if (data.account) {
      setAccount(data.account);
      setAuthenticated(true);
      await loadBoards();
    } else {
      setAuthenticated(false);
      setAccount(null);
    }
  }, [loadBoards]);

  useEffect(() => {
    const timer = window.setTimeout(() => void init(), 0);
    return () => window.clearTimeout(timer);
  }, [init]);

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

  async function refreshBoards() {
    await runAction("보드 목록을 새로고침하는 중…", "보드 목록을 새로고침했습니다.", "보드 목록을 불러오지 못했습니다.", loadBoards);
  }

  function openProfile() {
    setProfileName(account?.name ?? "");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setProfileError("");
    setProfileOpen(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    const name = profileName.trim();
    if (!name) { setProfileError("이름을 입력해 주세요."); return; }
    // Leaving all three password fields empty means "name only", which is a normal way to use
    // this form rather than a mistake.
    const changingPassword = Boolean(currentPassword || newPassword || confirmPassword);
    if (changingPassword) {
      if (!currentPassword) { setProfileError("현재 비밀번호를 입력해 주세요."); return; }
      if (newPassword.length < 8) { setProfileError("새 비밀번호는 8자 이상이어야 합니다."); return; }
      if (newPassword !== confirmPassword) { setProfileError("새 비밀번호가 서로 다릅니다."); return; }
    }
    if (name === account?.name && !changingPassword) { setProfileError("변경할 내용이 없습니다."); return; }

    setBusy(true);
    const saved = await runAction("내 정보를 저장하는 중…", "내 정보를 저장했습니다.", "내 정보를 저장하지 못했습니다.", async () => {
      const response = await fetch("/api/instructors/me", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...(changingPassword ? { currentPassword, newPassword } : {}) }),
      });
      if (!response.ok) throw new Error(await responseError(response, "내 정보를 저장하지 못했습니다."));
      return (await response.json()).account as AccountInfo;
    });
    setBusy(false);
    if (!saved) { setProfileError(""); return; }
    setAccount(saved);
    setProfileOpen(false);
    // The name is copied onto member-authored cards, so the dashboard's own counts and any open
    // member list can be stale now.
    await loadBoards();
    if (membersOpen) await loadMembers();
  }

  async function copyShareLink(board: BoardSummary) {
    try {
      await navigator.clipboard.writeText(shareUrl(board));
      toast.show("공유 링크를 클립보드에 복사했습니다.", "success");
    } catch {
      toast.show("링크를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.", "error", 4500);
    }
  }

  async function copyAccessPassword(board: BoardSummary) {
    if (!board.accessPassword) return;
    try {
      await navigator.clipboard.writeText(board.accessPassword);
      toast.show("입장 비밀번호를 클립보드에 복사했습니다.", "success");
    } catch {
      toast.show("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.", "error", 4500);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const account = await runAction("강사 계정을 확인하는 중…", "강사 공간에 로그인했습니다.", "로그인하지 못했습니다.", async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(await responseError(response, "로그인하지 못했습니다."));
      const data = await response.json();
      return data.account as AccountInfo;
    });
    if (account) {
      try {
        if (rememberEmail) localStorage.setItem("aistudy_saved_email", email);
        else localStorage.removeItem("aistudy_saved_email");
      } catch {
        // ignore storage failures (private mode etc.)
      }
      setAccount(account);
      setAuthenticated(true);
      setPassword("");
      await loadBoards();
    }
    setBusy(false);
  }

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const done = await runAction("가입 신청을 보내는 중…", "가입 신청을 접수했습니다.", "가입하지 못했습니다.", async () => {
      const response = await fetch("/api/auth/signup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name: signupName, password }),
      });
      if (!response.ok) throw new Error(await responseError(response, "가입하지 못했습니다."));
      return true;
    });
    setBusy(false);
    if (done) {
      setAuthMode("login");
      setPassword("");
      setSignupName("");
      setNotice("가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.");
    }
  }

  // Offered as a starting point when the teacher turns the code on. Letters that are easy to
  // confuse when read aloud are left out, the same way the board's own share code is built.
  function suggestPassword() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const values = new Uint32Array(6);
    crypto.getRandomValues(values);
    return [...values].map((value) => alphabet[value % alphabet.length]).join("");
  }

  function toggleAccessPassword(on: boolean) {
    setUseAccessPassword(on);
    if (on && !createPassword) setCreatePassword(suggestPassword());
  }

  async function createBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const rawPassword = useAccessPassword ? createPassword.trim() : "";
    const data = await runAction("새 강의 보드를 만드는 중…", "새 강의 보드를 만들었습니다.", "보드를 만들지 못했습니다.", async () => {
      const response = await fetch("/api/boards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"), description: form.get("description"),
          shareMode: createType === "gallery" ? "write" : form.get("shareMode"), audience: form.get("audience"), type: createType,
          background: createBackground,
          ...(createAudience === "link" && rawPassword ? { accessPassword: rawPassword } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "보드를 만들지 못했습니다."));
      const created = await response.json();
      await loadBoards();
      return created as { id: string };
    });
    setBusy(false);
    if (!data) return;
    setCreateOpen(false);
    setCreateAudience("link");
    setCreateType("board");
    router.push(`/board/${data.id}`);
  }

  async function updateAccess(board: BoardSummary, changes: { shareMode?: ShareMode; audience?: BoardAudience; accessPassword?: string }) {
    setBusy(true);
    const updated = await runAction("보드 접근 설정을 변경하는 중…", "보드 접근 설정을 변경했습니다.", "설정을 바꾸지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${board.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error(await responseError(response, "설정을 바꾸지 못했습니다."));
      await loadBoards();
      return true;
    });
    if (updated) {
      setShareBoard((current) => current ? {
        ...current,
        shareMode: changes.shareMode ?? current.shareMode,
        audience: changes.audience ?? current.audience,
        requirePassword: changes.accessPassword === undefined ? current.requirePassword : changes.accessPassword.trim().length > 0,
      } : null);
    }
    setBusy(false);
  }

  async function setBoardPassword(board: BoardSummary) {
    const value = await dialog.prompt({
      title: "입장 비밀번호 설정",
      message: "수강생이 링크로 입장할 때 입력할 비밀번호입니다. 비워서 저장하면 비밀번호가 해제됩니다.",
      label: "입장 비밀번호",
      placeholder: board.requirePassword ? "새 비밀번호 (비우면 해제)" : "비밀번호 입력",
      confirmLabel: "저장",
      required: false,
      maxLength: 100,
    });
    if (value === null) return;
    await updateAccess(board, { accessPassword: value });
  }

  async function rotateLink(board: BoardSummary) {
    const ok = await dialog.confirm({
      title: "새 공유 링크를 발급할까요?",
      message: "기존 공유 링크는 즉시 사용할 수 없게 되고, 이전 링크를 받은 사람은 다시 입장할 수 없습니다.",
      confirmLabel: "새 링크 발급",
    });
    if (!ok) return;
    const data = await runAction("새 공유 링크를 발급하는 중…", "새 공유 링크를 발급했습니다.", "공유 링크를 바꾸지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${board.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotateShareLink: true }),
      });
      if (!response.ok) throw new Error(await responseError(response, "공유 링크를 바꾸지 못했습니다."));
      const updated = await response.json();
      await loadBoards();
      return updated as { shareToken: string; shareCode: string };
    });
    if (!data) return;
    setShareBoard({ ...board, shareToken: data.shareToken, shareCode: data.shareCode });
  }

  async function deleteBoard(board: BoardSummary) {
    const ok = await dialog.confirm({
      title: "보드를 삭제할까요?",
      message: `‘${board.title}’ 보드와 모든 카드·댓글·기록이 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    await runAction("보드를 삭제하는 중…", "보드를 삭제했습니다.", "보드를 삭제하지 못했습니다.", async () => {
      const response = await fetch(`/api/boards/${board.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "보드를 삭제하지 못했습니다."));
      await loadBoards();
    });
  }

  async function logout() {
    await runAction("로그아웃하는 중…", "안전하게 로그아웃했습니다.", "로그아웃하지 못했습니다.", async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("로그아웃하지 못했습니다.");
      setAuthenticated(false);
      setAccount(null);
      setBoards([]);
    });
  }

  const loadMembers = useCallback(async () => {
    const response = await fetch("/api/instructors", { cache: "no-store" });
    if (!response.ok) { setError(await responseError(response, "회원 목록을 불러오지 못했습니다.")); return; }
    setMembers(await response.json());
  }, []);

  async function openMembers() {
    setMembersOpen(true);
    await loadMembers();
  }

  async function updateMember(member: InstructorListItem, changes: { status?: InstructorStatus; role?: InstructorRole }, loadingMessage: string, successMessage: string) {
    await runAction(loadingMessage, successMessage, "회원 정보를 변경하지 못했습니다.", async () => {
      const response = await fetch(`/api/instructors/${member.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error(await responseError(response, "회원 정보를 변경하지 못했습니다."));
      await loadMembers();
    });
  }

  async function deleteMember(member: InstructorListItem) {
    const ok = await dialog.confirm({
      title: "회원을 삭제할까요?",
      message: `‘${member.name}’(${member.email}) 계정을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "삭제", tone: "danger",
    });
    if (!ok) return;
    await runAction("회원을 삭제하는 중…", "회원을 삭제했습니다.", "회원을 삭제하지 못했습니다.", async () => {
      const response = await fetch(`/api/instructors/${member.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "회원을 삭제하지 못했습니다."));
      await loadMembers();
    });
  }

  const shareUrl = (board: BoardSummary) => `${window.location.origin}/wz/${board.shareCode}`;

  if (authenticated === null) {
    return <main className="center-screen"><div className="spinner" /><p>강사 공간을 준비하고 있습니다.</p></main>;
  }

  if (!authenticated) {
    return (
      <main className="login-page">
        <ThemeToggle className="theme-fab" />
        <section className="login-story">
          <Brand />
          <div className="login-story-copy">
            <span className="kicker"><ShieldCheck size={15} /> INSTRUCTOR WORKSPACE</span>
            <h1>강의 자료와<br />참여자의 생각을<br /><em>하나의 보드</em>에서<br />관리하세요</h1>
            <p>공유 링크, 읽기·쓰기 권한, 파일 업로드, 변경 이력과 최종본 복원을 한곳에 담았습니다.</p>
            <div className="login-features">
              <span><Check size={16} /> 링크를 받은 사람만 입장</span>
              <span><Check size={16} /> 모든 참여 활동 자동 기록</span>
              <span><Check size={16} /> 강사 최종본 즉시 복원</span>
            </div>
          </div>
        </section>
        <section className="login-form-side">
          {authMode === "login" ? (
            <form className="login-card" onSubmit={login}>
              <div className="login-lock"><LockKeyhole size={24} /></div>
              <span className="kicker">강사 로그인</span>
              <h2>AI STUDY 로그인</h2>
              <p>강사 계정 이메일과 비밀번호로 로그인하세요.</p>
              {notice && <p className="form-error" style={{ background: "var(--ok-surface)", color: "var(--ok)", borderColor: "transparent" }} role="status">{notice}</p>}
              <label><span>이메일</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoFocus required /></label>
              <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
              <label className="checkbox-row"><input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} /><span>이메일 저장</span></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" disabled={busy}>{busy ? "확인 중…" : "로그인"}<ChevronRight size={18} /></button>
              <p className="auth-switch">아직 강사 계정이 없나요? <button type="button" onClick={() => { setAuthMode("signup"); setError(""); setNotice(""); }}>회원가입</button></p>
            </form>
          ) : (
            <form className="login-card" onSubmit={signup}>
              <div className="login-lock"><UserPlus size={24} /></div>
              <span className="kicker">강사 회원가입</span>
              <h2>강사 계정 만들기</h2>
              <p>가입 후 관리자 승인을 받으면 보드를 만들 수 있습니다.</p>
              <label><span>이름</span><input type="text" value={signupName} onChange={(event) => setSignupName(event.target.value)} maxLength={60} autoFocus required /></label>
              <label><span>이메일</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
              <label><span>비밀번호 (8자 이상)</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" disabled={busy}>{busy ? "신청 중…" : "가입 신청"}<ChevronRight size={18} /></button>
              <p className="auth-switch">이미 계정이 있나요? <button type="button" onClick={() => { setAuthMode("login"); setError(""); }}>로그인</button></p>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <Brand compact />
        <div className="topbar-actions">
          {account && (
            <button type="button" className="account-chip" onClick={openProfile} title="내 정보 수정" aria-label={`내 정보 수정 (${account.name})`}>
              <b>{account.name}</b>{account.role === "admin" && <span className="role-tag">관리자</span>}
            </button>
          )}
          {account?.role === "admin" && <button className="topbar-button" onClick={() => void openMembers()}><Users size={16} /> 회원 관리</button>}
          <button className="topbar-button" onClick={() => void refreshBoards()}><RefreshCw size={16} /> 새로고침</button>
          <ThemeToggle />
          <button className="topbar-icon" onClick={() => void logout()} aria-label="로그아웃"><LogOut size={18} /></button>
        </div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-heading">
          <div><span className="kicker">INSTRUCTOR DASHBOARD</span><h1>내 강의 보드</h1><p>{account?.role === "admin" ? "모든 강의 보드와 회원을 관리할 수 있습니다." : "수업별 보드를 만들고 공유 권한과 참여 기록을 관리하세요."}</p></div>
          <button className="primary-button compact" onClick={() => setCreateOpen(true)}><Plus size={18} /> 새 보드 만들기</button>
        </div>
        {error && <div className="error-banner">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
        {!boardsLoaded ? null : boards.length === 0 ? (
          <div className="dashboard-empty">
            <span><BookOpen size={32} /></span><h2>첫 강의 보드를 만들어 보세요</h2>
            <p>기본 목록이 자동으로 준비되고, 바로 공유할 수 있습니다.</p>
            <button className="primary-button compact" onClick={() => setCreateOpen(true)}><Plus size={18} /> 보드 만들기</button>
          </div>
        ) : (
          <div className="dashboard-grid">
            {boards.map((board, index) => (
              <article className={`dashboard-board board-cover-${index % 4}`} key={board.id} onClick={() => router.push(`/board/${board.id}`)}>
                <div className="board-card-head">
                  <div className="board-badges">
                    <span className="permission-badge">{board.shareMode === "write" ? <Pencil size={13} /> : <Eye size={13} />}{board.shareMode === "write" ? "읽기·쓰기" : "읽기 전용"}</span>
                    {board.audience === "members" && <span className="audience-badge"><Shield size={12} /> 회원 전용</span>}
                    {board.requirePassword && <span className="audience-badge lock"><Lock size={12} /> 비밀번호</span>}
                  </div>
                  <button className="more-button" onClick={(event) => { event.stopPropagation(); setShareBoard(board); }} aria-label="공유 설정"><MoreHorizontal size={19} /></button>
                </div>
                <div className="board-card-copy"><h2>{board.title}</h2><p>{board.description || "설명이 없습니다."}</p></div>
                <div className="board-card-footer">
                  <span><Archive size={15} /> 카드 {board.cardCount}</span><span><Users size={15} /> 참여 {board.participantCount}</span>
                  {account?.role === "admin" && board.ownerName && <span className="board-owner">· {board.ownerName}</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {profileOpen && account && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setProfileOpen(false)}>
          <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="profile-title" onSubmit={saveProfile}>
            <button type="button" className="modal-close" aria-label="내 정보 창 닫기" onClick={() => setProfileOpen(false)}><X size={18} /></button>
            <span className="kicker">MY ACCOUNT</span><h2 id="profile-title">내 정보</h2>
            <p>이름과 비밀번호를 바꿀 수 있습니다. 비밀번호를 그대로 두려면 아래 세 칸을 비워 두세요.</p>
            <div className="field"><span>이메일</span><p className="field-static">{account.email}<em>변경할 수 없습니다</em></p></div>
            <label><span>이름</span>
              <input type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={60} autoFocus required />
            </label>
            <label><span>현재 비밀번호</span>
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="비밀번호를 바꿀 때만 입력" />
            </label>
            <label><span>새 비밀번호 (8자 이상)</span>
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} placeholder="비우면 그대로 둡니다" />
            </label>
            <label><span>새 비밀번호 확인</span>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="새 비밀번호를 한 번 더" />
            </label>
            {profileError && <p className="form-error" role="alert">{profileError}</p>}
            <button className="primary-button" disabled={busy}>{busy ? "저장하는 중…" : "저장"}<ChevronRight size={18} /></button>
          </form>
        </div>
      )}

      {createOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
          <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-board-title" onSubmit={createBoard}>
            <button type="button" className="modal-close" aria-label="새 보드 창 닫기" onClick={() => setCreateOpen(false)}><X size={18} /></button>
            <span className="kicker">NEW CLASS BOARD</span><h2 id="create-board-title">새 강의 보드</h2><p>보드 종류와 접근 권한을 정한 뒤 공유 링크를 전달하세요.</p>
            <label><span>보드 종류</span>
              <select value={createType} onChange={(event) => setCreateType(event.target.value as BoardType)}>
                <option value="board">일반 보드 (목록·카드)</option>
                <option value="gallery">바이브코딩 갤러리 (HTML 작품 자랑)</option>
              </select>
            </label>
            <label><span>보드 제목</span><input name="title" maxLength={120} placeholder={createType === "gallery" ? "예: 3반 바이브코딩 작품 갤러리" : "예: 생성형 AI 업무 활용 실습"} required autoFocus /></label>
            <label><span>설명</span><textarea name="description" maxLength={500} rows={3} placeholder="수업 목표나 참여 방법을 적어 주세요." /></label>
            {createType === "board" && <label><span>권한</span><select name="shareMode" defaultValue="readonly"><option value="readonly">읽기 전용</option><option value="write">읽기·쓰기 가능</option></select></label>}
            <label><span>접근 대상</span>
              <select name="audience" value={createAudience} onChange={(event) => setCreateAudience(event.target.value as BoardAudience)}>
                <option value="link">링크 가진 누구나 (수강생 포함)</option>
                <option value="members">회원 전용 (로그인한 강사만)</option>
              </select>
            </label>
            {createAudience === "link" && (
              <>
                <label className="checkbox-row">
                  <input type="checkbox" checked={useAccessPassword} onChange={(event) => toggleAccessPassword(event.target.checked)} />
                  <span>입장 비밀번호 사용</span>
                </label>
                {useAccessPassword && (
                  <label>
                    <span>입장 비밀번호</span>
                    <input type="text" value={createPassword} onChange={(event) => setCreatePassword(event.target.value)}
                      maxLength={100} autoComplete="off" spellCheck={false} required />
                    <small className="field-hint">수강생에게 그대로 알려 주는 값입니다. 강사 본인 비밀번호는 쓰지 마세요.</small>
                  </label>
                )}
              </>
            )}
            <div className="field"><span>보드 배경</span>
              <div className="bg-picker">
                {BOARD_BACKGROUNDS.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    className={`bg-swatch ${createBackground === item.value ? "selected" : ""}`}
                    data-board-bg={item.value}
                    aria-label={item.label}
                    aria-pressed={createBackground === item.value}
                    title={item.label}
                    onClick={() => setCreateBackground(item.value)}
                  ><i />{createBackground === item.value && <Check size={16} />}</button>
                ))}
              </div>
            </div>
            <button className="primary-button" disabled={busy}>{busy ? "만드는 중…" : "보드 만들기"}<ChevronRight size={18} /></button>
          </form>
        </div>
      )}

      {shareBoard && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShareBoard(null)}>
          <div className="modal-card share-modal" role="dialog" aria-modal="true" aria-labelledby="share-board-title">
            <button type="button" className="modal-close" aria-label="공유 설정 창 닫기" onClick={() => setShareBoard(null)}><X size={18} /></button>
            <span className="kicker">SHARE BOARD</span><h2 id="share-board-title">{shareBoard.title}</h2><p>아래 주소를 알려 주세요. 입장 비밀번호를 사용하면 함께 알려 주셔야 합니다.</p>
            {shareBoard.accessPassword && (
              <div className="share-code-block">
                <span className="share-code-label">입장 비밀번호</span>
                <strong className="share-code-value">{shareBoard.accessPassword}</strong>
                <button type="button" className="share-code-copy" aria-label="입장 비밀번호 복사" onClick={() => void copyAccessPassword(shareBoard)}><Copy size={15} /> 복사</button>
                <small>수강생이 처음 입장할 때 입력합니다.</small>
              </div>
            )}
            <label><span>접근 대상</span>
              <select value={shareBoard.audience} onChange={(event) => void updateAccess(shareBoard, { audience: event.target.value as BoardAudience })} disabled={busy}>
                <option value="link">링크 가진 누구나 (수강생 포함)</option>
                <option value="members">회원 전용 (로그인한 강사만)</option>
              </select>
            </label>
            <label><span>권한</span><select value={shareBoard.shareMode} onChange={(event) => void updateAccess(shareBoard, { shareMode: event.target.value as ShareMode })} disabled={busy}><option value="readonly">읽기 전용</option><option value="write">읽기·쓰기 가능</option></select></label>
            {shareBoard.audience === "link" && (
              <div className="share-link-box"><Lock size={16} /><span>{shareBoard.requirePassword ? "입장 비밀번호 설정됨" : "입장 비밀번호 없음"}</span><button type="button" onClick={() => void setBoardPassword(shareBoard)}>{shareBoard.requirePassword ? "변경" : "설정"}</button></div>
            )}
            <div className="share-link-box"><Link2 size={17} /><span>{shareUrl(shareBoard)}</span><button type="button" aria-label="공유 링크 복사" onClick={() => void copyShareLink(shareBoard)}><Copy size={16} /></button></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => void rotateLink(shareBoard)}><RefreshCw size={16} /> 링크 재발급</button><button type="button" className="secondary-button" onClick={() => setQrBoard(shareBoard)}><QrCode size={16} /> 공유 QR</button><button type="button" className="primary-button compact" onClick={() => void copyShareLink(shareBoard)}><Copy size={16} /> 링크 복사</button></div>
            <div className="danger-zone"><button type="button" onClick={() => { void deleteBoard(shareBoard); setShareBoard(null); }}><Trash2 size={16} /> 보드 삭제</button></div>
          </div>
        </div>
      )}

      {qrBoard && (
        <QrModal url={shareUrl(qrBoard)} code={qrBoard.shareCode} onClose={() => setQrBoard(null)} onCopyLink={() => void copyShareLink(qrBoard)} />
      )}

      {membersOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMembersOpen(false)}>
          <div className="modal-card members-modal" role="dialog" aria-modal="true" aria-labelledby="members-title">
            <button type="button" className="modal-close" aria-label="회원 관리 창 닫기" onClick={() => setMembersOpen(false)}><X size={18} /></button>
            <span className="kicker">MEMBER MANAGEMENT</span><h2 id="members-title">강사 회원 관리</h2><p>가입 신청을 승인하고 회원의 상태와 권한을 관리하세요.</p>
            {members.length === 0 ? (
              <div className="members-empty">아직 등록된 강사 회원이 없습니다.</div>
            ) : (
              <div className="members-list">
                {members.map((member) => (
                  <div className="member-row" key={member.id}>
                    <div>
                      <b>{member.name}{member.role === "admin" && <span className="member-role-tag">관리자</span>}<span className={`member-status status-${member.status}`}>{STATUS_LABEL[member.status]}</span></b>
                      <small>{member.email} · 보드 {member.boardCount}개</small>
                    </div>
                    <div className="member-actions">
                      {member.status === "pending" && <button onClick={() => void updateMember(member, { status: "active" }, "가입을 승인하는 중…", "가입을 승인했습니다.")}><UserCheck size={14} /> 승인</button>}
                      {member.status === "active" && member.id !== account?.id && <button onClick={() => void updateMember(member, { status: "disabled" }, "회원을 비활성화하는 중…", "회원을 비활성화했습니다.")}><UserX size={14} /> 비활성</button>}
                      {member.status === "disabled" && <button onClick={() => void updateMember(member, { status: "active" }, "회원을 활성화하는 중…", "회원을 활성화했습니다.")}><UserCheck size={14} /> 활성화</button>}
                      {member.id !== account?.id && (member.role === "admin"
                        ? <button onClick={() => void updateMember(member, { role: "instructor" }, "권한을 낮추는 중…", "일반 강사로 변경했습니다.")}><Shield size={14} /> 강사로</button>
                        : <button onClick={() => void updateMember(member, { role: "admin" }, "관리자로 승격하는 중…", "관리자로 변경했습니다.")}><ShieldCheck size={14} /> 관리자로</button>)}
                      {member.id !== account?.id && <button className="danger" onClick={() => void deleteMember(member)}><Trash2 size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
