"use client";

import { Copy } from "lucide-react";

/**
 * The entry-password control, in one place.
 *
 * A board's access settings are reachable from three screens — the create dialog, the share dialog
 * and the in-board settings panel — and each had grown its own version of this: a checkbox with an
 * inline field on one, a "설정" button opening a prompt dialog on the other two. Same setting, three
 * shapes. One component so they cannot drift again.
 */

/** Letters that survive being read aloud: no 0/O, no 1/I/L. Same alphabet the share code uses. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function suggestAccessPassword(length = 6) {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return [...values].map((value) => ALPHABET[value % ALPHABET.length]).join("");
}

type AccessPasswordFieldProps = {
  enabled: boolean;
  value: string;
  /** Called with the next enabled/value pair; the caller decides when that reaches the server. */
  onChange: (next: { enabled: boolean; value: string }) => void;
  /**
   * Fired when a value is settled — the box toggled, or the field blurred — for callers that save
   * per control rather than per form. The value is handed over rather than read back from state:
   * the toggle sets and settles in one go, and by then the caller's own state has not caught up.
   */
  onCommit?: (value: string) => void;
  /** Shows a copy button when given. The caller copies and reports, so toasts stay its business. */
  onCopy?: () => void;
  disabled?: boolean;
};

export function AccessPasswordField({ enabled, value, onChange, onCommit, onCopy, disabled }: AccessPasswordFieldProps) {
  return (
    <>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => {
            const on = event.target.checked;
            // Turning it on with nothing set offers a value, so the quickest path is also one
            // nobody will be tempted to fill with a personal password.
            const next = on ? (value || suggestAccessPassword()) : "";
            onChange({ enabled: on, value: next });
            onCommit?.(next);
          }}
        />
        <span>입장 비밀번호 사용</span>
      </label>
      {enabled && (
        <label className="entry-code-block">
          <span>입장 비밀번호</span>
          <input
            className="entry-code-input"
            type="text"
            value={value}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            required
            aria-label="입장 비밀번호"
            onChange={(event) => onChange({ enabled: true, value: event.target.value })}
            onBlur={() => onCommit?.(value)}
          />
          {onCopy && (
            <button type="button" className="entry-code-copy" onClick={onCopy} disabled={disabled || !value}>
              <Copy size={15} /> 복사
            </button>
          )}
          <small>수강생에게 그대로 알려 주는 값입니다. 강사 본인 비밀번호는 쓰지 마세요.</small>
        </label>
      )}
    </>
  );
}
