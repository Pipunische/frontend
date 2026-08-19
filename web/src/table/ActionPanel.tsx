import { useEffect, useState } from "react";
import type { TablePlayer } from "../api/table";

type Props = {
  myPlayer: TablePlayer | null;
  currentTurnSeat?: number;
  bigBlind: number;
  busy: boolean;
  onAction: (type: string, amount: number) => void;
};

export function ActionPanel({
  myPlayer,
  currentTurnSeat,
  bigBlind,
  busy,
  onAction,
}: Props) {
  const toCall = myPlayer?.amount_to_call || 0;
  const myChips = myPlayer?.chips || 0;
  const myContribution = myPlayer?.round_contribution || 0;
  const minRaise = myContribution + toCall + Math.max(bigBlind, toCall);
  const totalMoneyForRound = myChips + myContribution;
  const isCallAllIn = toCall >= myChips;
  const canMakeLegalRaise = totalMoneyForRound >= minRaise && myChips > toCall;

  const [raiseAmount, setRaiseAmount] = useState(minRaise);

  const status = (myPlayer?.status || "").toUpperCase().replace(/\s+/g, "_");
  const outOfHand =
    status === "SITTING_OUT" || status === "FOLDED" || status === "ALL_IN" || status === "ALLIN";
  const visible =
    !busy &&
    Boolean(myPlayer) &&
    !outOfHand &&
    (myPlayer?.chips ?? 0) > 0 &&
    myPlayer?.seat_index === currentTurnSeat;

  useEffect(() => {
    setRaiseAmount(minRaise);
  }, [minRaise, visible, myPlayer?.seat_index, currentTurnSeat]);

  if (!visible || !myPlayer) {
    return <div className="action-panel" id="dynamic-action-panel" style={{ display: "none" }} />;
  }

  return (
    <div className="action-panel" id="dynamic-action-panel" style={{ display: "flex" }}>
      <div className="action-panel__label">Ваш ход</div>
      <button
        type="button"
        className="action-btn action-btn--fold"
        disabled={busy}
        onClick={() => onAction("FOLD", 0)}
      >
        <span className="action-btn__icon">✕</span>
        <span className="action-btn__title">Fold</span>
      </button>
      {toCall === 0 ? (
        <button
          type="button"
          className="action-btn action-btn--check"
          disabled={busy}
          onClick={() => onAction("CHECK", 0)}
        >
          <span className="action-btn__icon">✓</span>
          <span className="action-btn__title">Check</span>
        </button>
      ) : (
        <button
          type="button"
          className={`action-btn ${isCallAllIn ? "action-btn--allin" : "action-btn--call"}`}
          disabled={busy}
          onClick={() => onAction("CALL", 0)}
        >
          <span className="action-btn__icon">{isCallAllIn ? "⚡" : "→"}</span>
          <span className="action-btn__text">
            <span className="action-btn__title">{isCallAllIn ? "Call all-in" : "Call"}</span>
            <span className="action-btn__amount">
              {toCall} <span className="chip-icon" />
            </span>
          </span>
        </button>
      )}
      {canMakeLegalRaise ? (
        <div className="raise-dock">
          <div className="raise-group raise-group--stacked">
            <input
              type="number"
              id="raise-amount"
              value={raiseAmount}
              step={bigBlind}
              min={minRaise}
              max={totalMoneyForRound}
              aria-label="Сумма рейза"
              disabled={busy}
              onChange={(event) => setRaiseAmount(Number(event.target.value) || minRaise)}
            />
            <button
              type="button"
              className="btn-raise-action"
              disabled={busy}
              onClick={() => onAction("RAISE", raiseAmount)}
            >
              Raise
            </button>
          </div>
        </div>
      ) : null}
      {myChips > 0 ? (
        <button
          type="button"
          className="action-btn action-btn--allin"
          disabled={busy}
          onClick={() => onAction("ALL_IN", myChips)}
        >
          <span className="action-btn__icon">♦</span>
          <span className="action-btn__text">
            <span className="action-btn__title">All-in</span>
            <span className="action-btn__amount">
              {myChips} <span className="chip-icon" />
            </span>
          </span>
        </button>
      ) : null}
    </div>
  );
}
