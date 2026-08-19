import { useState, type FormEvent } from "react";
import type { CreateTablePayload } from "../../api/tables";

const TABLE_SIZES = [2, 4, 6, 9, 10] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: CreateTablePayload) => Promise<void>;
};

export function CreateTableModal({ open, onClose, onCreate }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const passcode = String(formData.get("passcode") || "").trim();
    const chips = Number(formData.get("chips"));
    const small_blind = Number(formData.get("small_blind"));
    const big_blind = Number(formData.get("big_blind"));
    const min_players_num = Number(formData.get("min_players_num")) || 2;
    const max_players_num = Number(formData.get("max_players_num")) || 6;

    if (!name || Number.isNaN(chips) || Number.isNaN(small_blind) || Number.isNaN(big_blind)) {
      window.alert("Заполните обязательные поля!");
      return;
    }
    if (!(TABLE_SIZES as readonly number[]).includes(max_players_num)) {
      window.alert("Выберите корректный размер стола.");
      return;
    }
    if (min_players_num > max_players_num) {
      window.alert("Мин. игроков не может быть больше макс. игроков.");
      return;
    }

    setBusy(true);
    try {
      await onCreate({
        name,
        passcode: passcode || undefined,
        chips,
        min_players_num,
        max_players_num,
        small_blind,
        big_blind,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`pp-modal-overlay create-table-overlay${open ? " is-open" : ""}`}
      onClick={onClose}
    >
      <form
        className="pp-modal-panel create-table-panel"
        role="dialog"
        aria-labelledby="create-table-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <header className="create-table-header">
          <h2 id="create-table-title">Настройка стола</h2>
          <p className="create-table-subtitle">Создайте кастомный стол для игры</p>
        </header>
        <div className="create-table-form">
          <label className="ct-field-wrap">
            <span className="ct-label">Название стола</span>
            <input
              name="name"
              type="text"
              placeholder="Например: Friday Night"
              className="ct-field"
            />
          </label>
          <label className="ct-field-wrap">
            <span className="ct-label">Пароль</span>
            <input
              name="passcode"
              type="password"
              placeholder="Необязательно"
              className="ct-field"
            />
          </label>
          <label className="ct-field-wrap">
            <span className="ct-label">Сумма бай-ина</span>
            <input
              name="chips"
              type="number"
              placeholder="Фишки"
              className="ct-field"
              min={1}
            />
          </label>
          <div className="ct-row">
            <label className="ct-field-wrap">
              <span className="ct-label">Малый блайнд</span>
              <input name="small_blind" type="number" placeholder="SB" className="ct-field" min={1} />
            </label>
            <label className="ct-field-wrap">
              <span className="ct-label">Большой блайнд</span>
              <input name="big_blind" type="number" placeholder="BB" className="ct-field" min={1} />
            </label>
          </div>
          <div className="ct-row">
            <label className="ct-field-wrap">
              <span className="ct-label">Мин. игроков</span>
              <input
                name="min_players_num"
                type="number"
                defaultValue={2}
                min={2}
                className="ct-field"
              />
            </label>
            <label className="ct-field-wrap">
              <span className="ct-label">Размер стола</span>
              <select name="max_players_num" className="ct-field" defaultValue={6}>
                <option value={2}>Heads-Up (2)</option>
                <option value={4}>4-max</option>
                <option value={6}>6-max</option>
                <option value={9}>Full Ring (9)</option>
                <option value={10}>Live (10)</option>
              </select>
            </label>
          </div>
        </div>
        <div className="create-table-actions">
          <button type="submit" className="pp-btn pp-btn-purple" disabled={busy}>
            {busy ? "Создание…" : "Создать"}
          </button>
          <button type="button" onClick={onClose} className="pp-btn pp-btn-ghost">
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}
