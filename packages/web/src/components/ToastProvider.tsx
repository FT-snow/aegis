import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode, FocusEvent } from "react";
import "./toast.css";

type ToastKind = "success" | "info" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  leaving: boolean;
}

interface ToastTimer {
  timeout: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  remaining: number;
}

export interface ToastApi {
  success: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const toastLifetime = 5000;
const toastMotionDuration = 200;
const duplicateWindow = 2000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef<Toast[]>([]);
  const timers = useRef(new Map<number, ToastTimer>());
  const lastMessages = useRef(new Map<string, number>());
  const nextId = useRef(0);

  function updateToasts(next: Toast[]) {
    toastsRef.current = next;
    setToasts(next);
  }

  function clearTimer(id: number) {
    const timer = timers.current.get(id);
    if (timer?.timeout) clearTimeout(timer.timeout);
    timers.current.delete(id);
  }

  function removeToast(id: number) {
    clearTimer(id);
    updateToasts(toastsRef.current.filter((toast) => toast.id !== id));
  }

  function dismiss(id: number) {
    const toast = toastsRef.current.find((item) => item.id === id);
    if (!toast || toast.leaving) return;

    clearTimer(id);
    updateToasts(
      toastsRef.current.map((item) => (item.id === id ? { ...item, leaving: true } : item)),
    );
    const timeout = setTimeout(() => removeToast(id), toastMotionDuration);
    timers.current.set(id, { timeout, startedAt: 0, remaining: 0 });
  }

  function startTimer(id: number, remaining = toastLifetime) {
    const timer: ToastTimer = { timeout: null, startedAt: Date.now(), remaining };
    timer.timeout = setTimeout(() => dismiss(id), remaining);
    timers.current.set(id, timer);
  }

  function pauseTimer(id: number) {
    const timer = timers.current.get(id);
    if (!timer?.timeout) return;

    clearTimeout(timer.timeout);
    timer.timeout = null;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }

  function resumeTimer(id: number) {
    const toast = toastsRef.current.find((item) => item.id === id);
    const timer = timers.current.get(id);
    if (!toast || toast.leaving || !timer || timer.timeout) return;
    startTimer(id, timer.remaining);
  }

  function show(kind: ToastKind, message: string) {
    const now = Date.now();
    for (const [existingMessage, time] of lastMessages.current) {
      if (now - time >= duplicateWindow) lastMessages.current.delete(existingMessage);
    }
    const previous = lastMessages.current.get(message);
    if (previous !== undefined && now - previous < duplicateWindow) return;
    lastMessages.current.set(message, now);

    const toast: Toast = { id: ++nextId.current, kind, message, leaving: false };
    const next = [toast, ...toastsRef.current].slice(0, 3);
    const retainedIds = new Set(next.map((item) => item.id));
    for (const item of toastsRef.current) {
      if (!retainedIds.has(item.id)) clearTimer(item.id);
    }
    updateToasts(next);
    startTimer(toast.id);
  }

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        if (timer.timeout) clearTimeout(timer.timeout);
      }
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => show("success", message),
      info: (message) => show("info", message),
      error: (message) => show("error", message),
    }),
    [],
  );

  function leaveToast(
    event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>,
    id: number,
  ) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    resumeTimer(id);
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-label="Notifications" className="toast-viewport" role="region">
        {toasts.map((toast) => (
          <div
            aria-live={toast.kind === "error" ? "assertive" : "polite"}
            className={`toast toast--${toast.kind}${toast.leaving ? " toast--leaving" : ""}`}
            key={toast.id}
            onBlurCapture={(event) => leaveToast(event, toast.id)}
            onFocusCapture={() => pauseTimer(toast.id)}
            onPointerEnter={() => pauseTimer(toast.id)}
            onPointerLeave={(event) => leaveToast(event, toast.id)}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <ToastIcon kind={toast.kind} />
            <span className="toast__message">{toast.message}</span>
            <button
              aria-label="Dismiss notification"
              className="toast__close"
              onClick={() => dismiss(toast.id)}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within ToastProvider");
  return toast;
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  return (
    <svg aria-hidden="true" className="toast__icon" viewBox="0 0 16 16">
      {kind === "success" && <path d="m3 8 3.2 3.2L13 4.5" />}
      {kind === "info" && (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4M8 5h.01" />
        </>
      )}
      {kind === "error" && <path d="m4 4 8 8M12 4l-8 8" />}
    </svg>
  );
}
