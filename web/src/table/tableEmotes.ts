import type { EmoteShopState } from "../api/emotes";
import { useTableStore } from "./tableStore";

export function applyOwnedEmotes(shop: EmoteShopState) {
  const owned = new Set(shop.owned_emote_ids ?? []);
  const catalog = shop.catalog ?? [];
  const panel_emotes = catalog
    .filter((item) => item.is_default || owned.has(item.emote_id))
    .map((item) => ({
      emote_id: item.emote_id,
      emoji: item.emoji,
      name: item.name,
      style_class: item.style_class,
      lottie_url: item.lottie_url,
    }));
  const emotes_dict: Record<string, string> = {};
  const emotes_lottie_dict: Record<string, string> = {};
  for (const item of catalog) {
    if (item.emoji) {
      emotes_dict[item.emote_id] = item.emoji;
    }
    if (item.lottie_url) {
      emotes_lottie_dict[item.emote_id] = item.lottie_url;
    }
  }

  const state = useTableStore.getState();
  const patch = { panel_emotes, emotes_dict, emotes_lottie_dict };
  if (state.logical) {
    state.setLogical({ ...state.logical, ...patch });
  }
  if (state.displayed) {
    state.setDisplayed({ ...state.displayed, ...patch });
  }
}
