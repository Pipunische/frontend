import { formatPokerAmount, stakeClass } from "../../lib/format";
import type { LobbyTable } from "../../api/lobby";

type Props = {
  table: LobbyTable;
  walletBalance: number;
  onJoin: (table: LobbyTable, chips: number) => void;
};

export function TableCard({ table, walletBalance, onJoin }: Props) {
  const minBuyIn = Number(table.min_buy_in) || 0;
  const current = Number(table.current_players) || 0;
  const maxPlayers = Number(table.max_players) || 10;
  const full = current >= maxPlayers;
  const noMoney = walletBalance < minBuyIn;
  const minFormatted =
    table.min_buy_in_formatted || formatPokerAmount(minBuyIn);

  return (
    <article className={`lobby-table table-card ${stakeClass(minBuyIn)}`}>
      <div className="lobby-table__bg" aria-hidden="true" />
      <span className="lobby-table__suit" aria-hidden="true">
        ♠
      </span>
      <div className="lobby-table__content">
        <header className="lobby-table__head">
          <h3 className="lobby-table__name">{table.table_name}</h3>
        </header>
        <div className="lobby-table__blinds">
          <span className="lobby-chip lobby-chip--lg" />
          <span className="blinds-text">{table.blinds || "0/0"}</span>
        </div>
        <div className="lobby-table__stats">
          <span className="lobby-table__stat">
            <span className="lobby-table__stat-label">Мин. вход:</span>
            <strong>
              {minFormatted} <span className="lobby-chip lobby-chip--sm" />
            </strong>
          </span>
          <span className="lobby-table__stat lobby-table__stat--players">
            <span className="lobby-table__dealer" aria-hidden="true">
              🤵‍♂️
            </span>
            <strong>
              {current} / {maxPlayers}
            </strong>
          </span>
        </div>
        <div className="lobby-table__action card-action">
          {full ? (
            <div className="lobby-status lobby-status--full status-full">
              Мест нет
            </div>
          ) : noMoney ? (
            <div className="lobby-status lobby-status--warn status-full">
              Недостаточно фишек
            </div>
          ) : (
            <BuyInForm
              table={table}
              minBuyIn={minBuyIn}
              walletBalance={walletBalance}
              onJoin={onJoin}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function BuyInForm({
  table,
  minBuyIn,
  walletBalance,
  onJoin,
}: {
  table: LobbyTable;
  minBuyIn: number;
  walletBalance: number;
  onJoin: (table: LobbyTable, chips: number) => void;
}) {
  return (
    <form
      className="buy-in-section"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = form.elements.namedItem("chips") as HTMLInputElement;
        const raw = Number(input.value);
        if (Number.isNaN(raw) || input.value.trim() === "") {
          window.alert("Введите корректную сумму входа (только цифры).");
          return;
        }
        const buyIn = Math.floor(raw);
        if (buyIn < minBuyIn) {
          window.alert(`Минимальная сумма входа: ${minBuyIn}`);
          return;
        }
        if (buyIn > walletBalance) {
          window.alert(`Недостаточно средств. Максимум: ${walletBalance}`);
          return;
        }
        onJoin(table, buyIn);
      }}
    >
      <label className="lobby-buyin-label">Сумма для игры</label>
      <div className="lobby-buyin-row">
        <input
          type="number"
          name="chips"
          defaultValue={minBuyIn}
          min={minBuyIn}
          max={walletBalance}
          step={10}
          className="lobby-buyin-input buyin-input-field"
        />
        <button type="submit" className="pp-btn pp-btn-play lobby-join-btn">
          Сесть
        </button>
      </div>
    </form>
  );
}
