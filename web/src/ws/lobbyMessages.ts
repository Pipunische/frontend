import type { LobbyTable } from "../api/lobby";
import { formatBlinds, formatPokerAmount } from "../lib/format";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractOnlineCount(data: Record<string, unknown>): number | null {
  const candidates = [
    data.online_count,
    data.onlineCount,
    data.players_online,
    data.total_online,
    data.online,
  ];
  for (const value of candidates) {
    if (value !== undefined && value !== null && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

export function enrichLobbyTable(raw: Record<string, unknown>): LobbyTable {
  const tableId = String(raw.table_id ?? raw.tableId ?? "");
  const minBuyIn = Number(raw.min_buy_in ?? raw.minBuyIn ?? 0) || 0;
  let blinds = raw.blinds;
  if (!blinds && raw.small_blind != null && raw.big_blind != null) {
    blinds = `${raw.small_blind}/${raw.big_blind}`;
  }
  return {
    table_id: tableId,
    table_name: String(raw.table_name ?? raw.tableName ?? "Стол"),
    blinds: formatBlinds(blinds || "0/0"),
    min_buy_in: minBuyIn,
    min_buy_in_formatted:
      typeof raw.min_buy_in_formatted === "string"
        ? raw.min_buy_in_formatted
        : formatPokerAmount(minBuyIn),
    current_players: Number(raw.current_players ?? raw.currentPlayers ?? 0) || 0,
    max_players: Number(
      raw.max_players ?? raw.max_players_num ?? raw.maxPlayers ?? 10,
    ) || 10,
    is_private: Boolean(raw.is_private ?? raw.isPrivate),
  };
}

export function looksLikeFullSnapshot(tables: Record<string, unknown>[]): boolean {
  const first = tables[0];
  return Boolean(first.table_name || first.tableName);
}

export function patchTableCounts(
  current: LobbyTable[],
  incoming: Record<string, unknown>[],
): LobbyTable[] {
  const byId = new Map(
    incoming.map((raw) => {
      const table_id = String(raw.table_id ?? raw.tableId ?? "");
      return [
        table_id,
        {
          current_players: Number(raw.current_players ?? raw.currentPlayers ?? 0) || 0,
          max_players:
            Number(raw.max_players ?? raw.max_players_num ?? raw.maxPlayers ?? 10) || 10,
        },
      ] as const;
    }),
  );

  return current.map((table) => {
    const patch = byId.get(table.table_id);
    if (!patch) {
      return table;
    }
    return { ...table, ...patch };
  });
}

export function parseStompJson(body: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(body) as unknown;
    return isRecord(data) ? data : null;
  } catch {
    return null;
  }
}
