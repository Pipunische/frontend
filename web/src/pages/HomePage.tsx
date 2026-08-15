import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchHealth } from "../api/client";

export function HomePage() {
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    fetchHealth()
      .then((data) => setHealth(`${data.service} v${data.version} — ${data.status}`))
      .catch(() => setHealth("BFF недоступен (запустите uvicorn на :8000)"));
  }, []);

  return (
    <main className="page">
      <h1>PoluPoker SPA</h1>
      <p className="muted">Ветка rewrite/spa — новый React-клиент. Прод остаётся в c:\Dev\Polupoker.</p>
      <p className="health">{health}</p>
      <nav className="nav">
        <Link to="/login">Login</Link>
        <a href="http://127.0.0.1:8000/lobby" target="_blank" rel="noreferrer">
          Legacy lobby (:8000)
        </a>
      </nav>
    </main>
  );
}
