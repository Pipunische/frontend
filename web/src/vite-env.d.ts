/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: {
          client_id: string;
          callback: (response: { credential: string }) => void;
          ux_mode?: "popup" | "redirect";
          auto_select?: boolean;
          context?: string;
        }) => void;
        renderButton: (
          parent: HTMLElement,
          options: Record<string, string>,
        ) => void;
      };
    };
  };
}
