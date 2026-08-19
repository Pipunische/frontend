import { useLayoutEffect } from "react";

const STYLESHEETS = [
  "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap",
  "/static/css/theme.css",
  "/static/css/glass_auth.css",
];

export function useLegacyLoginAssets() {
  useLayoutEffect(() => {
    const created: HTMLLinkElement[] = [];
    for (const href of STYLESHEETS) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      created.push(link);
    }
    document.body.classList.add("legacy-login");
    return () => {
      for (const link of created) {
        link.remove();
      }
      document.body.classList.remove("legacy-login");
    };
  }, []);
}
