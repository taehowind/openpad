"use client";

import { useState, type FormEvent } from "react";
import { Check, ChevronRight } from "lucide-react";
import { PROFILE_EMOJIS } from "@/lib/profile";

type ProfileFormProps = {
  initialNickname?: string;
  initialEmoji?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (profile: { nickname: string; emoji: string }) => Promise<void>;
};

export function ProfileForm({
  initialNickname = "",
  initialEmoji = "😀",
  busy,
  submitLabel,
  onSubmit,
}: ProfileFormProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [emoji, setEmoji] = useState(initialEmoji);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ nickname: nickname.trim(), emoji });
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <fieldset>
        <legend>나를 표현할 이모티콘</legend>
        <div className="emoji-picker" role="radiogroup" aria-label="프로필 이모티콘">
          {PROFILE_EMOJIS.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={emoji === item}
              className={emoji === item ? "selected" : ""}
              onClick={() => setEmoji(item)}
              key={item}
            >
              {item}
              {emoji === item && <Check size={11} />}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>닉네임</span>
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={30}
          placeholder="예: 홍길동"
          required
          autoFocus
        />
      </label>
      <button className="primary-button" disabled={busy || !nickname.trim()}>
        {busy ? "저장 중…" : submitLabel}<ChevronRight size={18} />
      </button>
    </form>
  );
}
