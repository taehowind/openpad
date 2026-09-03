"use client";

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
  /** Fired when the field loses focus, for callers that save per control rather than per form. */
  onCommit?: () => void;
  disabled?: boolean;
};

export function AccessPasswordField({ enabled, value, onChange, onCommit, disabled }: AccessPasswordFieldProps) {
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
            onChange({ enabled: on, value: on ? (value || suggestAccessPassword()) : "" });
            onCommit?.();
          }}
        />
        <span>입장 비밀번호 사용</span>
      </label>
      {enabled && (
        <label>
          <span>입장 비밀번호</span>
          <input
            type="text"
            value={value}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            required
            onChange={(event) => onChange({ enabled: true, value: event.target.value })}
            onBlur={() => onCommit?.()}
          />
          <small className="field-hint">수강생에게 그대로 알려 주는 값입니다. 강사 본인 비밀번호는 쓰지 마세요.</small>
        </label>
      )}
    </>
  );
}
