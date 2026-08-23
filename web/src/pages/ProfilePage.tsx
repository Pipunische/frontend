import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { fetchProfile, updateNickname, uploadAvatar, type UserStats } from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useStaticCss } from "../hooks/useStaticCss";
import { formatSpacedInt } from "../lib/format";

const PROFILE_CSS = ["/static/css/profile.css"] as const;

function CountUp({ target }: { target: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    const duration = 900;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(target * eased));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <>{formatSpacedInt(value)}</>;
}

export function ProfilePage() {
  useStaticCss(PROFILE_CSS);
  const { user: sessionUser, refresh } = useAuth();
  const [name, setName] = useState(sessionUser?.name || "");
  const [avatarUrl, setAvatarUrl] = useState(sessionUser?.avatar_url || "");
  const [wallet, setWallet] = useState(sessionUser?.wallet_balance ?? 0);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [editing, setEditing] = useState(false);
  const [nickDraft, setNickDraft] = useState(name);
  const [nickBusy, setNickBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProfile()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setName(data.user.name);
        setNickDraft(data.user.name);
        setAvatarUrl(data.user.avatar_url);
        setWallet(data.user.wallet_balance);
        setStats(data.stats);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить профиль");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveNickname() {
    const next = nickDraft.trim();
    if (!next || next.length > 20) {
      setError("Ник должен состоять не более чем из 20 символов");
      return;
    }
    setNickBusy(true);
    setError(null);
    try {
      const result = await updateNickname(next);
      if (result.error) {
        setError(result.detail || result.error);
        return;
      }
      setName(result.new_nickname || next);
      setEditing(false);
      setMessage("Никнейм успешно изменен.");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка связи с сервером");
    } finally {
      setNickBusy(false);
    }
  }

  function onPickFile(next: File | null) {
    setFile(next);
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setPreview(next ? URL.createObjectURL(next) : null);
  }

  async function saveAvatar(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      return;
    }
    setSavingAvatar(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadAvatar(file);
      if (result.avatar_url) {
        setAvatarUrl(result.avatar_url);
        setFile(null);
        if (preview) {
          URL.revokeObjectURL(preview);
        }
        setPreview(null);
        setMessage("Аватар сохранён.");
        await refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить аватар");
    } finally {
      setSavingAvatar(false);
    }
  }

  const shownAvatar = preview || avatarUrl;
  const progress = Math.min(100, Math.max(0, Number(stats?.rank_progress_percent || 0)));

  return (
    <div className="profile-scene">
      <div className="profile-shell">
        <aside className="profile-identity">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar-ring" aria-hidden="true" />
            <div className="profile-avatar" id="avatar-container">
              {shownAvatar ? (
                <img src={shownAvatar} alt="Avatar" width={168} height={168} />
              ) : (
                (name || "?").slice(0, 1).toUpperCase()
              )}
            </div>
          </div>

          <div className="profile-nick-block">
            {!editing ? (
              <div className="profile-nick-view" id="nickname-view">
                <h2 className="profile-nickname">{name}</h2>
                <button
                  className="profile-icon-btn"
                  type="button"
                  title="Изменить ник"
                  aria-label="Изменить ник"
                  onClick={() => {
                    setNickDraft(name);
                    setEditing(true);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="profile-nick-edit" id="edit-nick-form">
                <input
                  type="text"
                  value={nickDraft}
                  maxLength={20}
                  placeholder="Новый ник"
                  onChange={(event) => setNickDraft(event.target.value)}
                />
                <button
                  className="profile-icon-btn"
                  type="button"
                  title="Сохранить"
                  disabled={nickBusy}
                  onClick={() => void saveNickname()}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                </button>
                <button
                  className="profile-icon-btn"
                  type="button"
                  title="Отмена"
                  onClick={() => setEditing(false)}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          <div className="profile-wallet">
            <span className="profile-chip-icon" />
            {formatSpacedInt(wallet)}
          </div>

          <div className="profile-actions">
            <form id="avatar-form" onSubmit={(event) => void saveAvatar(event)}>
              <label className="profile-btn profile-btn-upload">
                📷 Выбрать фото
                <input
                  type="file"
                  name="avatar"
                  accept="image/png,image/jpeg,image/webp"
                  className="profile-hidden-input"
                  onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
                />
              </label>
              {file ? (
                <button
                  type="submit"
                  className="profile-btn profile-btn-save"
                  style={{ display: "block" }}
                  disabled={savingAvatar}
                >
                  {savingAvatar ? "Сохранение…" : "💾 Сохранить аватар"}
                </button>
              ) : null}
            </form>
            <Link to="/lobby" className="profile-btn profile-btn-back">
              ← Вернуться в лобби
            </Link>
          </div>
          {message ? <p className="muted">{message}</p> : null}
          {error ? <p className="muted">{error}</p> : null}
        </aside>

        <main className="profile-dashboard">
          <header className="profile-dashboard-head">
            <div>
              <h1>Статистика игрока</h1>
              <p>Твой прогресс за столами в реальном времени</p>
            </div>
          </header>

          <section className="profile-bento">
            <article className="profile-stat profile-stat--hands">
              <span className="profile-stat-icon">🃏</span>
              <div className="profile-stat-label">Сыграно раздач</div>
              <div className="profile-stat-value">
                <CountUp target={Number(stats?.hands_played || 0)} />
              </div>
            </article>
            <article className="profile-stat profile-stat--win">
              <span className="profile-stat-icon">🎯</span>
              <div className="profile-stat-label">% Побед</div>
              <div className="profile-stat-value">{stats?.win_ratio ?? 0}%</div>
            </article>
            <article className="profile-stat profile-stat--won">
              <span className="profile-stat-icon">💰</span>
              <div className="profile-stat-label">Выиграно фишек</div>
              <div className="profile-stat-value">{formatSpacedInt(stats?.total_won ?? 0)}</div>
            </article>
            <article className="profile-stat profile-stat--pot">
              <span className="profile-stat-icon">🏆</span>
              <div className="profile-stat-label">Крупный банк</div>
              <div className="profile-stat-value">{formatSpacedInt(stats?.biggest_pot ?? 0)}</div>
            </article>
            <article className="profile-rank-hero">
              <div className="profile-rank-badge">
                <div className="profile-rank-kicker">Текущий ранг</div>
                <h2 className="profile-rank-name">{stats?.rank || "Sucker"}</h2>
                <div className="profile-rank-meta">
                  {stats?.next_rank ? (
                    <>
                      Следующий уровень — <strong>{stats.next_rank}</strong>
                    </>
                  ) : (
                    "Максимальный ранг достигнут"
                  )}
                </div>
              </div>
              <div className="profile-rank-progress-block">
                <div className="profile-rank-progress-head">
                  <span>Прогресс ранга</span>
                  <strong>{progress}%</strong>
                </div>
                <div
                  className="profile-rank-track"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="profile-rank-fill" style={{ width: `${progress}%` }} />
                </div>
                {stats?.next_rank ? (
                  <div className="profile-rank-caption">
                    Ещё {formatSpacedInt(stats.chips_to_next_rank || 0)}
                    <span className="profile-chip-icon" /> до {stats.next_rank}
                  </div>
                ) : progress >= 100 ? (
                  <div className="profile-rank-caption">Максимальный ранг достигнут</div>
                ) : null}
              </div>
            </article>
          </section>
        </main>
      </div>
    </div>
  );
}