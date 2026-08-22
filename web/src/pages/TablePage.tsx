import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { fetchEmotes } from "../api/emotes";
import {
  fetchTableState,
  postTableAction,
  postTableLeave,
  postTableRebuy,
  type TableCommandResult,
} from "../api/table";
import { useAuth } from "../auth/AuthProvider";
import { ToastHost } from "../components/ToastHost";
import { useStaticCss } from "../hooks/useStaticCss";
import { useToasts } from "../hooks/useToasts";
import { toastFromUnknown } from "../lib/toast";
import { ActionPanel } from "../table/ActionPanel";
import { DevTableControls } from "../table/DevTableControls";
import { PingIndicator } from "../table/PingIndicator";
import { PokerTableShell } from "../table/PokerTableShell";
import { RebuyModal } from "../table/RebuyModal";
import { applyOwnedEmotes } from "../table/tableEmotes";
import {
  resetTablePipeline,
  seedInitialTableFx,
  setTableToastHandler,
} from "../table/tablePipeline";
import { useTableStore } from "../table/tableStore";
import { getOpponentPosLayout } from "../table/layout";
import { playSound } from "../lib/sounds";
import { useTableRealtime } from "../ws/useTableRealtime";

const TABLE_CSS = ["/static/css/poker_table.css", "/static/css/table.css"] as const;

function commandFailed(result: TableCommandResult): boolean {
  return result.error === true || (typeof result.error === "string" && Boolean(result.error));
}

