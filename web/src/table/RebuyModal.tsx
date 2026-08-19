import { useEffect, useRef, useState } from "react";
import type { TablePlayer } from "../api/table";

type Props = {
  myPlayer: TablePlayer | null;
  bigBlind: number;
  busy: boolean;
  onRebuy: (amount: number) => void;
  onLeave: () => void;
};

export function RebuyModal({ myPlayer, bigBlind, busy, onRebuy, onLeave }: Props) {
  const chips = Number(myPlayer?.chips ?? 0);
  const bb = Number(bigBlind);
  const status = String(myPlayer?.status || "");
  const deadline = Number(myPlayer?.sit_out_deadline || 0);
  const broke = Number.isFinite(chips) && Number.isFinite(bb) && bb > 0 && chips < bb;
  const canPrompt = status === "SITTING_OUT" || deadline > 0;
  const open = Boolean(myPlayer) && broke && canPrompt;

  const [amount, setAmount] = useState(bb || 0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const leaveOnceRef = useRef(false);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    if (open) {
      setAmount(bb);
    }
  }, [open, bb]);

  useEffect(() => {
    leaveOnceRef.current = false;
    if (!open || deadline <= 0) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && !leaveOnceRef.current) {
        leaveOnceRef.current = true;
        onLeaveRef.current();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, deadline]);

  if (!open) {
    return null;
  }

  return (
    <div id="rebuy-modal" className="pp-modal-overlay table-rebuy-overlay is-open" style={{ display: "flex" }}>
      <div className="pp-modal-panel table-rebuy-panel">
        <header className="table-rebuy-header">
          <h2>Недостаточно фишек</h2>
          <p>
            У вас меньше {bb} фишек.
            <br />
            Докупитесь, или вы покинете стол через{" "}
            <strong id="rebuy-timer-text">{secondsLeft == null ? "∞" : secondsLeft}</strong> сек.
          </p>
        </header>
        <label className="table-rebuy-field-wrap">
          <span className="table-rebuy-label">Сумма докупки</span>
          <input
            type="number"
            id="rebuy-amount"
            className="table-rebuy-input"
            min={bb}
            value={amount}
            disabled={busy}
            onChange={(event) => setAmount(Number(event.target.value) || bb)}
          />
        </label>
        <div className="table-rebuy-actions">
          <button
            type="button"
            className="pp-btn pp-btn-play"
            disabled={busy}
            onClick={() => onRebuy(amount)}
          >
            Докупить
          </button>
          <button type="button" className="pp-btn pp-btn-danger" disabled={busy} onClick={onLeave}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
