import { realHoleCards } from "../lib/cards";
import type { TableGame, TablePlayer, TableSnapshot } from "../api/table";

const SEAT_LAYOUTS: Record<number, number[]> = {
  2: [5],
  4: [3, 5, 7],
  6: [1, 3, 5, 7, 9],
  9: [1, 2, 3, 4, 6, 7, 8, 9],
  10: [1, 2, 3, 4, 5, 6, 7, 8, 9],
};

const DEFAULT_MAX_PLAYERS = 10;
export const DEFAULT_TURN_MS = 15000;

export function resolveTimeToActMs(
  source: Record<string, unknown>,
  prevTurn: number | undefined,
  nextTurn: number | undefined,
  prevTime?: number,
): number {
  const raw = source.time_to_act_ms ?? source.timeToActMs;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  if (nextTurn != null && Number(nextTurn) >= 0 && Number(nextTurn) !== Number(prevTurn ?? -2)) {
    return DEFAULT_TURN_MS;
  }
  if (prevTime != null && Number.isFinite(Number(prevTime))) {
    return Number(prevTime);
  }
  return nextTurn != null && Number(nextTurn) >= 0 ? DEFAULT_TURN_MS : 0;
}

function withActiveTurn<T extends { seat_index?: number; is_active_turn?: boolean }>(
  player: T,
  activeIdx: number,
): T {
  return { ...player, is_active_turn: Number(player.seat_index) === activeIdx };
}

let heroHoleCache: { tableId: string; cards: string[] } | null = null;

export function clearHeroHoleCache() {
  heroHoleCache = null;
}

function rememberHeroHole(tableId: string, cards: string[]) {
  const real = realHoleCards(cards);
  if (tableId && real.length) {
    heroHoleCache = { tableId, cards: real };
  }
}

export function normalizeMaxPlayers(value: unknown): number {
  const n = Number(value);
  if (n in SEAT_LAYOUTS) {
    return n;
  }
  return DEFAULT_MAX_PLAYERS;
}

export function getOpponentPosLayout(maxPlayers: number): number[] {
  return SEAT_LAYOUTS[maxPlayers] ?? SEAT_LAYOUTS[DEFAULT_MAX_PLAYERS];
}

function cardsFromRaw(raw: Record<string, unknown> | TablePlayer): string[] {
  const rec = raw as Record<string, unknown>;
  for (const key of ["cards", "hole_cards", "holeCards", "my_cards", "myCards"]) {
    const cards = rec[key];
    if (Array.isArray(cards) && cards.length) {
      return cards as string[];
    }
  }
  return [];
}

function extractCards(player: TablePlayer): string[] {
  return cardsFromRaw(player);
}

function sameUser(a: unknown, b: unknown): boolean {
  if (a == null || b == null || a === "" || b === "") {
    return false;
  }
  return String(a) === String(b);
}

