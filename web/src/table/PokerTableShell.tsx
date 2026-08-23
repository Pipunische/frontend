import { cardPngUrl } from "../lib/cards";
import type { TablePlayer, TableSnapshot } from "../api/table";
import { DEFAULT_TURN_MS } from "./layout";
import { ChipFlyLayer } from "./ChipFlyLayer";
import { EmotePanel } from "./EmotePanel";
import { OccupiedSeatBody } from "./SeatBits";
import { cardFxClass } from "./showdown";
import { layoutRegistry } from "./layoutRegistry";
import { sendTableEmote } from "./tablePipeline";
import { useTableFxStore } from "./tableFx";

function opponentAtPos(
  snapshot: TableSnapshot,
  posNum: number,
): TablePlayer | null {
  const byPos = snapshot.opponent_seats_by_pos || {};
  return byPos[String(posNum)] ?? null;
}

export function PokerTableShell({
  snapshot,
  turnSeat,
  timeToActMs: timeToActProp,
}: {
  snapshot: TableSnapshot;
  turnSeat?: number;
  timeToActMs?: number;
}) {
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
  const activeTurn = Number(turnSeat ?? game.current_turn_seat ?? -1);
  const timeToActMs =
    activeTurn >= 0 ? (timeToActProp ?? game.time_to_act_ms ?? DEFAULT_TURN_MS) : 0;
  const withTurn = (player: TablePlayer): TablePlayer => ({
    ...player,
    is_active_turn: Number(player.seat_index) === activeTurn,
  });
  const heroPlayer: TablePlayer = withTurn({
    user_id: String(hero?.user_id || user.user_id || ""),
    name: hero?.name || user.name || "",
    seat_index: hero?.seat_index ?? -1,
    chips: hero?.chips ?? Number(user.chips || 0),
    status: hero?.status,
    is_dealer: hero?.is_dealer,
    is_active_turn: hero?.is_active_turn,
    avatar_url: hero?.avatar_url || user.avatar_url,
    round_contribution: hero?.round_contribution,
  });

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
      holeDealFrom: fx.holeDealFrom,
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
      <div
        className={`table-pot${potClass}`}
        ref={(el) => {
          layoutRegistry.setPot(el);
        }}
      >
        <span id="pot-value">{pot}</span> <span className="chip-icon" />
      </div>
      <div className="deck-pile">
        <img src="/static/cards/card_back.png" alt="" />
      </div>
      <div className="community-cards">
        {board.map((card, index) => {
          const extras = cardFxClass(card, fx.dimCards, fx.rankTokens, fx.kickerTokens);
          const animate = index >= fx.dealFrom && !extras;
          return (
            <img
              key={`${card}-${index}`}
              src={cardPngUrl(card)}
              id={`card-${index + 1}`}
              className={`poker-card ${animate ? "" : "card-static"} ${extras}`.trim()}
              alt=""
            />
          );
        })}
      </div>

      {Array.from({ length: 9 }, (_, i) => i + 1).map((posNum) => {
        const isActive = layout.includes(posNum);
        const player = isActive
          ? (() => {
              const raw = opponentAtPos(snapshot, posNum);
              return raw ? withTurn(raw) : null;
            })()
          : null;
        const status = player ? (player.status || "active").toLowerCase() : "empty";
        const extras = player ? seatExtras(player.user_id) : null;
        return (
          <div
            key={posNum}
            className={`player-seat pos-${posNum}${isActive ? " seat-active" : ""}${extras?.winnerPulse ? " winner-payout-pulse" : ""} status-${status}`}
            data-seatindex={player?.seat_index ?? -1}
            data-userid={player?.user_id ?? ""}
            ref={(el) => {
              if (player?.user_id) {
                layoutRegistry.setSeat(String(player.user_id), el);
              }
            }}
          >
            {!isActive ? null : player ? (
              <OccupiedSeatBody
                key={player.user_id}
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
        ref={(el) => {
          if (heroPlayer.user_id) {
            layoutRegistry.setSeat(String(heroPlayer.user_id), el);
          }
        }}
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