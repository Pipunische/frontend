import { apiFetch, ApiError } from "./client";
import { hydrateSnapshot } from "../table/layout";
import type { ShowdownDetails } from "../table/showdown";

export type TablePlayer = {
  user_id: string;
  name: string;
  seat_index: number;
  chips: number;
  status?: string;
  is_dealer?: boolean;
  is_active_turn?: boolean;
  cards?: string[];
  avatar_url?: string;
  round_contribution?: number;
  amount_to_call?: number;
  sit_out_deadline?: number;
};

export type TableGame = {
  state?: string;
  pot?: number;
  big_blind?: number;
  max_players?: number;
  community_cards?: string[];
  dealer_seat?: number;
  current_turn_seat?: number;
  time_to_act_ms?: number;
  table_name?: string;
  players?: TablePlayer[];
  showdown_details?: ShowdownDetails | null;
  skip_animations?: boolean;
};

export type PanelEmote = {
  emote_id: string;
  emoji?: string;
  name?: string;
  style_class?: string;
  lottie_url?: string;
};

export type TableSnapshot = {
  table_id: string;
  table_name?: string;
  max_players: number;
  seat_layout_opponents: number[];
  opponent_seats_by_pos: Record<string, TablePlayer | null>;
  my_player: TablePlayer | null;
  my_cards: string[];
  community_cards: string[];
  game: TableGame;
  user: {
    user_id?: string;
    name?: string;
    avatar_url?: string;
    chips?: number;
  };
  java_host?: string;
  is_dev_table?: boolean;
  panel_emotes?: PanelEmote[];
  emotes_dict?: Record<string, string>;
  emotes_lottie_dict?: Record<string, string>;
};

export type TableCommandResult = {
  status?: string;
  redirect?: string;
  error?: boolean | string;
  errorType?: string;
  message?: string;
};

export async function postTableAction(
  tableId: string,
  payload: { user_id: string; name: string; type: string; amount: number },
): Promise<TableCommandResult> {
  return apiFetch<TableCommandResult>(
    `/table/${encodeURIComponent(tableId)}/action`,
    { method: "POST", body: { ...payload, amount: Math.trunc(Number(payload.amount) || 0) }, redirectOn401: true },
  );
}

export async function postTableRebuy(
  tableId: string,
  amount: number,
): Promise<TableCommandResult> {
  const body = new FormData();
  body.append("amount", String(amount));
  return apiFetch<TableCommandResult>(
    `/table/${encodeURIComponent(tableId)}/rebuy`,
    { method: "POST", body, redirectOn401: true },
  );
}

export async function postTableLeave(
  tableId: string,
  userId: string,
): Promise<TableCommandResult> {
  const body = new FormData();
  body.append("user_id", userId);
  return apiFetch<TableCommandResult>(
    `/table/${encodeURIComponent(tableId)}/leave`,
    { method: "POST", body, redirectOn401: false },
  );
}

export async function fetchTableState(tableId: string): Promise<TableSnapshot> {
  try {
    return hydrateSnapshot(
      await apiFetch<TableSnapshot>(
        `/api/table/${encodeURIComponent(tableId)}/state`,
        { redirectOn401: true },
      ),
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.redirect?.startsWith("/lobby"))
    ) {
      throw new ApiError("not_at_table", 403, error.payload, "/lobby");
    }
    throw error;
  }
}
