import { apiFetch } from "./client";

export type CreateTablePayload = {
  name: string;
  passcode?: string;
  chips: number;
  min_players_num: number;
  max_players_num: number;
  small_blind: number;
  big_blind: number;
};

export type TableActionResult = {
  status?: string;
  redirect?: string;
  error?: string;
  detail?: string;
  errorType?: string;
  message?: string;
};

export function createTable(payload: CreateTablePayload) {
  return apiFetch<TableActionResult>("/api/tables", {
    method: "POST",
    body: payload,
  });
}

export function joinTable(
  tableId: string,
  body: { chips: number; passcode?: string },
) {
  return apiFetch<TableActionResult>(
    `/api/tables/${encodeURIComponent(tableId)}/join`,
    {
      method: "POST",
      body,
    },
  );
}
