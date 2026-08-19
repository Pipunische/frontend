const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Same public client id as templates/login.html; override with VITE_GOOGLE_CLIENT_ID. */
const LEGACY_GOOGLE_CLIENT_ID =
  "41278678885-60fb3n16bsodd83dnevm9cdg29m5l6j4.apps.googleusercontent.com";

export function getGoogleClientId(): string {
  const fromEnv = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  return fromEnv || LEGACY_GOOGLE_CLIENT_ID;
}

export function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SRC}"]`,
    );
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Не удалось загрузить Google Sign-In")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Не удалось загрузить Google Sign-In"));
    document.head.appendChild(script);
  });
}

export function renderGoogleButton(
  container: HTMLElement,
  onCredential: (credential: string) => void,
) {
  const clientId = getGoogleClientId();
  if (!window.google?.accounts?.id) {
    return;
  }

  container.replaceChildren();
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
    ux_mode: "popup",
    auto_select: false,
    context: "signin",
  });
  window.google.accounts.id.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    logo_alignment: "left",
  });
}