function optNum(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asPlayer(raw: Record<string, unknown>, extras: Partial<TablePlayer> = {}): TablePlayer {
  return {
    user_id: String(raw.user_id ?? raw.userId ?? ""),
    name: String(raw.name ?? raw.nickname ?? ""),
    seat_index: Number(raw.seat_index ?? raw.seatIndex ?? -1),
    chips: Number(raw.chips ?? 0),
    status: raw.status != null ? String(raw.status) : undefined,
    avatar_url: raw.avatar_url != null ? String(raw.avatar_url) : String(raw.avatarUrl ?? ""),
    cards: cardsFromRaw(raw),
    round_contribution: optNum(raw.round_contribution ?? raw.roundContribution),
    amount_to_call: optNum(raw.amount_to_call ?? raw.amountToCall),
    sit_out_deadline: optNum(raw.sit_out_deadline ?? raw.sitOutDeadline),
    ...extras,
  };
}

export function hydrateSnapshot(raw: TableSnapshot): TableSnapshot {
  const base = !raw.my_player
    ? raw
    : {
        ...raw,
        my_player: asPlayer(raw.my_player as unknown as Record<string, unknown>, {
          is_dealer: raw.my_player.is_dealer,
          is_active_turn: raw.my_player.is_active_turn,
        }),
      };
  return ensureOpponentSeats(base);
}

/** Rebuild opponent_seats_by_pos from game.players when HTTP/WS payload omitted seat map. */
export function ensureOpponentSeats(snapshot: TableSnapshot): TableSnapshot {
  const myId = String(snapshot.user?.user_id || snapshot.my_player?.user_id || "");
  const othersInGame = (snapshot.game.players || []).filter((p) => p.user_id && !sameUser(p.user_id, myId));
  if (!othersInGame.length) {
    return snapshot;
  }
  const seated = Object.values(snapshot.opponent_seats_by_pos || {}).filter(Boolean);
  if (seated.length >= othersInGame.length) {
    return snapshot;
  }
  const emptyPrev: TableSnapshot = {
    ...snapshot,
    opponent_seats_by_pos: {},
    seat_layout_opponents:
      snapshot.seat_layout_opponents?.length
        ? snapshot.seat_layout_opponents
        : getOpponentPosLayout(normalizeMaxPlayers(snapshot.max_players ?? snapshot.game.max_players)),
  };
  return buildSnapshotFromGame(snapshot.game, emptyPrev, snapshot.my_cards);
}

export function gameFromPayload(data: Record<string, unknown>): TableGame {
  const playersRaw = Array.isArray(data.players) ? data.players : [];
  return {
    state: data.state != null ? String(data.state) : undefined,
    pot: data.pot != null ? Number(data.pot) : undefined,
    big_blind: data.big_blind != null ? Number(data.big_blind) : data.bigBlind != null ? Number(data.bigBlind) : undefined,
    max_players: data.max_players != null ? Number(data.max_players) : undefined,
    community_cards: Array.isArray(data.community_cards)
      ? (data.community_cards as string[])
      : Array.isArray(data.communityCards)
        ? (data.communityCards as string[])
        : undefined,
    dealer_seat: data.dealer_seat != null ? Number(data.dealer_seat) : data.dealerSeat != null ? Number(data.dealerSeat) : undefined,
    current_turn_seat:
      data.current_turn_seat != null
        ? Number(data.current_turn_seat)
        : data.currentTurnSeat != null
          ? Number(data.currentTurnSeat)
          : undefined,
    time_to_act_ms:
      data.time_to_act_ms != null
        ? Number(data.time_to_act_ms)
        : data.timeToActMs != null
          ? Number(data.timeToActMs)
          : undefined,
    table_name: data.table_name != null ? String(data.table_name) : undefined,
    skip_animations: data.skip_animations === true || data.skipAnimations === true,
    showdown_details:
      data.showdown_details && typeof data.showdown_details === "object"
        ? (data.showdown_details as TableGame["showdown_details"])
        : data.showdownDetails && typeof data.showdownDetails === "object"
          ? (data.showdownDetails as TableGame["showdown_details"])
          : data.showdown_details === null
            ? null
            : undefined,
    players: playersRaw
      .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
      .map((row) => asPlayer(row)),
  };
}

export function heroCardsFromPayload(data: Record<string, unknown>, myId: string): string[] {
  const nested =
    data.game && typeof data.game === "object"
      ? { ...data, ...(data.game as Record<string, unknown>) }
      : data;
  const top = realHoleCards(
    nested.my_cards ?? nested.myCards ?? nested.hole_cards ?? nested.holeCards,
  );
  if (top.length) {
    return top;
  }
  const players = Array.isArray(nested.players) ? nested.players : [];
  for (const row of players) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const player = asPlayer(row as Record<string, unknown>);
    if (sameUser(player.user_id, myId)) {
      return realHoleCards(player.cards);
    }
  }
  return [];
}

