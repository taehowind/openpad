"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";

export type ToastTone = "info" | "success" | "error" | "loading";

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  show: (message: string, tone?: ToastTone, duration?: number) => string;
  update: (id: string, message: string, tone?: ToastTone, duration?: number) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const schedule = useCallback((id: string, duration: number) => {
    const previous = timers.current.get(id);
    if (previous) window.clearTimeout(previous);
    timers.current.delete(id);
    if (duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
  }, [dismiss]);

  const show = useCallback((message: string, tone: ToastTone = "info", duration = tone === "loading" ? 0 : 3000) => {
    const id = crypto.randomUUID();
    setItems((current) => [...current.slice(-3), { id, message, tone }]);
    schedule(id, duration);
    return id;
  }, [schedule]);

  const update = useCallback((id: string, message: string, tone: ToastTone = "info", duration = tone === "loading" ? 0 : 3000) => {
    setItems((current) => current.map((item) => item.id === id ? { id, message, tone } : item));
    schedule(id, duration);
  }, [schedule]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  const value = useMemo(() => ({ show, update, dismiss }), [dismiss, show, update]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section className="toast-region" aria-label="진행 알림" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div className={`toast toast-${item.tone}`} role={item.tone === "error" ? "alert" : "status"} key={item.id}>
            <span className="toast-icon" aria-hidden="true">
              {item.tone === "loading" && <LoaderCircle className="toast-spinner" size={19} />}
              {item.tone === "success" && <CheckCircle2 size={19} />}
              {item.tone === "error" && <AlertCircle size={19} />}
              {item.tone === "info" && <Info size={19} />}
            </span>
            <p>{item.message}</p>
            {item.tone !== "loading" && <button type="button" aria-label="알림 닫기" onClick={() => dismiss(item.id)}><X size={16} /></button>}
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
