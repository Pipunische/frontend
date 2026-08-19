import type { TablePlayer, TableSnapshot } from "../api/table";
import {
  dispatchTableEvent,
  isTableFxBusy,
  resetShowdownPipelineFlags,
} from "./tablePipeline";
import { useTableStore } from "./tableStore";

const DEV_NEXT_STREET: Record<
  string,
  { previous_state: string; next_state: string; community_cards: string[] }
> = {
  FLOP: {
    previous_state: "PRE_FLOP",
    next_state: "TURN",
    community_cards: ["As", "Kh", "10d", "2c"],
  },
  TURN: {
    previous_state: "FLOP",
    next_state: "RIVER",
    community_cards: ["As", "Kh", "10d", "2c", "5s"],
  },
  RIVER: {
    previous_state: "TURN",
    next_state: "SHOWDOWN",
    community_cards: ["As", "Kh", "10d", "2c", "5s"],
  },
};

const DEV_SHOWDOWN_BOARD = ["AS", "KH", "10D", "2C", "5S"];

function contributions(players: TablePlayer[] | undefined) {
  return (players || [])
    .filter((p) => Number(p.round_contribution) > 0)
    .map((p) => ({ user_id: String(p.user_id), amount: Number(p.round_contribution) }));
}

function withZeroBets(players: TablePlayer[], nextTurn: number): TablePlayer[] {
  return players.map((p) => ({
    ...p,
    round_contribution: 0,
    is_active_turn: p.seat_index === nextTurn,
  }));
}

function addRoundBets(snapshot: TableSnapshot): TablePlayer[] {
  const heroId = String(snapshot.user?.user_id || snapshot.my_player?.user_id || "");
  return (snapshot.game.players || []).map((p) => {
    if (p.status && p.status !== "ACTIVE") {
      return { ...p, round_contribution: 0 };
    }
    return { ...p, round_contribution: String(p.user_id) === heroId ? 100 : 50 };
  });
}

