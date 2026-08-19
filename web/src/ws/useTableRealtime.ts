import { useEffect, useRef } from "react";
import type { Client, IFrame, IMessage } from "@stomp/stompjs";
import { fetchTableState } from "../api/table";
import { fetchSessionToken, logoutSession } from "../api/session";
import { useTableStore } from "../table/tableStore";
import {
  applyHttpTableSnapshot,
  applyStompSnapshotPayload,
  dispatchTableEvent,
  setTableStompClient,
} from "../table/tablePipeline";
import { parseStompJson } from "./lobbyMessages";
import {
  createPokerStompClient,
  reconnectDelayMs,
} from "./stompFactory";

const PING_INTERVAL_MS = 3000;
const PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2;
const SNAPSHOT_POLL_INTERVAL_MS = 30_000;
const SNAPSHOT_FALLBACK_MS = 3000;
const ACTIVE_HAND_STATES = [
  "PRE_FLOP",
  "FLOP",
  "TURN",
  "RIVER",
  "SHOWDOWN",
  "CLEANUP",
];

type Options = {
  enabled: boolean;
  tableId: string;
  javaHost: string;
  onAuthLost: () => void;
  onNotAtTable: () => void;
};

export function useTableRealtime({
  enabled,
  tableId,
  javaHost,
  onAuthLost,
  onNotAtTable,
}: Options) {
  const onAuthLostRef = useRef(onAuthLost);
  const onNotAtTableRef = useRef(onNotAtTable);
  onAuthLostRef.current = onAuthLost;
  onNotAtTableRef.current = onNotAtTable;

  useEffect(() => {
    if (!enabled || !javaHost || !tableId) {
      return;
    }

    let disposed = false;
    let client: Client | null = null;
    let pingTimer: number | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let snapshotFallbackTimer: number | null = null;
    let reconnectAttempt = 0;
    let reconnectScheduled = false;
    let firstConnect = true;
    let lastPong = 0;
    let subscribed = false;

    function setPing(ms: number) {
      useTableStore.getState().setPingMs(ms);
    }

    function applyHttpSnapshot(reason: string) {
      return fetchTableState(tableId)
        .then(async (data) => {
          if (disposed) {
            return;
          }
          await applyHttpTableSnapshot(data, reason);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "";
          if (message === "not_at_table" && !useTableStore.getState().logical?.my_player) {
            onNotAtTableRef.current();
            return;
          }
          throw err;
        });
    }

    function handleTableEvent(data: Record<string, unknown>) {
      void dispatchTableEvent(data);
    }

    function stopTimers() {
      if (pingTimer) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      if (snapshotFallbackTimer) {
        window.clearTimeout(snapshotFallbackTimer);
        snapshotFallbackTimer = null;
      }
    }

    function deactivateClient() {
      stopTimers();
      setPing(9999);
      setTableStompClient(null, "");
      subscribed = false;
      if (!client) {
        return;
      }
      const current = client;
      client = null;
      current.onWebSocketClose = () => {};
      current.onStompError = () => {};
      void current.deactivate();
    }

    function scheduleSnapshotFallback() {
      if (snapshotFallbackTimer) {
        window.clearTimeout(snapshotFallbackTimer);
      }
      snapshotFallbackTimer = window.setTimeout(() => {
        snapshotFallbackTimer = null;
        console.warn("📸 Snapshot не пришёл за 3 сек — HTTP fallback");
        void applyHttpSnapshot("snapshot-fallback").catch((err) => {
          console.error("HTTP fallback resync не удался:", err);
        });
      }, SNAPSHOT_FALLBACK_MS);
    }

    function startPolling() {
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      pollTimer = window.setInterval(() => {
        if (disposed || document.hidden) {
          return;
        }
        if (!client?.connected) {
          return;
        }
        const state = useTableStore.getState().logical?.game.state;
        if (!state || !ACTIVE_HAND_STATES.includes(state)) {
          return;
        }
        void applyHttpSnapshot("poll").catch((err) => {
          console.warn("Periodic snapshot failed:", err);
        });
      }, SNAPSHOT_POLL_INTERVAL_MS);
    }

    function subscribe(active: Client, isReconnect: boolean) {
      if (subscribed) {
        return;
      }
      subscribed = true;
      lastPong = Date.now();
      setTableStompClient(active, tableId);
      active.subscribe("/user/queue/pong", (message: IMessage) => {
        lastPong = Date.now();
        const data = parseStompJson(message.body);
        const sent = data && typeof data.clientTime === "number" ? data.clientTime : lastPong;
        setPing(Math.max(0, Date.now() - sent));
      });

      active.subscribe("/user/queue/table_snapshot", (message: IMessage) => {
        if (snapshotFallbackTimer) {
          window.clearTimeout(snapshotFallbackTimer);
          snapshotFallbackTimer = null;
        }
        const data = parseStompJson(message.body);
        if (!data) {
          return;
        }
        console.log("📸 TABLE_SNAPSHOT от Java");
        void applyStompSnapshotPayload(data, isReconnect);
      });

      active.subscribe(`/topic/table/${tableId}`, (message: IMessage) => {
        const data = parseStompJson(message.body);
        if (data) {
          handleTableEvent(data);
        }
      });

      pingTimer = window.setInterval(() => {
        if (!active.connected) {
          return;
        }
        if (Date.now() - lastPong > PONG_TIMEOUT_MS) {
          console.warn("🛜 Pong timeout — принудительный реконнект стола");
          scheduleReconnect("Соединение не отвечает (pong timeout)", true);
          return;
        }
        const sendTime = Date.now();
        active.publish({
          destination: "/app/ping",
          body: JSON.stringify({ clientTime: sendTime }),
        });
      }, PING_INTERVAL_MS);

      if (isReconnect) {
        scheduleSnapshotFallback();
      }
    }

    function scheduleReconnect(reason: string, fast = false) {
      if (disposed || reconnectScheduled) {
        return;
      }
      deactivateClient();
      const delay = reconnectDelayMs(reconnectAttempt, fast);
      reconnectAttempt += 1;
      reconnectScheduled = true;
      console.log(
        `⏳ ${reason}. Переподключение стола через ${delay} мс (попытка ${reconnectAttempt})...`,
      );
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        reconnectScheduled = false;
        void connect();
      }, delay);
    }

    async function onAuthFailure() {
      deactivateClient();
      try {
        await logoutSession();
      } finally {
        onAuthLostRef.current();
      }
    }

    function isAuthError(error: IFrame | string) {
      const text =
        typeof error === "string"
          ? error
          : `${error.headers["message"] ?? ""} ${error.body ?? ""}`;
      const lower = text.toLowerCase();
      return (
        lower.includes("unauthorized") ||
        lower.includes("401") ||
        lower.includes("access denied")
      );
    }

    async function connect() {
      if (disposed) {
        return;
      }
      try {
        const session = await fetchSessionToken();
        if (disposed) {
          return;
        }
        if (!session.token || session.token === "fake_token") {
          console.log("Без токена сокеты стола не подключаем.");
          return;
        }

        deactivateClient();
        const next = createPokerStompClient(javaHost, session.token, {
          onConnect: (active) => {
            if (disposed) {
              return;
            }
            console.log("🔗 WebSocket стол подключен.");
            reconnectAttempt = 0;
            reconnectScheduled = false;
            const isReconnect = !firstConnect;
            firstConnect = false;
            subscribe(active, isReconnect);
            startPolling();
          },
          onStompError: (error) => {
            console.error("Ошибка связи стола:", error);
            if (isAuthError(error)) {
              void onAuthFailure();
              return;
            }
            scheduleReconnect("Ошибка WebSocket");
          },
          onWebSocketClose: () => {
            if (disposed || reconnectScheduled) {
              return;
            }
            scheduleReconnect("Сокет стола закрыт");
          },
        });
        client = next;
        next.activate();
      } catch (err) {
        console.error("Не удалось получить токен стола:", err);
        scheduleReconnect("Нет токена для STOMP");
      }
    }

    function onOnline() {
      if (disposed) {
        return;
      }
      if (!client?.connected) {
        console.log("🌐 Сеть восстановлена — быстрый реконнект стола");
        scheduleReconnect("Сеть восстановлена (online)", true);
      }
    }

    function onVisibility() {
      if (disposed || document.hidden) {
        return;
      }
      if (!client?.connected) {
        console.log("👁️ Вкладка активна — reconnect стола");
        scheduleReconnect("Вкладка снова активна", true);
        return;
      }
      if (!firstConnect) {
        void applyHttpSnapshot("visibility").catch((err) => {
          console.warn("Soft resync при возврате на вкладку:", err);
        });
      }
    }

    void connect();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      deactivateClient();
    };
  }, [enabled, javaHost, tableId]);
}
