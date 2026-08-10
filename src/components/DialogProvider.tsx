"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Trash2, X } from "lucide-react";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type PromptOptions = {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
  multiline?: boolean;
  required?: boolean;
};

type DialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

type ConfirmState = ConfirmOptions & { kind: "confirm"; resolve: (value: boolean) => void };
type PromptState = PromptOptions & { kind: "prompt"; resolve: (value: string | null) => void };
type DialogState = ConfirmState | PromptState;

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setDialog({ kind: "confirm", ...options, resolve }));
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    setValue(options.defaultValue ?? "");
    return new Promise<string | null>((resolve) => setDialog({ kind: "prompt", ...options, resolve }));
  }, []);

  const close = useCallback((result: boolean | string | null) => {
    setDialog((current) => {
      if (current) {
        if (current.kind === "confirm") current.resolve(result === true);
        else current.resolve(typeof result === "string" ? result : null);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(dialog.kind === "confirm" ? false : null); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [dialog, close]);

  const submitPrompt = () => {
    if (!dialog || dialog.kind !== "prompt") return;
    const trimmed = value.trim();
    if (dialog.required !== false && !trimmed) return;
    close(trimmed);
  };

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(dialog.kind === "confirm" ? false : null); }}
        >
          <div className="modal-card dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
            {dialog.kind === "confirm" && dialog.tone === "danger" && (
              <span className="dialog-icon dialog-icon-danger" aria-hidden="true"><AlertTriangle size={22} /></span>
            )}
            <h2 id="dialog-title">{dialog.title}</h2>
            {dialog.message && <p>{dialog.message}</p>}

            {dialog.kind === "prompt" && (
              <label className="dialog-field">
                {dialog.label && <span>{dialog.label}</span>}
                {dialog.multiline ? (
                  <textarea
                    ref={inputRef}
                    value={value}
                    rows={3}
                    maxLength={dialog.maxLength ?? 500}
                    placeholder={dialog.placeholder}
                    onChange={(event) => setValue(event.target.value)}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    value={value}
                    maxLength={dialog.maxLength ?? 120}
                    placeholder={dialog.placeholder}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submitPrompt(); } }}
                  />
                )}
              </label>
            )}

            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => close(dialog.kind === "confirm" ? false : null)}>
                {dialog.cancelLabel ?? "취소"}
              </button>
              {dialog.kind === "confirm" ? (
                <button
                  type="button"
                  className={dialog.tone === "danger" ? "primary-button compact danger-button" : "primary-button compact"}
                  onClick={() => close(true)}
                >
                  {dialog.tone === "danger" ? <Trash2 size={16} /> : <Check size={16} />}
                  {dialog.confirmLabel ?? "확인"}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button compact"
                  disabled={dialog.required !== false && !value.trim()}
                  onClick={submitPrompt}
                >
                  <Check size={16} /> {dialog.confirmLabel ?? "확인"}
                </button>
              )}
            </div>

            <button type="button" className="modal-close" aria-label="닫기" onClick={() => close(dialog.kind === "confirm" ? false : null)}><X size={18} /></button>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const value = useContext(DialogContext);
  if (!value) throw new Error("useDialog must be used inside DialogProvider");
  return value;
}