function patchPlayerFromAction(
  player: TablePlayer,
  event: Record<string, unknown>,
  playerState: TablePlayer | null,
  dealerSeat: number | undefined,
): TablePlayer {
  const eventSeat = event.seat_index ?? event.seatIndex;
  const matches =
    (playerState && sameUser(player.user_id, playerState.user_id)) ||
    (eventSeat != null && Number(player.seat_index) === Number(eventSeat));

  let next = { ...player };
  if (matches && playerState) {
    next = {
      ...next,
      chips: playerState.chips ?? next.chips,
      status: playerState.status ?? next.status,
      round_contribution: playerState.round_contribution ?? next.round_contribution,
      amount_to_call: playerState.amount_to_call ?? next.amount_to_call,
      seat_index:
        next.seat_index != null && Number(next.seat_index) >= 0
          ? next.seat_index
          : playerState.seat_index,
      name: playerState.name || next.name,
      avatar_url: playerState.avatar_url || next.avatar_url,
    };
  }
  if (dealerSeat != null) {
    next.is_dealer = Number(next.seat_index) === Number(dealerSeat);
  }
  return next;
}

export function mergePlayersList(
  prev: TablePlayer[] | undefined,
  incoming: TablePlayer[] | undefined,
): TablePlayer[] {
  const prevList = prev || [];
  const incomingValid = (incoming || []).filter((p) => String(p.user_id));
  if (!incomingValid.length) {
    return prevList;
  }
  if (!prevList.length) {
    return incomingValid;
  }

  const byId = new Map(prevList.map((p) => [String(p.user_id), { ...p }]));
  for (const p of incomingValid) {
    const id = String(p.user_id);
    const old = byId.get(id);
    byId.set(id, {
      ...(old || p),
      ...p,
      seat_index:
        p.seat_index != null && Number(p.seat_index) >= 0
          ? p.seat_index
          : (old?.seat_index ?? p.seat_index),
      cards: p.cards?.length ? p.cards : old?.cards,
    });
  }

  const incomingIds = new Set(incomingValid.map((p) => String(p.user_id)));
  const prevIds = new Set(prevList.map((p) => String(p.user_id)));
  const isStrictSubset =
    incomingValid.length < prevList.length &&
    [...incomingIds].every((id) => prevIds.has(id)) &&
    incomingIds.size < prevIds.size;

  if (isStrictSubset) {
    return incomingValid.map((p) => byId.get(String(p.user_id)) || p);
  }

  if (incomingValid.length < prevList.length) {
    for (const p of prevList) {
      const id = String(p.user_id);
      if (!byId.has(id)) {
        byId.set(id, p);
      }
    }
  }

  return Array.from(byId.values());
}

function mergeSeatPlayer(prevSeat: TablePlayer | null, fresh: TablePlayer): TablePlayer {
  if (!prevSeat) {
    return fresh;
  }
  return {
    ...prevSeat,
    ...fresh,
    seat_index:
      prevSeat.seat_index != null && Number(prevSeat.seat_index) >= 0
        ? prevSeat.seat_index
        : fresh.seat_index,
    avatar_url: fresh.avatar_url || prevSeat.avatar_url,
    name: fresh.name || prevSeat.name,
    cards: fresh.cards?.length ? fresh.cards : prevSeat.cards,
  };
}

function buildOpponentSeats(
  prev: TableSnapshot,
  othersRaw: TablePlayer[],
  myPlayer: TablePlayer | null,
  maxPlayers: number,
  layout: number[],
): Record<string, TablePlayer | null> {
  const byId = new Map(othersRaw.map((p) => [String(p.user_id), p]));
  const next: Record<string, TablePlayer | null> = {};
  layout.forEach((pos) => {
    next[String(pos)] = null;
  });
  const usedIds = new Set<string>();

  for (const [pos, seat] of Object.entries(prev.opponent_seats_by_pos || {})) {
    if (!seat || !layout.includes(Number(pos))) {
      continue;
    }
    const fresh = byId.get(String(seat.user_id));
    if (!fresh) {
      continue;
    }
    next[pos] = mergeSeatPlayer(seat, fresh);
    usedIds.add(String(seat.user_id));
  }

  const heroSeat = myPlayer?.seat_index ?? 0;
  for (const player of othersRaw) {
    const id = String(player.user_id);
    if (usedIds.has(id)) {
      continue;
    }
    const relative = (((player.seat_index ?? 0) - heroSeat - 1 + maxPlayers) % maxPlayers);
    const pos = layout[relative];
    if (pos != null && !next[String(pos)]) {
      next[String(pos)] = player;
      usedIds.add(id);
    }
  }

  for (const player of othersRaw) {
    const id = String(player.user_id);
    if (usedIds.has(id)) {
      continue;
    }
    const emptyPos = layout.find((pos) => !next[String(pos)]);
    if (emptyPos != null) {
      next[String(emptyPos)] = player;
      usedIds.add(id);
    }
  }

  return next;
}

