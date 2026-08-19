import { useEffect, useState } from "react";
import { toastTitle, type ToastItem } from "../lib/toast";

export function ToastHost({
  toasts,
  className = "lobby-toast-container",
}: {
  toasts: ToastItem[];
  className?: string;
}) {
  return (
    <div id="toast-container" className={`toast-container ${className}`}>
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), 10);
    return () => window.clearTimeout(id);
  }, []);

  const colorClass =
    toast.type === "error"
      ? "toast-error"
      : toast.type === "success"
        ? "toast-success"
        : "toast-warning";
  const icon =
    toast.type === "error" ? "❌" : toast.type === "success" ? "✅" : "⚠️";

  return (
    <div className={`poker-toast ${colorClass}${shown ? " show" : ""}`}>
      <div className="toast-icon">{icon}</div>
      <div className="toast-content">
        <span className="toast-title">{toastTitle(toast.errorType)}</span>
        <span>{toast.message}</span>
      </div>
    </div>
  );
}
