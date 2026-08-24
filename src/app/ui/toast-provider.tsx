"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastTone = "loading" | "success" | "error" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number | null;
  progress?: number | null;
};

type ToastItem = Omit<ToastInput, "title" | "tone" | "duration"> & {
  title: string;
  tone: ToastTone;
  duration: number | null;
  id: string;
  exiting: boolean;
  updatedAt: number;
};

type ToastContextValue = {
  showToast: (input: ToastInput) => string;
  updateToast: (id: string, input: Partial<ToastInput>) => void;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const defaultDurations: Record<ToastTone, number | null> = {
  loading: null,
  success: 5_000,
  error: null,
  info: 6_000,
};

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === "loading") {
    return <span aria-hidden="true" className="smartToastSpinner" />;
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {tone === "success" ? <path d="m6.5 12.5 3.4 3.4 7.8-8" /> : null}
      {tone === "error" ? (
        <>
          <path d="M12 7.4v5.8" />
          <path d="M12 16.8h.01" />
        </>
      ) : null}
      {tone === "info" ? (
        <>
          <path d="M12 10.6v6" />
          <path d="M12 7.2h.01" />
        </>
      ) : null}
    </svg>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const sequence = useRef(0);
  const removalTimers = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, exiting: true } : toast,
      ),
    );
    const existingTimer = removalTimers.current.get(id);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      removalTimers.current.delete(id);
    }, 240);
    removalTimers.current.set(id, timer);
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    sequence.current += 1;
    const tone = input.tone ?? "info";
    const id = `toast-${Date.now()}-${sequence.current}`;
    const item: ToastItem = {
      ...input,
      id,
      tone,
      duration:
        input.duration === undefined ? defaultDurations[tone] : input.duration,
      exiting: false,
      updatedAt: Date.now(),
    };
    setToasts((current) => [...current, item].slice(-4));
    return id;
  }, []);

  const updateToast = useCallback((id: string, input: Partial<ToastInput>) => {
    setToasts((current) =>
      current.map((toast) => {
        if (toast.id !== id) return toast;
        const tone = input.tone ?? toast.tone;
        const duration =
          input.duration !== undefined
            ? input.duration
            : input.tone && input.tone !== toast.tone
              ? defaultDurations[tone]
              : toast.duration;
        return {
          ...toast,
          ...input,
          tone,
          duration,
          exiting: false,
          updatedAt: Date.now(),
        };
      }),
    );
  }, []);

  useEffect(() => {
    const timers = toasts.flatMap((toast) => {
      if (toast.exiting || toast.duration === null || toast.duration <= 0) {
        return [];
      }
      return [window.setTimeout(() => dismissToast(toast.id), toast.duration)];
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissToast, toasts]);

  useEffect(
    () => () => {
      for (const timer of removalTimers.current.values()) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ dismissToast, showToast, updateToast }),
    [dismissToast, showToast, updateToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Thông báo hệ thống"
        aria-live="polite"
        className="smartToastViewport"
      >
        {toasts.map((toast) => (
          <article
            className={`smartToast is-${toast.tone} ${toast.exiting ? "isExiting" : ""}`}
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <span className="smartToastIcon">
              <ToastIcon tone={toast.tone} />
            </span>
            <div className="smartToastContent">
              <strong>{toast.title}</strong>
              {toast.description ? <p>{toast.description}</p> : null}
              {toast.tone === "loading" ? (
                <span className="smartToastProgress" aria-hidden="true">
                  <i
                    className={toast.progress == null ? "isIndeterminate" : ""}
                    style={
                      toast.progress == null
                        ? undefined
                        : {
                            transform: `scaleX(${Math.max(0, Math.min(1, toast.progress))})`,
                          }
                    }
                  />
                </span>
              ) : null}
            </div>
            {toast.tone !== "loading" ? (
              <button
                aria-label="Đóng thông báo"
                className="smartToastClose"
                onClick={() => dismissToast(toast.id)}
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                  <path d="m6 6 8 8M14 6l-8 8" />
                </svg>
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast phải được sử dụng bên trong ToastProvider.");
  }
  return context;
}
