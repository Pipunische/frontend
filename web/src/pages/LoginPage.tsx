import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { loginWithGoogle, updateNickname } from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { loadGisScript, renderGoogleButton } from "../gis/googleIdentity";
import { useLegacyLoginAssets } from "../hooks/useLegacyLoginAssets";
import "./LoginPage.css";

function sessionExpiredMessage(params: URLSearchParams) {
  return params.get("error") === "session_expired"
    ? "Ваша сессия истекла. Войдите заново."
    : null;
}

export function LoginPage() {
  useLegacyLoginAssets();
  const { user, loading, refresh } = useAuth();
  const [params] = useSearchParams();
  const buttonRef = useRef<HTMLDivElement>(null);
  const credentialHandler = useRef<(credential: string) => void>(() => {});

  const [busy, setBusy] = useState(false);
  const [needsNickname, setNeedsNickname] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    sessionExpiredMessage(params),
  );
  const [nickname, setNickname] = useState("");
  const [nickError, setNickError] = useState<string | null>(null);
  const [savingNick, setSavingNick] = useState(false);

  const onGoogleCredential = useCallback(
    async (credential: string) => {
      setBusy(true);
      setError(null);
      try {
        const data = await loginWithGoogle(credential);
        if (data.is_new_user) {
          setNeedsNickname(true);
          await refresh();
          return;
        }
        if (data.redirect || data.status === "success") {
          await refresh();
          return;
        }
        setError(data.error || "Ошибка авторизации");
      } catch (err) {
        console.error("Ошибка связи с сервером:", err);
        setError("Ошибка связи с сервером. Попробуйте позже.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  credentialHandler.current = (credential) => {
    void onGoogleCredential(credential);
  };

  useEffect(() => {
    if (loading || user || busy || needsNickname) {
      return;
    }

    let cancelled = false;
    void loadGisScript()
      .then(() => {
        if (cancelled || !buttonRef.current) {
          return;
        }
        renderGoogleButton(buttonRef.current, (credential) => {
          credentialHandler.current(credential);
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Не удалось загрузить Google Sign-In",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [busy, loading, needsNickname, user]);

  async function submitFirstNickname(event: FormEvent) {
    event.preventDefault();
    const newNick = nickname.trim();
    if (!newNick || newNick.length > 20) {
      setNickError("Никнейм должен быть заполнен и содержать не более 20 символов!");
      return;
    }

    setSavingNick(true);
    setNickError(null);
    try {
      const result = await updateNickname(newNick);
      if (result.redirect) {
        window.location.assign(result.redirect);
        return;
      }
      if (result.error) {
        setNickError(
          `Ошибка при сохранении ника: ${result.detail || result.error}`,
        );
        return;
      }
      await refresh();
      setNeedsNickname(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      console.error("Ошибка связи:", err);
      setNickError("Ошибка связи при сохранении никнейма.");
    } finally {
      setSavingNick(false);
    }
  }

  if (loading) {
    return (
      <div className="login-root">
        <div className="login-box">
          <p className="login-hint">Проверяем сессию…</p>
        </div>
      </div>
    );
  }

  if (user && !needsNickname) {
    return <Navigate to="/lobby" replace />;
  }

  return (
    <div className="login-root">
      <div className="login-box">
        <div id="loginForm" className="login-form">
          <h2>ВХОД В КЛУБ</h2>
          {error ? <div className="error-msg">{error}</div> : null}
          <p className="login-hint">
            Для доступа к столам авторизуйтесь через Google
          </p>
          <div
            ref={buttonRef}
            className="pp-google-signin"
            hidden={busy}
          />
          {busy ? (
            <div className="login-loading">🔄 Авторизация...</div>
          ) : null}
        </div>
      </div>

      <div
        id="first-nickname-modal"
        className={`modal-overlay${needsNickname ? " active" : ""}`}
      >
        <form className="nickname-box" onSubmit={(e) => void submitFirstNickname(e)}>
          <h2>Добро пожаловать!</h2>
          <p>
            Перед тем как сесть за стол, выберите игровой никнейм (макс. 20
            символов):
          </p>
          <input
            type="text"
            className="nickname-input"
            maxLength={20}
            placeholder="Ваш никнейм"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoFocus={needsNickname}
          />
          {nickError ? <div className="error-msg">{nickError}</div> : null}
          <button className="btn-submit-nick" type="submit" disabled={savingNick}>
            {savingNick ? "СОХРАНЕНИЕ…" : "СОХРАНИТЬ И ИГРАТЬ"}
          </button>
        </form>
      </div>
    </div>
  );
}