export function buildSnapshotFromGame(
  game: TableGame,
  prev: TableSnapshot,
  myCardsHint?: string[] | null,
): TableSnapshot {
  const myId = String(prev.user?.user_id || prev.my_player?.user_id || "");
  const maxPlayers = normalizeMaxPlayers(game.max_players ?? prev.max_players);
  const dealerIdx = game.dealer_seat ?? -1;
  const activeIdx = game.current_turn_seat ?? -1;
  const state = game.state || prev.game.state;

  let myPlayer: TablePlayer | null = null;
  let myCards: string[] = [];
  const othersRaw: TablePlayer[] = [];

  for (const raw of game.players || []) {
    const player: TablePlayer = {
      ...raw,
      is_dealer: Number(raw.seat_index) === Number(dealerIdx),
      is_active_turn: Number(raw.seat_index) === Number(activeIdx),
      round_contribution: raw.round_contribution,
      avatar_url: raw.avatar_url || "",
    };
    const realCards = extractCards(player);

    if (sameUser(player.user_id, myId)) {
      myPlayer = player;
      myCards = realCards;
    } else {
      if (state === "SHOWDOWN") {
        player.cards = realCards;
      } else if (state === "WAITING_FOR_PLAYERS") {
        player.cards = [];
      } else {
        player.cards = ["card_back", "card_back"];
      }
      othersRaw.push(player);
    }
  }

  if (!myPlayer && prev.my_player && (sameUser(prev.my_player.user_id, myId) || !myId)) {
    myPlayer = prev.my_player;
    const hid = String(myPlayer.user_id);
    const idx = othersRaw.findIndex((p) => sameUser(p.user_id, hid));
    if (idx >= 0) {
      myCards = extractCards(othersRaw[idx]);
      othersRaw.splice(idx, 1);
    }
  }

  const layout = getOpponentPosLayout(maxPlayers);

  const opponent_seats_by_pos = buildOpponentSeats(
    prev,
    othersRaw,
    myPlayer,
    maxPlayers,
    layout,
  );

  const activePhases = ["PRE_FLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"];
  let heroCards = myCardsHint?.length ? myCardsHint : myCards;
  if (state === "WAITING_FOR_PLAYERS") {
    heroHoleCache = null;
    heroCards = [];
  } else if (activePhases.includes(state || "")) {
    const incoming = realHoleCards(heroCards);
    const kept = realHoleCards(prev.my_cards);
    const cached =
      heroHoleCache?.tableId === prev.table_id ? heroHoleCache.cards : [];
    heroCards = incoming.length ? incoming : kept.length ? kept : cached;
    if (incoming.length) {
      rememberHeroHole(prev.table_id, incoming);
    } else if (heroCards.length) {
      rememberHeroHole(prev.table_id, heroCards);
    }
  }

  const board = game.community_cards ?? prev.community_cards ?? [];

  return {
    ...prev,
    max_players: maxPlayers,
    seat_layout_opponents: layout,
    opponent_seats_by_pos,
    my_player: myPlayer,
    my_cards: heroCards,
    community_cards: board,
    table_name: game.table_name || prev.table_name,
    game: {
      ...prev.game,
      ...game,
      max_players: maxPlayers,
      community_cards: board,
      players: game.players || prev.game.players,
    },
  };
}

