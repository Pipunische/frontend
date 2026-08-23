import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { Client, IFrame, IMessage, StompSubscription } from "@stomp/stompjs";
import { ApiError } from "../api/client";
import { fetchSessionToken, logoutSession } from "../api/session";
import { useAuth } from "../auth/AuthProvider";
import { createPokerStompClient, reconnectDelayMs } from "./stompFactory";

const PING_INTERVAL_MS = 3000;
const PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2;

export type StompHandler = (message: IMessage) => void;

type PokerWsContextValue = {
  connected: boolean;
  client: Client | null;
  subscribe: (destination: string, handler: StompHandler) => () => void;
  publish: (destination: string, body: string) => void;
};

const PokerWsContext = createContext<PokerWsContextValue | null>(null);

type PendingSub = { destination: string; handler: StompHandler };

export function PokerWsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const javaHost = user?.java_host || "";
  const enabled = Boolean(javaHost) && Boolean(user?.user_id);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);
  const pendingRef = useRef<PendingSub[]>([]);
  const liveRef = useRef<Map<StompHandler, StompSubscription>>(new Map());
  const pingTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectScheduledRef = useRef(false);
  const lastPongRef = useRef(0);

  const attachPending = useCallback((active: Client) => {
    for (const item of pendingRef.current) {
      if (liveRef.current.has(item.handler)) {
        continue;
      }
      liveRef.current.set(item.handler, active.subscribe(item.destination, item.handler));
    }
  }, []);

  const stopPing = useCallback(() => {
    if (pingTimerRef.current) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const startPing = useCallback((active: Client) => {
    stopPing();
    lastPongRef.current = Date.now();
    pingTimerRef.current = window.setInterval(() => {
      if (!active.connected) {
        return;
      }
      if (Date.now() - lastPongRef.current > PONG_TIMEOUT_MS) {
        console.warn("🛜 Pong timeout — реконнект общего STOMP");
        scheduleReconnectRef.current("Соединение не отвечает (pong timeout)", true);
        return;
      }
      active.publish({
        destination: "/app/ping",
        body: JSON.stringify({ clientTime: Date.now() }),
      });
    }, PING_INTERVAL_MS);
  }, [stopPing]);

  const deactivateGracefully = useCallback(async () => {
    stopPing();
    for (const sub of liveRef.current.values()) {
      try {
        sub.unsubscribe();
      } catch {
        /* already gone */
      }
    }
    liveRef.current.clear();
    setConnected(false);
    const current = clientRef.current;
    clientRef.current = null;
    if (!current) {
      return;
    }
    try {
      await current.deactivate();
    } catch {
      /* ignore */
    }
  }, [stopPing]);

  const scheduleReconnectRef = useRef<(reason: string, fast?: boolean) => void>(() => {});

  const connectRef = useRef<() => Promise<void>>(async () => {});

  scheduleReconnectRef.current = (reason: string, fast = false) => {
    if (disposedRef.current || reconnectScheduledRef.current) {
      return;
    }
    reconnectScheduledRef.current = true;
    void deactivateGracefully();
    const delay = reconnectDelayMs(reconnectAttemptRef.current, fast);
    reconnectAttemptRef.current += 1;
    console.log(`⏳ ${reason}. Общий STOMP через ${delay} мс...`);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      reconnectScheduledRef.current = false;
      void connectRef.current();
    }, delay);
  };

  connectRef.current = async () => {
    if (disposedRef.current || !javaHost) {
      return;
    }
    try {
      const session = await fetchSessionToken();
      if (disposedRef.current) {
        return;
      }
      if (!session.token || session.token === "fake_token") {
        return;
      }
      await deactivateGracefully();
      const next = createPokerStompClient(javaHost, session.token, {
        onConnect: (active) => {
          if (disposedRef.current) {
            return;
          }
          console.log("🔗 Общий WebSocket подключен.");
          reconnectAttemptRef.current = 0;
          reconnectScheduledRef.current = false;
          clientRef.current = active;
          active.subscribe("/user/queue/pong", () => {
            lastPongRef.current = Date.now();
          });
          attachPending(active);
          startPing(active);
          setConnected(true);
        },
        onStompError: (error) => {
          console.error("Ошибка общего STOMP:", error);
          const text =
            typeof error === "string"
              ? error
              : `${error.headers["message"] ?? ""} ${error.body ?? ""}`;
          const lower = text.toLowerCase();
          if (
            lower.includes("unauthorized") ||
            lower.includes("401") ||
            lower.includes("access denied")
          ) {
            void logoutSession().finally(() => {
              navigate("/login?error=session_expired", { replace: true });
            });
            return;
          }
          scheduleReconnectRef.current("Ошибка WebSocket");
        },
        onWebSocketClose: () => {
          setConnected(false);
          if (disposedRef.current || reconnectScheduledRef.current) {
            return;
          }
          scheduleReconnectRef.current("Сокет закрыт");
        },
      });
      clientRef.current = next;
      next.activate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login?error=session_expired", { replace: true });
        return;
      }
      console.error("Не удалось получить токен STOMP:", err);
      scheduleReconnectRef.current("Нет токена для STOMP");
    }
  };

  useEffect(() => {
    disposedRef.current = false;
    if (!enabled) {
      void deactivateGracefully();
      return;
    }
    void connectRef.current();
    const onOnline = () => {
      if (!clientRef.current?.connected) {
        scheduleReconnectRef.current("Сеть восстановлена (online)", true);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        return;
      }
      if (!clientRef.current?.connected) {
        scheduleReconnectRef.current("Вкладка снова активна", true);
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposedRef.current = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      void deactivateGracefully();
    };
  }, [deactivateGracefully, enabled, javaHost]);

  const subscribe = useCallback((destination: string, handler: StompHandler) => {
    const pongWrap =
      destination === "/user/queue/pong"
        ? (message: IMessage) => {
            lastPongRef.current = Date.now();
            handler(message);
          }
        : handler;
    pendingRef.current.push({ destination, handler: pongWrap });
    const active = clientRef.current;
    if (active?.connected) {
      liveRef.current.set(pongWrap, active.subscribe(destination, pongWrap));
    }
    return () => {
      pendingRef.current = pendingRef.current.filter((item) => item.handler !== pongWrap);
      const live = liveRef.current.get(pongWrap);
      if (live) {
        try {
          live.unsubscribe();
        } catch {
          /* ignore */
        }
        liveRef.current.delete(pongWrap);
      }
    };
  }, []);

  const publish = useCallback((destination: string, body: string) => {
    const active = clientRef.current;
    if (!active?.connected) {
      return;
    }
    active.publish({ destination, body });
  }, []);

  const value = useMemo(
    () => ({
      connected,
      client: clientRef.current,
      subscribe,
      publish,
    }),
    [connected, publish, subscribe],
  );

  return <PokerWsContext.Provider value={value}>{children}</PokerWsContext.Provider>;
}

export function usePokerWs() {
  const context = useContext(PokerWsContext);
  if (!context) {
    throw new Error("usePokerWs must be used within PokerWsProvider");
  }
  return context;
}

export function isAuthStompError(error: IFrame | string) {
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
