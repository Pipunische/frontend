import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
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
import {
  resetTablePipeline,
  seedInitialTableFx,
  setTableToastHandler,
} from "../table/tablePipeline";
import { useTableStore } from "../table/tableStore";
import { playSound } from "../lib/sounds";
import { useTableRealtime } from "../ws/useTableRealtime";

const TABLE_CSS = [
  "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap",
  "/static/css/theme.css",
  "/static/css/poker_table.css",
  "/static/css/table.css",
] as const;

function commandFailed(result: TableCommandResult): boolean {
  return result.error === true || (typeof result.error === "string" && Boolean(result.error));
}

export function TablePage() {
  useStaticCss(TABLE_CSS, "table-page");
  const { tableId } = useParams();
  const navigate = useNavigate();
  const { user: sessionUser } = useAuth();
  const snapshot = useTableStore((s) => s.snapshot);
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
    setReady(false);
    setError(null);
    void fetchTableState(tableId)
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
          seedInitialTableFx(data);
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
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
  }, [navigate, reset, setSnapshot, tableId]);

  useEffect(() => {
    setTableToastHandler(showToast);
    return () => {
      setTableToastHandler(null);
      resetTablePipeline();
    };
  }, [showToast]);

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
      const userId = String(snapshot.user?.user_id || snapshot.my_player?.user_id || "");
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
    [goFromCommand, navigate, snapshot, tableId],
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
          user_id: String(snapshot.user?.user_id || snapshot.my_player?.user_id || ""),
          name: String(snapshot.user?.name || snapshot.my_player?.name || ""),
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
    [goFromCommand, mockTable, showToast, snapshot, tableId],
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
        myPlayer={snapshot.my_player}
        bigBlind={bigBlind}
        busy={busy}
        onRebuy={sendRebuy}
        onLeave={() => void leaveTable(true)}
      />
      <ToastHost toasts={toasts} className="table-toast-container" />
    </div>
  );
}
