import { apiFetch, ApiError } from "./client";

export type LobbyTable = {
  table_id: string;
  table_name: string;
  blinds?: string;
  min_buy_in?: number;
  min_buy_in_formatted?: string;
  current_players?: number;
  max_players?: number;
  is_private?: boolean;
};

export type LobbyUser = {
  user_id?: string;
  name?: string;
  avatar_url?: string;
  wallet_balance?: number;
  wallet_balance_formatted?: string | null;
};

export type LobbyState = {
  tables: LobbyTable[];
  is_server_down: boolean;
  java_host: string;
  user: LobbyUser;
  token?: string;
};

export async function fetchLobbyState(): Promise<LobbyState> {
  try {
    return await apiFetch<LobbyState>("/api/lobby/state");
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      return {
        tables: [],
        is_server_down: true,
        java_host: "",
        user: {},
      };
    }
    throw error;
  }
}
