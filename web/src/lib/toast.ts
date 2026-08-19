import { ApiError } from "../api/client";

const TOAST_TITLES: Record<string, string> = {
  TableFullException: "Стол заполнен",
  ChipAmountException: "Ошибка фишек",
  PlayerAlreadyJoinedException: "Вы уже за столом",
  CoreUnavailable: "Ядро недоступно",
  JoinError: "Ошибка посадки",
  IllegalRaiseException: "Ошибка при поднятия ставки",
  IllegalCallException: "Ошибка при уравнивании ставки",
  IllegalCheckException: "Ошибка при пропуске хода",
  NotYourTurnException: "Не ваш ход",
  EmoteRejected: "Эмот отклонён",
  InsufficientFunds: "Недостаточно фишек",
  AlreadyOwned: "Уже куплено",
  PurchaseFailed: "Покупка не удалась",
  PurchaseSuccess: "Покупка",
  ShopError: "Магазин",
  InvalidFile: "Файл",
  UploadRejected: "Аватар отклонён",
};

export type ToastType = "error" | "success" | "warning";

export type ToastItem = {
  id: number;
  type: ToastType;
  errorType: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toastTitle(errorType: string): string {
  return TOAST_TITLES[errorType] || errorType || "Уведомление";
}

export function toastFromUnknown(error: unknown): {
  errorType: string;
  message: string;
} {
  if (error instanceof ApiError && isRecord(error.payload)) {
    const payload = error.payload;
    const errorType =
      typeof payload.errorType === "string" ? payload.errorType : "Error";
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : error.message;
    return { errorType, message };
  }
  if (error instanceof Error) {
    return { errorType: "Error", message: error.message };
  }
  return { errorType: "Error", message: "Ошибка связи с сервером" };
}