export function applyPlayerActionEvent(
  prev: TableSnapshot,
  event: Record<string, unknown>,
): TableSnapshot {
  const pot =
    event.total_pot != null
      ? Number(event.total_pot)
      : event.pot != null
        ? Number(event.pot)
        : prev.game.pot;

  const rawState = event.player_state ?? event.playerState;
  const playerState =
    rawState && typeof rawState === "object"
      ? asPlayer(rawState as Record<string, unknown>)
      : null;
  const dealerSeat = prev.game.dealer_seat;

  const nextPlayers = (prev.game.players || []).map((player) =>
    patchPlayerFromAction(player, event, playerState, dealerSeat),
  );

  const opponent_seats_by_pos: Record<string, TablePlayer | null> = {};
  for (const [pos, seat] of Object.entries(prev.opponent_seats_by_pos || {})) {
    opponent_seats_by_pos[pos] = seat
      ? patchPlayerFromAction(seat, event, playerState, dealerSeat)
      : null;
  }

  const my_player = prev.my_player
    ? patchPlayerFromAction(prev.my_player, event, playerState, dealerSeat)
    : null;

  const rawTurn = event.current_turn_seat ?? event.currentTurnSeat;
  const current_turn_seat =
    rawTurn != null ? Number(rawTurn) : prev.game.current_turn_seat;
  const time_to_act_ms = resolveTimeToActMs(
    event,
    prev.game.current_turn_seat,
    current_turn_seat,
    prev.game.time_to_act_ms,
  );
  const activeIdx = Number(current_turn_seat ?? -1);

  return {
    ...prev,
    my_player: my_player ? withActiveTurn(my_player, activeIdx) : null,
    opponent_seats_by_pos: Object.fromEntries(
      Object.entries(opponent_seats_by_pos).map(([pos, seat]) => [
        pos,
        seat ? withActiveTurn(seat, activeIdx) : null,
      ]),
    ),
    game: {
      ...prev.game,
      pot,
      current_turn_seat,
      time_to_act_ms,
      players: nextPlayers.map((player) => withActiveTurn(player, activeIdx)),
    },
  };
}

export function normalizeContributions(raw: unknown): Array<{ user_id: string; amount: number }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const rec = row as Record<string, unknown>;
      const user_id = String(rec.user_id ?? rec.userId ?? "");
      const amount = Number(rec.amount ?? rec.value ?? 0);
      if (!user_id || !Number.isFinite(amount) || amount <= 0) {
        return null;
      }
      return { user_id, amount };
    })
    .filter((row): row is { user_id: string; amount: number } => Boolean(row));
}

export function unwrapTableEvent(data: Record<string, unknown>): Record<string, unknown> {
  const nested =
    data.game && typeof data.game === "object"
      ? { ...data, ...(data.game as Record<string, unknown>) }
      : { ...data };
  nested.event_type = String(data.event_type ?? data.eventType ?? nested.event_type ?? "");
  nested.user_id = data.user_id ?? data.userId ?? nested.user_id ?? nested.userId;
  nested.emote_id = data.emote_id ?? data.emoteId ?? nested.emote_id ?? nested.emoteId;
  nested.player_state = data.player_state ?? data.playerState ?? nested.player_state;
  nested.skip_animations =
    data.skip_animations === true ||
    data.skipAnimations === true ||
    nested.skip_animations === true ||
    nested.skipAnimations === true;
  nested.community_cards = nested.community_cards ?? nested.communityCards;
  nested.showdown_details = nested.showdown_details ?? nested.showdownDetails;
  nested.previous_state = nested.previous_state ?? nested.previousState;
  nested.contributions = normalizeContributions(
    nested.contributions ?? nested.streetContributions ?? nested.street_contributions,
  );
  return nested;
}

export function applyStreetEndEvent(
  prev: TableSnapshot,
  event: Record<string, unknown>,
): TableSnapshot {
  const game = gameFromPayload({ ...prev.game, ...event });
  const incomingPlayers = Array.isArray(event.players)
    ? game.players
    : undefined;
  game.players = mergePlayersList(prev.game.players, incomingPlayers);
  if (event.pot != null) {
    game.pot = Number(event.pot);
  }
  game.time_to_act_ms = resolveTimeToActMs(
    event,
    prev.game.current_turn_seat,
    game.current_turn_seat,
    prev.game.time_to_act_ms,
  );
  return buildSnapshotFromGame(game, prev, prev.my_cards);
}
