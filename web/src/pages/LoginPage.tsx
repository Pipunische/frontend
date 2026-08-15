import { Link } from "react-router-dom";

export function LoginPage() {
  return (
    <main className="page">
      <h1>Login</h1>
      <p className="muted">
        Следующий шаг миграции: Google OAuth через существующий{" "}
        <code>/api/auth/google</code>.
      </p>
      <p className="muted">
        Пока используйте legacy-логин:{" "}
        <a href="http://127.0.0.1:8000/login" target="_blank" rel="noreferrer">
          http://127.0.0.1:8000/login
        </a>
      </p>
      <Link to="/">← На главную</Link>
    </main>
  );
}
