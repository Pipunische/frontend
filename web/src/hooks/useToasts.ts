import { useCallback, useState } from "react";
import type { ToastItem, ToastType } from "../lib/toast";

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (type: ToastType, errorType: string, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, type, errorType, message }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
      }, 4400);
    },
    [],
  );

  return { toasts, showToast };
}
