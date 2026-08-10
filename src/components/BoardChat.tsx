"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, MessageCircleQuestion, PanelRightClose, PanelRightOpen, Send, Trash2 } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

type BoardChatProps = {
  messages: ChatMessage[];
  onSend: (content: string) => Promise<boolean>;
  canModerate?: boolean;
  onHide?: (id: string, hidden: boolean) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
};

function chatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function BoardChat({ messages, onSend, canModerate = false, onHide, onDelete }: BoardChatProps) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [seenCount, setSeenCount] = useState(messages.length);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // Unread badge only while collapsed; toggling (open or close) marks everything as seen.
  const unread = collapsed ? Math.max(0, messages.length - seenCount) : 0;
  function toggleCollapse() {
    setSeenCount(messages.length);
    setCollapsed((current) => !current);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = content.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      if (await onSend(message)) setContent("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={`board-chat ${collapsed ? "collapsed" : ""}`} aria-label="강의 질문 채팅방">
      <header>
        <span className="chat-head-icon"><MessageCircleQuestion size={19} />{unread > 0 && <b className="chat-unread" aria-label={`읽지 않은 메시지 ${unread}개`}>{unread > 9 ? "9+" : unread}</b>}</span>
        <div><h2>강의 Q&amp;A</h2><p>강사에게 궁금한 점을 남겨보세요.</p></div>
        <button
          type="button"
          className="chat-toggle"
          aria-expanded={!collapsed}
          aria-controls="board-chat-content"
          aria-label={collapsed ? (unread > 0 ? `새 메시지 ${unread}개 · Q&A 채팅 펼치기` : "Q&A 채팅 펼치기") : "Q&A 채팅 접기"}
          title={collapsed ? "Q&A 채팅 펼치기" : "Q&A 채팅 접기"}
          onClick={toggleCollapse}
        >
          {collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </button>
      </header>
      <div className="board-chat-content" id="board-chat-content" aria-hidden={collapsed}>
        <div className="chat-messages" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="chat-empty"><MessageCircleQuestion size={28} /><b>첫 질문을 남겨보세요</b><p>질문은 이 보드에 안전하게 저장됩니다.</p></div>
          )}
          {messages.map((message) => (
            <article className={`chat-message ${message.actorType === "teacher" ? "teacher-message" : ""} ${message.hidden ? "chat-message-hidden" : ""}`} key={message.id}>
              <span>{message.authorEmoji}</span>
              <div>
                <header>
                  <b>{message.authorName}</b>{message.actorType === "teacher" && <em>강사</em>}<time>{chatTime(message.createdAt)}</time>
                  {canModerate && (
                    <span className="chat-mod">
                      <button type="button" aria-label={message.hidden ? "다시 표시" : "가리기"} title={message.hidden ? "다시 표시" : "가리기"} onClick={() => void onHide?.(message.id, !message.hidden)}>{message.hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                      <button type="button" className="chat-mod-delete" aria-label="삭제" title="삭제" onClick={() => void onDelete?.(message.id)}><Trash2 size={14} /></button>
                    </span>
                  )}
                </header>
                {message.hidden && !canModerate ? (
                  <p className="chat-hidden"><EyeOff size={13} /> 강사가 가린 메시지입니다.</p>
                ) : (
                  <p className={message.hidden ? "chat-masked" : ""}>{message.content}{message.hidden && canModerate && <span className="chat-hidden-tag">가려짐</span>}</p>
                )}
              </div>
            </article>
          ))}
        </div>
        <form className="chat-compose" onSubmit={submit}>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={1000} rows={2} placeholder="강사에게 질문하기" />
          <button disabled={busy || !content.trim()} aria-label="채팅 보내기"><Send size={16} /></button>
        </form>
      </div>
    </aside>
  );
}
