import { useStaticCss } from "./useStaticCss";

export function useLegacyLoginAssets() {
  useStaticCss(["/static/css/glass_auth.css"], "legacy-login");
}
