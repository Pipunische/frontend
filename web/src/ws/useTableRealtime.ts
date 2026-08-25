import { useEffect, useRef } from "react";
import type { IMessage } from "@stomp/stompjs";
import { fetchTableState } from "../api/table";
import { useTableStore } from "../table/tableStore";
import {
  applyHttpTableSnapshot,
  applyStompSnapshotPayload,
  dispatchTableEvent,
  setTableStompClient,
} from "../table/tablePipeline";
import { parseStompJson } from "./lobbyMessages";
import { usePokerWs } from "./PokerWsProvider";

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
  onNotAtTable,
}: Options) {
  const { client, connected, subscribe } = usePokerWs();
  const onNotAtTableRef = useRef(onNotAtTable);
  onNotAtTableRef.current = onNotAtTable;

  useEffect(() => {
    if (!enabled || !tableId || !connected || !client) {
      return;
    }

    let disposed = false;
    let pollTimer: number | null = null;
    let snapshotFallbackTimer: number | null = null;
    let firstSnapshot = true;

    function applyHttpSnapshot(reason: string) {
      if (disposed) {
        return Promise.resolve();
      }
      return fetchTableState(tableId)
        .then(async (data) => {
          if (disposed) {
            return;
          }
          await applyHttpTableSnapshot(data, reason);
        })
        .catch((err: unknown) => {
          if (disposed) {
            return;
          }
          const message = err instanceof Error ? err.message : "";
          if (message === "not_at_table" && !useTableStore.getState().logical?.my_player) {
            onNotAtTableRef.current();
          }
        });
    }

    setTableStompClient(client, tableId);

    const unsubPong = subscribe("/user/queue/pong", (message: IMessage) => {
      const data = parseStompJson(message.body);
      const sent = data && typeof data.clientTime === "number" ? data.clientTime : Date.now();
      useTableStore.getState().setPingMs(Math.max(0, Date.now() - sent));
    });

    const unsubSnap = subscribe("/user/queue/table_snapshot", (message: IMessage) => {
      if (snapshotFallbackTimer) {
        window.clearTimeout(snapshotFallbackTimer);
        snapshotFallbackTimer = null;
      }
      const data = parseStompJson(message.body);
      if (!data || disposed) {
        return;
      }
      console.log("📸 TABLE_SNAPSHOT от Java");
      void applyStompSnapshotPayload(data, !firstSnapshot);
      firstSnapshot = false;
    });

    const unsubTopic = subscribe(`/topic/table/${tableId}`, (message: IMessage) => {
      const data = parseStompJson(message.body);
      if (data && !disposed) {
        void dispatchTableEvent(data);
      }
    });

    snapshotFallbackTimer = window.setTimeout(() => {
      snapshotFallbackTimer = null;
      if (!disposed) {
        console.warn("📸 Snapshot не пришёл за 3 сек — HTTP fallback");
        void applyHttpSnapshot("snapshot-fallback");
      }
    }, SNAPSHOT_FALLBACK_MS);

    pollTimer = window.setInterval(() => {
      if (disposed || document.hidden) {
        return;
      }
      const state = useTableStore.getState().logical?.game.state;
      if (!state || !ACTIVE_HAND_STATES.includes(state)) {
        return;
      }
      if (client.connected) {
        return;
      }
      void applyHttpSnapshot("poll");
    }, SNAPSHOT_POLL_INTERVAL_MS);

    function onVisibility() {
      if (disposed || document.hidden) {
        return;
      }
      void applyHttpSnapshot("visibility");
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      if (snapshotFallbackTimer) {
        window.clearTimeout(snapshotFallbackTimer);
      }
      unsubPong();
      unsubSnap();
      unsubTopic();
      setTableStompClient(null, "");
      useTableStore.getState().setPingMs(9999);
    };
  }, [client, connected, enabled, subscribe, tableId]);
}
