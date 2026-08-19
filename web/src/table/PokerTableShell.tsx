import { cardPngUrl } from "../lib/cards";
import type { TablePlayer, TableSnapshot } from "../api/table";
import { ChipFlyLayer } from "./ChipFlyLayer";
import { EmotePanel } from "./EmotePanel";
import { OccupiedSeatBody } from "./SeatBits";
import { cardFxClass } from "./showdown";
import { sendTableEmote } from "./tablePipeline";
import { useTableFxStore } from "./tableFx";

function opponentAtPos(
  snapshot: TableSnapshot,
  posNum: number,
): TablePlayer | null {
  const byPos = snapshot.opponent_seats_by_pos || {};
  return byPos[String(posNum)] ?? null;
}

export function PokerTableShell({ snapshot }: { snapshot: TableSnapshot }) {
  const fx = useTableFxStore((s) => s.fx);
  const layout = snapshot.seat_layout_opponents || [];
  const game = snapshot.game || {};
  const state = game.state || "WAITING_FOR_PLAYERS";
  const pot = fx.displayedPot ?? game.pot ?? 0;
  const board = snapshot.community_cards?.length
    ? snapshot.community_cards
    : game.community_cards || [];
  const hero = snapshot.my_player;
  const user = snapshot.user || {};
  const timeToActMs = game.time_to_act_ms ?? 0;
  const heroPlayer: TablePlayer = {
    user_id: String(hero?.user_id || user.user_id || ""),
    name: hero?.name || user.name || "",
    seat_index: hero?.seat_index ?? -1,
    chips: hero?.chips ?? Number(user.chips || 0),
    status: hero?.status,
    is_dealer: hero?.is_dealer,
    is_active_turn: hero?.is_active_turn,
    avatar_url: hero?.avatar_url || user.avatar_url,
    round_contribution: hero?.round_contribution,
  };

  const potClass =
    fx.potPulse === "collect"
      ? " pot-collect-pulse"
      : fx.potPulse === "payout"
        ? " pot-payout-pulse"
        : "";

  function seatExtras(userId: string) {
    const emote = fx.emotes.find((e) => e.userId === String(userId));
    return {
      hideBet: fx.hideBets,
      chipsOverride: fx.chipOverrides[String(userId)],
      badge: fx.badges.find((b) => b.userId === String(userId)) ?? null,
      emote: emote?.emoteId ?? null,
      emoteEmoji: emote ? snapshot.emotes_dict?.[emote.emoteId] : undefined,
      emoteLottie: emote ? snapshot.emotes_lottie_dict?.[emote.emoteId] : undefined,
      winnerPulse: fx.winnerPulseUserId === String(userId),
      cardClassFor: (card: string) =>
        cardFxClass(card, fx.dimCards, fx.rankTokens, fx.kickerTokens),
    };
  }

  return (
    <div
      className={`poker-table state-${state}`}
      data-max-players={snapshot.max_players || 10}
    >
      <ChipFlyLayer />
      <div className={`table-pot${potClass}`}>
        <span id="pot-value">{pot}</span> <span className="chip-icon" />
      </div>
      <div className="deck-pile">
        <img src="/static/cards/card_back.png" alt="" />
      </div>
      <div className="community-cards">
        {board.map((card, index) => {
          const highlight = cardFxClass(card, fx.dimCards, fx.rankTokens, fx.kickerTokens);
          const dealt = index >= fx.dealFrom && highlight === "card-static";
          return (
            <img
              key={`${card}-${index}`}
              src={cardPngUrl(card)}
              id={`card-${index + 1}`}
              className={`poker-card ${dealt ? "" : highlight}`.trim()}
              alt=""
            />
          );
        })}
      </div>

      {Array.from({ length: 9 }, (_, i) => i + 1).map((posNum) => {
        const isActive = layout.includes(posNum);
        const player = isActive ? opponentAtPos(snapshot, posNum) : null;
        const status = player ? (player.status || "active").toLowerCase() : "empty";
        const extras = player ? seatExtras(player.user_id) : null;
        return (
          <div
            key={posNum}
            className={`player-seat pos-${posNum}${isActive ? " seat-active" : ""}${extras?.winnerPulse ? " winner-payout-pulse" : ""} status-${status}`}
            data-seatindex={player?.seat_index ?? -1}
            data-userid={player?.user_id ?? ""}
          >
            {!isActive ? null : player ? (
              <OccupiedSeatBody
                player={player}
                cards={player.cards || []}
                handClass="opponent-hand"
                timeToActMs={timeToActMs}
                {...extras}
              />
            ) : (
              <span className="empty-seat-text">Свободно</span>
            )}
          </div>
        );
      })}

      <div
        className={`player-seat pos-hero seat-active${seatExtras(heroPlayer.user_id).winnerPulse ? " winner-payout-pulse" : ""} status-${(hero?.status || "empty").toLowerCase()}`}
        data-userid={heroPlayer.user_id}
        data-seatindex={heroPlayer.seat_index}
      >
        <OccupiedSeatBody
          player={heroPlayer}
          cards={snapshot.my_cards || []}
          handClass="my-hand"
          timeToActMs={timeToActMs}
          {...seatExtras(heroPlayer.user_id)}
        />
        <EmotePanel
          emotes={snapshot.panel_emotes || []}
          onSend={(emoteId) => sendTableEmote(emoteId, heroPlayer.user_id)}
        />
      </div>
    </div>
  );
}