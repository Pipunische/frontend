import { useEffect, useRef } from "react";
import type { Client, IFrame, IMessage } from "@stomp/stompjs";
import { fetchLobbyState, type LobbyState } from "../api/lobby";
import { fetchSessionToken, logoutSession } from "../api/session";
import { formatPokerAmount } from "../lib/format";
import {
  createPokerStompClient,
  reconnectDelayMs,
} from "./stompFactory";
import {
  enrichLobbyTable,
  extractOnlineCount,
  looksLikeFullSnapshot,
  parseStompJson,
  patchTableCounts,
} from "./lobbyMessages";

const PING_INTERVAL_MS = 3000;
const PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2;
const LOBBY_POLL_INTERVAL_MS = 30_000;
const LOBBY_RESYNC_DELAY_MS = 500;
const LOBBY_POST_LOAD_RESYNC_MS = 700;
const LOBBY_WS_RESYNC_GRACE_MS = 4000;

type Options = {
  enabled: boolean;
  javaHost: string;
  onState: (updater: (prev: LobbyState | null) => LobbyState | null) => void;
  onOnlineCount: (count: number) => void;
  onAuthLost: () => void;
};

export function useLobbyRealtime({
  enabled,
  javaHost,
  onState,
  onOnlineCount,
  onAuthLost,
}: Options) {
  const onStateRef = useRef(onState);
  const onOnlineRef = useRef(onOnlineCount);
  const onAuthLostRef = useRef(onAuthLost);
  onStateRef.current = onState;
  onOnlineRef.current = onOnlineCount;
  onAuthLostRef.current = onAuthLost;

  useEffect(() => {
    if (!enabled || !javaHost) {
      return;
    }

    let disposed = false;
    let client: Client | null = null;
    let pingTimer: number | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let resyncTimer: number | null = null;
    let reconnectAttempt = 0;
    let reconnectScheduled = false;
    let firstConnect = true;
    let lastPong = 0;
    let lastWsSync = 0;
    let downStreak = 0;

    function markWsSync() {
      lastWsSync = Date.now();
    }

    function shouldSkipHttpResync() {
      return Date.now() - lastWsSync < LOBBY_WS_RESYNC_GRACE_MS;
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
      if (resyncTimer) {
        window.clearTimeout(resyncTimer);
        resyncTimer = null;
      }
    }

    function deactivateClient() {
      stopTimers();
      if (!client) {
        return;
      }
      const current = client;
      client = null;
      current.onWebSocketClose = () => {};
      current.onStompError = () => {};
      void current.deactivate();
    }

    async function applyHttpState(reason: string) {
      if (disposed || shouldSkipHttpResync()) {
        return;
      }
      const data = await fetchLobbyState();
      console.log(`🔄 HTTP resync лобби (${reason})`);
      onStateRef.current((prev) => {
        if (data.is_server_down) {
          downStreak += 1;
          const hasTables = (prev?.tables.length ?? 0) > 0;
          if (hasTables && downStreak < 2) {
            return prev;
          }
        } else {
          downStreak = 0;
        }
        return {
          ...(prev ?? data),
          ...data,
          user: { ...(prev?.user ?? {}), ...data.user },
        };
      });
    }

    function scheduleResync(delayMs: number, reason: string) {
      if (resyncTimer) {
        window.clearTimeout(resyncTimer);
      }
      resyncTimer = window.setTimeout(() => {
        resyncTimer = null;
        void applyHttpState(reason).catch((err) => {
          console.warn(`Resync лобби (${reason}) не удался:`, err);
        });
      }, delayMs);
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
        void applyHttpState("poll").catch((err) => {
          console.warn("Periodic lobby snapshot failed:", err);
        });
      }, LOBBY_POLL_INTERVAL_MS);
    }

    function handleLobbyMessage(message: IMessage) {
      const data = parseStompJson(message.body);
      if (!data) {
        return;
      }
      console.log("📢 Новости Лобби:", data);

      const online = extractOnlineCount(data);
      if (online !== null) {
        onOnlineRef.current(online);
      }
      if (data.event_type === "ONLINE_UPDATE") {
        return;
      }
      if (data.event_type !== "LOBBY_UPDATE") {
        return;
      }

      if (Array.isArray(data.tables) && data.tables.length > 0) {
        const rows = data.tables.filter(
          (row): row is Record<string, unknown> =>
            typeof row === "object" && row !== null,
        );
        if (looksLikeFullSnapshot(rows)) {
          markWsSync();
          downStreak = 0;
          onStateRef.current((prev) => ({
            ...(prev ?? {
              tables: [],
              is_server_down: false,
              java_host: javaHost,
              user: {},
            }),
            tables: rows.map(enrichLobbyTable),
            is_server_down: false,
          }));
          return;
        }
        markWsSync();
        onStateRef.current((prev) => {
          if (!prev) {
            return prev;
          }
          return { ...prev, tables: patchTableCounts(prev.tables, rows) };
        });
        return;
      }

      if (data.table_id) {
        markWsSync();
        onStateRef.current((prev) => {
          if (!prev) {
            return prev;
          }
          return { ...prev, tables: patchTableCounts(prev.tables, [data]) };
        });
      }
    }

    function handleWallet(message: IMessage) {
      const data = parseStompJson(message.body);
      if (!data) {
        return;
      }
      const balance = Number(data.new_balance);
      if (Number.isNaN(balance)) {
        return;
      }
      console.log("💰 Кошелек обновлен сервером!", data);
      onStateRef.current((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          user: {
            ...prev.user,
            wallet_balance: balance,
            wallet_balance_formatted: formatPokerAmount(balance),
          },
        };
      });
    }

    function subscribe(active: Client) {
      lastPong = Date.now();
      active.subscribe("/user/queue/pong", () => {
        lastPong = Date.now();
      });
      pingTimer = window.setInterval(() => {
        if (!active.connected) {
          return;
        }
        if (Date.now() - lastPong > PONG_TIMEOUT_MS) {
          console.warn("🛜 Pong timeout — принудительный реконнект лобби");
          scheduleReconnect("Соединение не отвечает (pong timeout)", true);
          return;
        }
        active.publish({
          destination: "/app/ping",
          body: JSON.stringify({ clientTime: Date.now() }),
        });
      }, PING_INTERVAL_MS);

      active.subscribe("/topic/lobby", handleLobbyMessage);
      active.subscribe("/user/queue/online", handleLobbyMessage);
      active.subscribe("/user/queue/wallet", handleWallet);
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
        `⏳ ${reason}. Переподключение лобби через ${delay} мс (попытка ${reconnectAttempt})...`,
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
          console.log("Без токена сокеты лобби не подключаем.");
          return;
        }
        onStateRef.current((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            user: { ...prev.user, wallet_balance: session.wallet_balance },
          };
        });

        deactivateClient();
        lastWsSync = 0;
        const next = createPokerStompClient(javaHost, session.token, {
          onConnect: (active) => {
            if (disposed) {
              return;
            }
            console.log("🔗 WebSocket лобби подключен.");
            reconnectAttempt = 0;
            reconnectScheduled = false;
            subscribe(active);
            const wasFirst = firstConnect;
            firstConnect = false;
            scheduleResync(
              wasFirst ? LOBBY_POST_LOAD_RESYNC_MS : LOBBY_RESYNC_DELAY_MS,
              wasFirst ? "post-load" : "reconnect",
            );
            startPolling();
          },
          onStompError: (error) => {
            console.error("Ошибка связи лобби:", error);
            if (isAuthError(error)) {
              void onAuthFailure();
              return;
            }
            scheduleReconnect("Ошибка WebSocket лобби");
          },
          onWebSocketClose: () => {
            if (disposed || reconnectScheduled) {
              return;
            }
            scheduleReconnect("Сокет лобби закрыт");
          },
        });
        client = next;
        next.activate();
      } catch (err) {
        console.error("Не удалось получить актуальный токен:", err);
        scheduleReconnect("Нет токена для STOMP");
      }
    }

    function onOnline() {
      if (disposed) {
        return;
      }
      if (!client?.connected) {
        console.log("🌐 Сеть восстановлена — быстрый реконнект лобби");
        scheduleReconnect("Сеть восстановлена (online)", true);
      }
    }

    function onVisibility() {
      if (disposed || document.hidden) {
        return;
      }
      if (!client?.connected) {
        console.log("👁️ Вкладка активна — reconnect лобби");
        scheduleReconnect("Вкладка снова активна", true);
        return;
      }
      if (!firstConnect) {
        scheduleResync(LOBBY_RESYNC_DELAY_MS, "visibility");
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
  }, [enabled, javaHost]);
}
