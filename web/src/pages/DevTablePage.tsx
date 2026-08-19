import { useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchEmotes } from "../api/emotes";
import { useAuth } from "../auth/AuthProvider";
import { ToastHost } from "../components/ToastHost";
import { useStaticCss } from "../hooks/useStaticCss";
import { useToasts } from "../hooks/useToasts";
import type { TablePlayer, TableSnapshot } from "../api/table";
import { DevTableControls } from "../table/DevTableControls";
import { PokerTableShell } from "../table/PokerTableShell";
import { ActionPanel } from "../table/ActionPanel";
import { resetTablePipeline, seedInitialTableFx, setTableToastHandler } from "../table/tablePipeline";
import { useTableStore } from "../table/tableStore";
import { getOpponentPosLayout, hydrateSnapshot } from "../table/layout";
import { playSound } from "../lib/sounds";

const TABLE_CSS = ["/static/css/poker_table.css", "/static/css/table.css"] as const;

function buildLocalDevSnapshot(
  user: {
    user_id?: string;
    name?: string;
    avatar_url?: string;
    java_host?: string;
  },
  shop?: { catalog?: Array<{ emote_id: string; emoji?: string; name?: string; owned?: boolean; is_default?: boolean; style_class?: string; lottie_url?: string }> },
): TableSnapshot {
  const heroId = String(user.user_id || "17");
  const heroName = user.name || "DevHero";
  const avatar = user.avatar_url || "";
  const maxPlayers = 6;
  const layout = getOpponentPosLayout(maxPlayers);
  const panelSource = (shop?.catalog || []).filter((item) => item.is_default || item.owned);
  const panel_emotes: Array<{
    emote_id: string;
    emoji?: string;
    name?: string;
    style_class?: string;
    lottie_url?: string;
  }> = panelSource.length
    ? panelSource.map((item) => ({
        emote_id: item.emote_id,
        emoji: item.emoji,
        name: item.name,
        style_class: item.style_class,
        lottie_url: item.lottie_url,
      }))
    : [
        { emote_id: "fire", emoji: "🔥", name: "Огонь" },
        { emote_id: "cry", emoji: "😭", name: "Слёзы" },
        { emote_id: "angry", emoji: "🤬", name: "Злость" },
      ];
  const emotes_dict: Record<string, string> = {};
  const emotes_lottie_dict: Record<string, string> = {};
  panel_emotes.forEach((item) => {
    if (item.emoji) {
      emotes_dict[item.emote_id] = item.emoji;
    }
    if (item.lottie_url) {
      emotes_lottie_dict[item.emote_id] = item.lottie_url;
    }
  });
  const hero: TablePlayer = {
    user_id: heroId,
    name: heroName,
    seat_index: 0,
    chips: 1500,
    status: "ACTIVE",
    is_dealer: true,
    is_active_turn: true,
    round_contribution: 100,
    amount_to_call: 0,
    avatar_url: avatar,
  };
  const bots: TablePlayer[] = ["SiliVal", "Ivan99", "ProGamer", "Kicker", "Loser99"].map(
    (name, rel) => ({
      user_id: `opp_${rel}`,
      name,
      seat_index: rel + 1,
      chips: 1000 + rel * 350,
      status: "ACTIVE",
      is_dealer: false,
      is_active_turn: false,
      round_contribution: 50,
      cards: ["card_back", "card_back"],
      avatar_url: rel % 2 === 0 ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}` : "",
    }),
  );
  const players = [hero, ...bots];
  const opponent_seats_by_pos: Record<string, TablePlayer | null> = {};
  layout.forEach((pos, i) => {
    opponent_seats_by_pos[String(pos)] = bots[i] ?? null;
  });
  return hydrateSnapshot({
    table_id: "dev_table_spa",
    table_name: "SPA /dev-table",
    max_players: maxPlayers,
    seat_layout_opponents: layout,
    opponent_seats_by_pos,
    my_player: hero,
    my_cards: ["Ah", "Ac"],
    community_cards: ["As", "Kh", "10d"],
    game: {
      state: "FLOP",
      pot: 150,
      big_blind: 100,
      max_players: maxPlayers,
      community_cards: ["As", "Kh", "10d"],
      dealer_seat: 0,
      current_turn_seat: 0,
      time_to_act_ms: 15000,
      table_name: "SPA /dev-table",
      players,
    },
    user: { user_id: heroId, name: heroName, avatar_url: avatar, chips: 1500 },
    java_host: user.java_host,
    is_dev_table: true,
    panel_emotes,
    emotes_dict,
    emotes_lottie_dict,
  });
}

export function DevTablePage() {
  useStaticCss(TABLE_CSS, "table-page");
  const { user } = useAuth();
  const snapshot = useTableStore((s) => s.snapshot);
  const setSnapshot = useTableStore((s) => s.setSnapshot);
  const reset = useTableStore((s) => s.reset);
  const { toasts, showToast } = useToasts();

  useEffect(() => {
    let cancelled = false;
    reset();
    setTableToastHandler(showToast);
    void fetchEmotes()
      .then((shop) => {
        if (cancelled) {
          return;
        }
        const data = buildLocalDevSnapshot(user || {}, shop);
        setSnapshot(data);
        seedInitialTableFx(data);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        const data = buildLocalDevSnapshot(user || {});
        setSnapshot(data);
        seedInitialTableFx(data);
      });
    return () => {
      cancelled = true;
      setTableToastHandler(null);
      resetTablePipeline();
      reset();
    };
  }, [reset, setSnapshot, showToast, user?.user_id, user?.name, user?.avatar_url, user?.java_host]);

  if (!snapshot) {
    return (
      <div className="pp-scene pp-scene--table">
        <main className="page">
          <p className="muted">Загрузка /dev-table…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="pp-scene pp-scene--table">
      <div className="poker-room">
        <header className="table-header-bar table-topbar">
          <div className="table-topbar__info">
            <span className="table-topbar__label">Dev</span>
            <h1 className="table-title">{snapshot.table_name}</h1>
          </div>
          <Link to="/lobby" className="pp-btn pp-btn-ghost">
            ← Лобби
          </Link>
        </header>
        <PokerTableShell snapshot={snapshot} />
        <ActionPanel
          myPlayer={snapshot.my_player}
          currentTurnSeat={snapshot.game.current_turn_seat}
          bigBlind={snapshot.game.big_blind ?? 100}
          busy={false}
          onAction={(type) => {
            playSound(type === "FOLD" ? "fold" : "bet");
            showToast("success", "Dev", `Локальный ${type} (без ядра)`);
          }}
        />
        <div className="system-panel table-system-panel">
          <DevTableControls showToast={showToast} />
        </div>
      </div>
      <ToastHost toasts={toasts} className="table-toast-container" />
    </div>
  );
}