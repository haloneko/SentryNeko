/** In-app toast painted when the system refuses a notification. */

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../hooks/useI18n";
import { BACKEND_EVENTS, useTauriEvent } from "../hooks/useTauriEvent";
import type { NotificationFallbackPayload, NotificationKind } from "../types";
import toastStyles from "./ui/Toast.module.css";

interface Toast {
  id: number;
  kind: NotificationKind;
  /** Platform message, kept as a tooltip rather than shown as copy. */
  reason: string;
}

/** How long a toast stays on screen. */
const TOAST_LIFETIME_MS = 6000;

/** Subscribes to the fallback pushes and renders them above the page. */
export function ToastHost() {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  // Timers outlive the toasts they remove, so they are cleared when the host goes away.
  useEffect(
    () => () => {
      timers.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
    },
    [],
  );

  useTauriEvent<NotificationFallbackPayload>(BACKEND_EVENTS.notificationFallback, (payload) => {
    const id = nextId.current;
    nextId.current += 1;

    setToasts((current) => [...current, { id, kind: payload.kind, reason: payload.reason }]);
    timers.current.push(
      window.setTimeout(() => {
        dismiss(id);
      }, TOAST_LIFETIME_MS),
    );
  });

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={toastStyles.toastStack} role="status">
      {toasts.map((toast) => (
        <div className={toastStyles.toast} key={toast.id} title={toast.reason}>
          <p>{t(`notification.fallback.${toast.kind}`)}</p>
          <button
            aria-label={t("notification.dismiss")}
            className={toastStyles.toastDismiss}
            onClick={() => {
              dismiss(toast.id);
            }}
            type="button"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
