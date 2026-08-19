import { apiFetch } from "./client";

export type EmoteCatalogItem = {
  emote_id: string;
  emoji?: string;
  name: string;
  price: number;
  is_default?: boolean;
  owned?: boolean;
  style_class?: string;
  lottie_url?: string;
};

export type EmoteShopState = {
  status?: string;
  wallet_balance: number;
  owned_emote_ids: string[];
  catalog: EmoteCatalogItem[];
  source?: string;
  error?: boolean | string;
  errorType?: string;
  message?: string;
};

export function fetchEmotes() {
  return apiFetch<EmoteShopState>("/api/emotes");
}

export function purchaseEmote(emote_id: string) {
  return apiFetch<EmoteShopState>("/api/emotes/purchase", {
    method: "POST",
    body: { emote_id },
  });
}