export function DevTableControls({
  showToast,
}: {
  showToast: (type: "error" | "success" | "warning", errorType: string, message: string) => void;
}) {
  const snapshot = useTableStore((s) => s.logical);
  const setSnapshot = useTableStore((s) => s.setSnapshot);

  if (!snapshot?.is_dev_table) {
    return null;
  }

  function currentPlayers() {
    return snapshot?.game.players || [];
  }

  function simulateStreetEnd() {
    if (!snapshot) {
      return;
    }
    const config = DEV_NEXT_STREET[snapshot.game.state || ""];
    if (!config) {
      showToast("error", "Dev", `Нет следующей улицы для ${snapshot.game.state}`);
      return;
    }
    const contrib = contributions(currentPlayers());
    if (!contrib.length) {
      showToast("error", "Dev", "Нет ставок для сбора — нажми Reset ставки");
      return;
    }
    const collected = contrib.reduce((sum, c) => sum + c.amount, 0);
    const newPot = Number(snapshot.game.pot || 0) + collected;
    const nextTurnSeat = 1;
    void dispatchTableEvent({
      event_type: "STREET_END",
      previous_state: config.previous_state,
      state: config.next_state,
      pot: newPot,
      contributions: contrib,
      community_cards: config.community_cards,
      current_turn_seat: nextTurnSeat,
      time_to_act_ms: 15000,
    });
    window.setTimeout(() => {
      const players = withZeroBets(currentPlayers(), nextTurnSeat);
      void dispatchTableEvent({
        event_type: "TABLE_UPDATE",
        state: config.next_state,
        pot: newPot,
        big_blind: 100,
        community_cards: config.community_cards,
        dealer_seat: 0,
        current_turn_seat: nextTurnSeat,
        time_to_act_ms: 15000,
        players,
      });
      window.setTimeout(() => {
        const applyBets = () => {
          if (isTableFxBusy()) {
            window.setTimeout(applyBets, 200);
            return;
          }
          const latest = useTableStore.getState().logical;
          if (!latest) {
            return;
          }
          setSnapshot({
            ...latest,
            game: { ...latest.game, players: addRoundBets(latest) },
            my_player: latest.my_player
              ? { ...latest.my_player, round_contribution: 100 }
              : latest.my_player,
          });
        };
        applyBets();
      }, 800);
    }, 50);
  }

  function resetBets() {
    const latest = useTableStore.getState().logical;
    if (!latest) {
      return;
    }
    const players = addRoundBets(latest);
    const heroId = String(latest.user?.user_id || latest.my_player?.user_id || "");
    setSnapshot({
      ...latest,
      game: { ...latest.game, players },
      my_player: latest.my_player
        ? {
            ...latest.my_player,
            round_contribution: players.find((p) => String(p.user_id) === heroId)
              ?.round_contribution,
          }
        : latest.my_player,
    });
  }

  function buildShowdownUpdate(payouts?: Record<string, unknown>[]) {
    const latest = useTableStore.getState().logical;
    if (!latest) {
      return null;
    }
    const heroId = String(latest.user?.user_id || latest.my_player?.user_id || "");
    const oppId = String(
      (latest.game.players || []).find((p) => String(p.user_id) !== heroId)?.user_id || "opp_0",
    );
    const resolvedPayouts = payouts || [
      {
        user_id: heroId,
        amount: 400,
        hand_name: "STRAIGHT",
        rank_cards: DEV_SHOWDOWN_BOARD,
        kicker_cards: [],
        is_side_pot: false,
      },
    ];
    const showdownDetails = {
      rank_cards: DEV_SHOWDOWN_BOARD,
      kicker_cards: [],
      payouts: resolvedPayouts,
    };
    const payoutByUser: Record<string, number> = {};
    resolvedPayouts.forEach((p) => {
      const id = String(p.user_id);
      payoutByUser[id] = (payoutByUser[id] || 0) + Number(p.amount || 0);
    });
    const players = (latest.game.players || []).map((p) => {
      const id = String(p.user_id);
      const base = {
        ...p,
        round_contribution: 0,
        is_active_turn: false,
        chips: p.chips + (payoutByUser[id] || 0),
      };
      if (id === heroId) {
        return { ...base, cards: ["AH", "AC"] };
      }
      if (id === oppId) {
        return { ...base, cards: ["JH", "9D"] };
      }
      return base;
    });
    return {
      event_type: "TABLE_UPDATE",
      state: "SHOWDOWN",
      pot: 0,
      skip_animations: false,
      big_blind: 100,
      community_cards: DEV_SHOWDOWN_BOARD,
      dealer_seat: 0,
      current_turn_seat: -1,
      time_to_act_ms: 0,
      showdown_details: showdownDetails,
      players,
    };
  }

  function runShowdown(builder: () => Record<string, unknown> | null) {
    const latest = useTableStore.getState().logical;
    if (!latest) {
      return;
    }
    resetShowdownPipelineFlags();
    const contrib = contributions(latest.game.players);
    const collected = contrib.reduce((sum, c) => sum + c.amount, 0);
    const potAfter = contrib.length ? Number(latest.game.pot || 0) + collected : 400;
    void dispatchTableEvent({
      event_type: "STREET_END",
      previous_state: "RIVER",
      state: "SHOWDOWN",
      pot: potAfter,
      contributions: contrib,
      community_cards: DEV_SHOWDOWN_BOARD,
      current_turn_seat: -1,
      time_to_act_ms: 0,
    });
    window.setTimeout(() => {
      const update = builder();
      if (update) {
        void dispatchTableEvent(update);
      }
    }, 100);
  }

  return (
    <div id="dev-controls" className="dev-controls">
      <button type="button" className="btn-dev-action" onClick={simulateStreetEnd}>
        Test STREET_END
      </button>
      <button type="button" className="btn-dev-action btn-dev-secondary" onClick={simulateStreetEnd}>
        Test auto-collect
      </button>
      <button type="button" className="btn-dev-action btn-dev-secondary" onClick={resetBets}>
        Reset ставки
      </button>
      <button
        type="button"
        className="btn-dev-action btn-dev-secondary"
        onClick={() => runShowdown(() => buildShowdownUpdate())}
      >
        Test Showdown
      </button>
      <button
        type="button"
        className="btn-dev-action btn-dev-secondary"
        onClick={() => {
          const latest = useTableStore.getState().logical;
          const heroId = String(latest?.user?.user_id || latest?.my_player?.user_id || "");
          const oppId = String(
            (latest?.game.players || []).find((p) => String(p.user_id) !== heroId)?.user_id ||
              "opp_0",
          );
          runShowdown(() =>
            buildShowdownUpdate([
              {
                user_id: heroId,
                amount: 250,
                hand_name: "PAIR",
                rank_cards: ["AS", "AH", "AC"],
                kicker_cards: ["KH"],
                is_side_pot: false,
              },
              {
                user_id: oppId,
                amount: 150,
                hand_name: "HIGH_CARD",
                rank_cards: ["KH"],
                kicker_cards: ["JH"],
                is_side_pot: true,
              },
            ]),
          );
        }}
      >
        Test Split Pot
      </button>
    </div>
  );
}