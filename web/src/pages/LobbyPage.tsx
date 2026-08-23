import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchLobbyState, type LobbyState, type LobbyTable } from "../api/lobby";
import { createTable, joinTable, type CreateTablePayload } from "../api/tables";
import { useAuth } from "../auth/AuthProvider";
import { CreateTableModal } from "../components/lobby/CreateTableModal";
import { EmoteShopModal } from "../components/lobby/EmoteShopModal";
import { TableCard } from "../components/lobby/TableCard";
import { ToastHost } from "../components/ToastHost";
import { prefetchStaticCss, useStaticCss } from "../hooks/useStaticCss";
import { useToasts } from "../hooks/useToasts";
import { formatPokerAmount } from "../lib/format";
import { toastFromUnknown } from "../lib/toast";
import { useLobbyRealtime } from "../ws/useLobbyRealtime";
import "./LobbyPage.css";

const LOBBY_CSS = ["/static/css/lobby.css", "/static/css/modals.css"] as const;

export function LobbyPage() {
  useStaticCss(LOBBY_CSS);
  useEffect(() => {
    prefetchStaticCss(["/static/css/profile.css"]);
  }, []);
  const { user: sessionUser, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { toasts, showToast } = useToasts();
  const [state, setState] = useState<LobbyState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [onlineCount, setOnlineCount] = useState(0);
  const [walletPulse, setWalletPulse] = useState(false);

  const javaHost = state?.java_host || sessionUser?.java_host || "";
  const mockLobby = state?.token === "fake_token";

  useLobbyRealtime({
    enabled: !loading && !mockLobby && Boolean(javaHost),
    javaHost,
    onState: setState,
    onOnlineCount: setOnlineCount,
    onAuthLost: () => {
      navigate("/login?error=session_expired", { replace: true });
    },
  });

  const load = useCallback(async () => {
    const next = await fetchLobbyState();
    setState(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch((error) => {
      setLoading(false);
      const toast = toastFromUnknown(error);
      showToast("error", toast.errorType, toast.message);
    });
  }, [load, showToast]);

  useEffect(() => {
    const errorType = params.get("errorType");
    const message = params.get("message");
    if (errorType && message) {
      showToast("error", errorType, message);
      setParams({}, { replace: true });
    }
  }, [params, setParams, showToast]);

  const lobbyUser = state?.user;
  const wallet = Number(lobbyUser?.wallet_balance ?? sessionUser?.wallet_balance ?? 0);
  const name = lobbyUser?.name || sessionUser?.name || "";
  const avatar = lobbyUser?.avatar_url || sessionUser?.avatar_url || "";
  const walletLabel =
    lobbyUser?.wallet_balance_formatted || formatPokerAmount(wallet);
  const prevWalletRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevWalletRef.current === null) {
      prevWalletRef.current = wallet;
      return;
    }
    if (prevWalletRef.current === wallet) {
      return;
    }
    prevWalletRef.current = wallet;
    setWalletPulse(true);
    const timer = window.setTimeout(() => setWalletPulse(false), 500);
    return () => window.clearTimeout(timer);
  }, [wallet]);

  async function handleJoin(table: LobbyTable, chips: number) {
    let passcode: string | undefined;
    if (table.is_private) {
      const entered = window.prompt("🔒 Введите пароль для кастомного стола:");
      if (entered === null) {
        return;
      }
      if (entered.trim() === "") {
        window.alert("Пароль не может быть пустым!");
        return;
      }
      passcode = entered.trim();
    }

    try {
      const result = await joinTable(table.table_id, { chips, passcode });
      if (result.redirect) {
        navigate(result.redirect);
        return;
      }
      if (result.error) {
        showToast(
          "error",
          result.errorType || "JoinError",
          result.message || result.error,
        );
        return;
      }
      navigate(`/table/${table.table_id}`);
    } catch (error) {
      const toast = toastFromUnknown(error);
      showToast("error", toast.errorType, toast.message);
    }
  }

  async function handleCreate(payload: CreateTablePayload) {
    try {
      const result = await createTable(payload);
      if (result.redirect) {
        navigate(result.redirect);
        return;
      }
      if (result.error) {
        showToast(
          "error",
          result.errorType || "Error",
          result.detail || result.error,
        );
        return;
      }
    } catch (error) {
      const toast = toastFromUnknown(error);
      showToast("error", toast.errorType, toast.message);
    }
  }

  const handleShopWallet = useCallback(
    (next: number) => {
      setState((current) =>
        current
          ? {
              ...current,
              user: {
                ...current.user,
                wallet_balance: next,
                wallet_balance_formatted: formatPokerAmount(next),
              },
            }
          : current,
      );
      void refresh();
    },
    [refresh],
  );

  const tables = state?.tables ?? [];
  const down = Boolean(state?.is_server_down);

  return (
    <>
      <div className="pp-scene pp-scene--lobby">
        <header className="lobby-topbar">
          <div className="lobby-online" title="Игроков онлайн">
            <span className="lobby-online-dot" />
            <span id="online-count">{onlineCount}</span>
          </div>
          <div className="lobby-user">
            <div
              className={`lobby-wallet wallet-balance-display${walletPulse ? " lobby-wallet--pulse" : ""}`}
            >
              <span className="lobby-wallet-chip" aria-hidden="true">
                <span className="lobby-wallet-chip__disc lobby-wallet-chip__disc--back" />
                <span className="lobby-wallet-chip__disc lobby-wallet-chip__disc--front" />
              </span>
              <span className="lobby-wallet-amount">{walletLabel}</span>
            </div>
            <Link to="/profile" className="lobby-profile" title="Перейти в профиль">
              <div className="lobby-avatar">
                {avatar ? (
                  <img src={avatar} alt="" width={48} height={48} />
                ) : (
                  name.slice(0, 1).toUpperCase()
                )}
              </div>
              <span className="lobby-username">{name}</span>
            </Link>
            <button type="button" className="pp-btn pp-btn-ghost lobby-logout" onClick={() => void logout()}>
              Выйти
            </button>
          </div>
        </header>

        <main className="lobby-shell">
          <div className="lobby-toolbar">
            <div className="lobby-toolbar-actions">
              <button
                type="button"
                className="pp-btn pp-btn-purple lobby-create-btn"
                onClick={() => setCreateOpen(true)}
              >
                + Создать стол
              </button>
              <button
                type="button"
                className="pp-btn pp-btn-ghost lobby-emote-shop-btn"
                onClick={() => setShopOpen(true)}
              >
                🛒 Магазин эмодзи
              </button>
            </div>
            <h1 className="lobby-title">Выберите игровой стол</h1>
          </div>

          <div className="lobby-grid">
            {loading ? (
              <div className="lobby-alert lobby-alert--empty">
                <h2>Загрузка столов…</h2>
              </div>
            ) : down ? (
              <div className="lobby-alert lobby-alert--down">
                <h2>Казино на техобслуживании</h2>
                <p>Наши крупье ушли пересчитывать фишки. Вернитесь через пару минут.</p>
                <button
                  type="button"
                  className="pp-btn pp-btn-danger lobby-alert-btn"
                  onClick={() => void load()}
                >
                  Обновить
                </button>
              </div>
            ) : tables.length === 0 ? (
              <div className="lobby-alert lobby-alert--empty">
                <h2>Свободных столов пока нет</h2>
                <p>Администратор ещё не открыл новые столы. Подождите немного.</p>
                <button
                  type="button"
                  className="pp-btn pp-btn-primary lobby-alert-btn"
                  onClick={() => void load()}
                >
                  Проверить снова
                </button>
              </div>
            ) : (
              tables.map((table) => (
                <TableCard
                  key={table.table_id}
                  table={table}
                  walletBalance={wallet}
                  onJoin={(next, chips) => void handleJoin(next, chips)}
                />
              ))
            )}
          </div>

          <div className="lobby-footer-wrap">
            <Link to="/" className="lobby-back">
              ← Вернуться на главную
            </Link>
          </div>
        </main>
      </div>

      <CreateTableModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
      <EmoteShopModal
        open={shopOpen}
        onClose={() => setShopOpen(false)}
        walletBalance={wallet}
        isMock={mockLobby}
        showToast={showToast}
        onWalletChange={handleShopWallet}
      />
      <ToastHost toasts={toasts} />
    </>
  );
}
