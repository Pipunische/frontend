import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useStaticCss } from "../hooks/useStaticCss";

const HOME_CSS = [
  "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap",
  "/static/css/theme.css",
  "/static/css/home.css",
] as const;

const CLUB_NAME = "PoluPoker";
const CREATOR_NAME = "SiliVal";

export function HomePage() {
  useStaticCss(HOME_CSS);
  const { user, loading, logout } = useAuth();

  return (
    <div className="pp-scene">
      <span className="home-float-chip home-float-chip--1" aria-hidden="true" />
      <span className="home-float-chip home-float-chip--2" aria-hidden="true" />
      <span className="home-float-chip home-float-chip--3" aria-hidden="true" />
      <span className="home-float-chip home-float-chip--4" aria-hidden="true" />

      {loading ? null : user ? (
        <span className="home-status-badge home-status-badge--auth">
          Авторизован
        </span>
      ) : (
        <span className="home-status-badge home-status-badge--guest">
          Гость
        </span>
      )}

      <main className="home-hero">
        <div className="home-logo-wrap">
          <p className="home-tagline">Online poker club</p>
          <h1 className="home-logo">{CLUB_NAME}</h1>
        </div>

        <p className="home-subtitle">
          Автор: <strong>{CREATOR_NAME}</strong>
        </p>

        <div className="home-card">
          {loading ? (
            <p className="muted">Проверяем сессию…</p>
          ) : user ? (
            <>
              <div className="home-welcome">
                <div className="home-avatar">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    (user.name || "?").slice(0, 1).toUpperCase()
                  )}
                </div>
                <p className="home-welcome-text">
                  С возвращением, <span>{user.name}</span>
                </p>
              </div>
              <div className="home-divider" />
              <Link to="/lobby" className="pp-btn pp-btn-play">
                ▶ В игру
              </Link>
              <Link to="/profile" className="pp-btn pp-btn-ghost">
                Профиль
              </Link>
              <button
                type="button"
                className="pp-btn pp-btn-danger"
                onClick={() => void logout()}
              >
                Выход
              </button>
            </>
          ) : (
            <Link to="/login" className="pp-btn pp-btn-primary">
              Авторизация
            </Link>
          )}
        </div>
      </main>

      <footer className="home-footer">&copy; 2026 Все права защищены</footer>
    </div>
  );
}
