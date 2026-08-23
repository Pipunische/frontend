import { useEffect, useRef } from "react";
import type { IMessage } from "@stomp/stompjs";
import { fetchLobbyState, type LobbyState } from "../api/lobby";
import { formatPokerAmount } from "../lib/format";
import {
  enrichLobbyTable,
  extractOnlineCount,
  looksLikeFullSnapshot,
  parseStompJson,
  patchTableCounts,
} from "./lobbyMessages";
import { usePokerWs } from "./PokerWsProvider";

const LOBBY_POLL_INTERVAL_MS = 30_000;
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
}: Options) {
  const { connected, subscribe } = usePokerWs();
  const onStateRef = useRef(onState);
  const onOnlineRef = useRef(onOnlineCount);
  onStateRef.current = onState;
  onOnlineRef.current = onOnlineCount;

  useEffect(() => {
    if (!enabled || !connected) {
      return;
    }

    let disposed = false;
    let pollTimer: number | null = null;
    let resyncTimer: number | null = null;
    let lastWsSync = 0;
    let downStreak = 0;

    function shouldSkipHttpResync() {
      return Date.now() - lastWsSync < LOBBY_WS_RESYNC_GRACE_MS;
    }

    async function applyHttpState(reason: string) {
      if (disposed || shouldSkipHttpResync()) {
        return;
      }
      const data = await fetchLobbyState();
      if (disposed) {
        return;
      }
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

    function handleLobbyMessage(message: IMessage) {
      const data = parseStompJson(message.body);
      if (!data || disposed) {
        return;
      }
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
          lastWsSync = Date.now();
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
        lastWsSync = Date.now();
        onStateRef.current((prev) => {
          if (!prev) {
            return prev;
          }
          return { ...prev, tables: patchTableCounts(prev.tables, rows) };
        });
        return;
      }
      if (data.table_id) {
        lastWsSync = Date.now();
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
      if (!data || disposed) {
        return;
      }
      const balance = Number(data.new_balance);
      if (Number.isNaN(balance)) {
        return;
      }
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

    const unsubs = [
      subscribe("/topic/lobby", handleLobbyMessage),
      subscribe("/user/queue/online", handleLobbyMessage),
      subscribe("/user/queue/wallet", handleWallet),
    ];

    resyncTimer = window.setTimeout(() => {
      void applyHttpState("post-load");
    }, LOBBY_POST_LOAD_RESYNC_MS);

    pollTimer = window.setInterval(() => {
      if (disposed || document.hidden) {
        return;
      }
      void applyHttpState("poll");
    }, LOBBY_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      if (resyncTimer) {
        window.clearTimeout(resyncTimer);
      }
      unsubs.forEach((unsub) => unsub());
    };
  }, [connected, enabled, javaHost, subscribe]);
}
