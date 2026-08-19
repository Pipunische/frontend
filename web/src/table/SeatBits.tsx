import { useLayoutEffect, useRef, useState } from "react";
import { cardPngUrl } from "../lib/cards";
import type { TablePlayer } from "../api/table";
import { LottieMount } from "./LottieMount";
import type { ShowdownBadge } from "./showdown";

export function SeatAvatar({ url, name }: { url?: string; name: string }) {
  const letter = (name || "?").slice(0, 1).toUpperCase();
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return <div className="seat-avatar-default">{letter}</div>;
  }
  return (
    <img
      src={url}
      className="seat-avatar"
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

export function TimerRing({ active, durationMs }: { active: boolean; durationMs: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circleRef = useRef<SVGCircleElement>(null);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const circle = circleRef.current;
    if (!svg || !circle) {
      return;
    }

    const timeouts: number[] = [];
    svg.style.transition = "none";
    svg.style.opacity = "0";
    circle.style.transition = "none";
    circle.style.strokeDashoffset = "0";
    circle.style.stroke = "#2ecc71";

    if (!active || durationMs <= 0) {
      return () => timeouts.forEach((id) => window.clearTimeout(id));
    }

    const maxOffset = 226;
    const totalDurationMs = 15000;
    const timeLeft = Math.min(durationMs, totalDurationMs);
    const spentTime = totalDurationMs - timeLeft;
    const startOffset = (spentTime / totalDurationMs) * maxOffset;

    if (timeLeft <= 5000) {
      circle.style.stroke = "#e74c3c";
    } else if (timeLeft <= totalDurationMs / 2) {
      circle.style.stroke = "#f1c40f";
    } else {
      circle.style.stroke = "#2ecc71";
    }

    svg.style.transition = "opacity 0.3s ease";
    svg.style.opacity = "1";
    circle.style.strokeDashoffset = String(startOffset);

    timeouts.push(
      window.setTimeout(() => {
        circle.style.transition = `stroke-dashoffset ${timeLeft}ms linear, stroke 0.3s ease`;
        circle.style.strokeDashoffset = "226";
      }, 50),
    );

    if (timeLeft > 5000) {
      const timeToYellow = timeLeft - totalDurationMs / 2;
      const timeToRed = timeLeft - 5000;
      if (timeToYellow > 0) {
        timeouts.push(
          window.setTimeout(() => {
            if (svg.style.opacity === "1") {
              circle.style.stroke = "#f1c40f";
            }
          }, timeToYellow),
        );
      }
      timeouts.push(
        window.setTimeout(() => {
          if (svg.style.opacity === "1") {
            circle.style.stroke = "#e74c3c";
          }
        }, timeToRed),
      );
    }

    return () => timeouts.forEach((id) => window.clearTimeout(id));
  }, [active, durationMs]);

  return (
    <svg ref={svgRef} className="timer-svg" viewBox="0 0 80 80">
      <circle className="timer-bg" cx="40" cy="40" r="36" />
      <circle ref={circleRef} className="timer-progress" cx="40" cy="40" r="36" />
    </svg>
  );
}

export function OccupiedSeatBody({
  player,
  cards,
  handClass,
  timeToActMs = 0,
  cardClassFor,
  hideBet = false,
  chipsOverride,
  badge,
  emote,
  emoteEmoji,
  emoteLottie,
  winnerPulse = false,
}: {
  player: TablePlayer;
  cards: string[];
  handClass: "opponent-hand" | "my-hand";
  timeToActMs?: number;
  cardClassFor?: (card: string, index: number) => string;
  hideBet?: boolean;
  chipsOverride?: number;
  badge?: ShowdownBadge | null;
  emote?: string | null;
  emoteEmoji?: string;
  emoteLottie?: string;
  winnerPulse?: boolean;
}) {
  const chips = chipsOverride ?? player.chips;
  const bet = Number(player.round_contribution || 0);
  return (
    <>
      <div className={handClass}>
        {cards.map((card, index) => (
          <img
            key={`${card}-${index}`}
            src={cardPngUrl(card)}
            className={`hand-card ${cardClassFor ? cardClassFor(card, index) : "card-static"}`}
            alt=""
          />
        ))}
      </div>
      {player.is_dealer ? <div className="dealer-button">D</div> : null}
      <div className="avatar-timer-wrap">
        <TimerRing active={Boolean(player.is_active_turn)} durationMs={timeToActMs} />
        <SeatAvatar url={player.avatar_url} name={player.name} />
      </div>
      <div className={`seat-info-badge${winnerPulse ? " winner-payout-pulse" : ""}`}>
        <span className={`player-name${player.is_active_turn ? " active-turn" : ""}`}>
          {player.name}
        </span>
        <span className="player-chips">
          {chips} <span className="chip-icon" />
        </span>
      </div>
      {!hideBet && bet > 0 ? (
        <div className="player-bet">
          <div className="chip-icon" />
          {bet}
        </div>
      ) : null}
      {badge ? (
        <div className="hand-name-badge">
          <span className="badge-inner">
            <span className="badge-label">{badge.hand}</span>
            <span className="badge-payout">
              <span className="badge-payout-paren">(</span>
              <span className="badge-payout-amount">+{badge.amountLabel}</span>
              <span className="chip-icon badge-payout-chip" />
              <span className="badge-payout-paren">)</span>
            </span>
          </span>
        </div>
      ) : null}
      {emote ? (
        emoteLottie ? (
          <div className="player-emote player-emote--lottie">
            <LottieMount url={emoteLottie} className="player-emote__lottie" />
          </div>
        ) : (
          <div className="player-emote">{emoteEmoji || "💬"}</div>
        )
      ) : null}
    </>
  );
}
