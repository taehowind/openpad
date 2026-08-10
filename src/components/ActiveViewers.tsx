import type { ActiveViewer } from "@/lib/types";

export function ActiveViewers({ viewers }: { viewers: ActiveViewer[] }) {
  const visible = viewers.slice(0, 8);
  const overflow = viewers.length - visible.length;

  return (
    <div className="active-viewers" aria-label={`현재 접속자 ${viewers.length}명`}>
      <div className="active-avatars">
        {visible.map((viewer) => (
          <span
            className={viewer.actorType === "teacher" ? "teacher-online" : ""}
            data-name={viewer.nickname}
            aria-label={`${viewer.nickname} 접속 중`}
            key={viewer.id}
          >
            {viewer.emoji}
          </span>
        ))}
        {overflow > 0 && <span className="avatar-overflow">+{overflow}</span>}
      </div>
      <small><i /> {viewers.length}명 접속</small>
    </div>
  );
}