export function TablePage() {
  useStaticCss(TABLE_CSS, "table-page");
  const { tableId } = useParams();
  const navigate = useNavigate();
  const { user: sessionUser } = useAuth();
  const snapshot = useTableStore((s) => s.displayed);
  const logical = useTableStore((s) => s.logical);
  const pingMs = useTableStore((s) => s.pingMs);
  const setSnapshot = useTableStore((s) => s.setSnapshot);
  const reset = useTableStore((s) => s.reset);
  const { toasts, showToast } = useToasts();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const leavingRef = useRef(false);

  const javaHost = snapshot?.java_host || sessionUser?.java_host || "";
  const mockTable = Boolean(snapshot?.is_dev_table);

  useTableRealtime({
    enabled: ready && !mockTable && Boolean(javaHost) && Boolean(tableId),
    tableId: tableId || "",
    javaHost,
    onAuthLost: () => {
      window.location.assign("/login?error=session_expired");
    },
    onNotAtTable: () => {
      navigate("/lobby", { replace: true });
    },
  });

  useEffect(() => {
    if (!tableId) {
      navigate("/lobby", { replace: true });
      return;
    }

    let cancelled = false;
    reset();
    resetTablePipeline();
    setReady(false);
    setError(null);
    void fetchTableState(tableId)
      .then((data) => {
        if (!cancelled) {
          seedInitialTableFx(data);
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const canPlayWithoutHttp =
          Boolean(tableId) && Boolean(sessionUser?.java_host || sessionUser?.user_id);
        if (
          canPlayWithoutHttp &&
          err instanceof ApiError &&
          (err.status === 403 || err.status === 503 || err.message === "not_at_table")
        ) {
          const uid = String(sessionUser?.user_id || "");
          const maxPlayers = 10;
          const fallback = {
            table_id: tableId,
            max_players: maxPlayers,
            seat_layout_opponents: getOpponentPosLayout(maxPlayers),
            opponent_seats_by_pos: {},
            my_player: {
              user_id: uid,
              name: sessionUser?.name || "",
              seat_index: -1,
              chips: Number(sessionUser?.wallet_balance || 0),
              avatar_url: sessionUser?.avatar_url || "",
            },
            my_cards: [],
            community_cards: [],
            game: { state: "WAITING_FOR_PLAYERS", players: [], max_players: maxPlayers },
            user: {
              user_id: uid,
              name: sessionUser?.name,
              avatar_url: sessionUser?.avatar_url,
            },
            java_host: sessionUser?.java_host,
          };
          setSnapshot(fallback);
          seedInitialTableFx(fallback);
          setReady(true);
          return;
        }
        if (err instanceof ApiError && (err.status === 403 || err.message === "not_at_table")) {
          navigate("/lobby", { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : "Не удалось загрузить стол");
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, reset, sessionUser, setSnapshot, tableId]);

  useEffect(() => {
    setTableToastHandler(showToast);
    return () => {
      setTableToastHandler(null);
      resetTablePipeline();
    };
  }, [showToast]);

  useEffect(() => {
    if (!ready || mockTable) {
      return;
    }
    let cancelled = false;
    const refreshEmotes = () => {
      void fetchEmotes()
        .then((shop) => {
          if (!cancelled) {
            applyOwnedEmotes(shop);
          }
        })
        .catch(() => {
          /* keep current panel if shop is briefly unavailable */
        });
    };
    refreshEmotes();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshEmotes();
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mockTable, ready, tableId]);

  const goFromCommand = useCallback(
    (result: TableCommandResult) => {
      const redirect = result.redirect;
      if (!redirect) {
        return false;
      }
      if (redirect.includes("session_expired")) {
        window.location.assign(redirect);
        return true;
      }
      navigate(redirect.startsWith("/") ? redirect : `/${redirect}`, { replace: true });
      return true;
    },
    [navigate],
  );

  const leaveTable = useCallback(
    async (force = false) => {
      if (!tableId || !snapshot) {
        return;
      }
      if (!force && !window.confirm("Вы уверены?")) {
        return;
      }
      if (leavingRef.current) {
        return;
      }
      leavingRef.current = true;
      const userId = String(
        logical?.user?.user_id ||
          snapshot.user?.user_id ||
          logical?.my_player?.user_id ||
          snapshot.my_player?.user_id ||
          "",
      );
      try {
        const result = await postTableLeave(tableId, userId);
        if (goFromCommand(result)) {
          return;
        }
        navigate("/lobby", { replace: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          window.location.assign(err.redirect || "/login?error=session_expired");
          return;
        }
        navigate("/lobby", { replace: true });
      }
    },
    [goFromCommand, logical, navigate, snapshot, tableId],
  );

  const sendAction = useCallback(
    async (type: string, amount: number) => {
      if (!tableId || !snapshot) {
        return;
      }
      if (mockTable) {
        playSound(type === "FOLD" ? "fold" : "bet");
      }
      setBusy(true);
      try {
        const result = await postTableAction(tableId, {
          user_id: String(
            logical?.user?.user_id ||
              snapshot.user?.user_id ||
              logical?.my_player?.user_id ||
              snapshot.my_player?.user_id ||
              "",
          ),
          name: String(
            logical?.user?.name ||
              snapshot.user?.name ||
              logical?.my_player?.name ||
              snapshot.my_player?.name ||
              "",
          ),
          type,
          amount,
        });
        if (goFromCommand(result)) {
          return;
        }
        if (commandFailed(result)) {
          showToast(
            "error",
            result.errorType || "Error",
            result.message || "Действие отклонено",
          );
        }
      } catch (err) {
        const toast = toastFromUnknown(err);
        showToast("error", toast.errorType, toast.message);
      } finally {
        setBusy(false);
      }
    },
    [goFromCommand, logical, mockTable, showToast, snapshot, tableId],
  );

  const sendRebuy = useCallback(
    async (amount: number) => {
      if (!tableId) {
        return;
      }
      setBusy(true);
      try {
        const result = await postTableRebuy(tableId, amount);
        if (goFromCommand(result)) {
          return;
        }
        if (commandFailed(result)) {
          showToast(
            "error",
            result.errorType || "Error",
            result.message || "Докупка отклонена",
          );
        } else {
          showToast("success", "Успех", "Докупка прошла успешно!");
        }
      } catch (err) {
        const toast = toastFromUnknown(err);
        showToast("error", toast.errorType, toast.message);
      } finally {
        setBusy(false);
      }
    },
    [goFromCommand, showToast, tableId],
  );

  if (error) {
    return (
      <div className="pp-scene pp-scene--table">
        <main className="page">
          <p className="muted">{error}</p>
          <Link to="/lobby">← В лобби</Link>
        </main>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="pp-scene pp-scene--table">
        <main className="page">
          <p className="muted">Загрузка стола…</p>
        </main>
      </div>
    );
  }

  const bigBlind = snapshot.game.big_blind ?? 100;

  return (
    <div className="pp-scene pp-scene--table">
      <div className="poker-room">
        <header className="table-header-bar table-topbar">
          <div className="table-topbar__info">
            <span className="table-topbar__label">Стол</span>
            <h1 className="table-title">{snapshot.table_name || snapshot.table_id}</h1>
          </div>
          <PingIndicator pingMs={pingMs} />
        </header>
        <PokerTableShell snapshot={snapshot} />
        <ActionPanel
          myPlayer={snapshot.my_player}
          currentTurnSeat={snapshot.game.current_turn_seat}
          bigBlind={bigBlind}
          busy={busy}
          onAction={sendAction}
        />
        <div className="system-panel table-system-panel">
          <button
            type="button"
            className="pp-btn pp-btn-ghost table-leave-btn btn-leave-table"
            disabled={busy}
            onClick={() => void leaveTable(false)}
          >
            Встать из-за стола
          </button>
          {mockTable ? <DevTableControls showToast={showToast} /> : null}
        </div>
      </div>
      <RebuyModal
        myPlayer={logical?.my_player ?? snapshot.my_player}
        bigBlind={bigBlind}
        busy={busy}
        onRebuy={sendRebuy}
        onLeave={() => void leaveTable(true)}
      />
      <ToastHost toasts={toasts} className="table-toast-container" />
    </div>
  );
}
