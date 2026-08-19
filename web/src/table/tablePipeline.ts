import type { Client } from "@stomp/stompjs";
import type { TableSnapshot } from "../api/table";
import { fetchHeroHoleCards } from "../api/table";
import { playSound } from "../lib/sounds";
import { realHoleCards } from "../lib/cards";
import {
  applyPlayerActionEvent,
  applyStreetEndEvent,
  buildSnapshotFromGame,
  clearHeroHoleCache,
  gameFromPayload,
  heroCardsFromPayload,
  mergePlayersList,
  normalizeContributions,
  unwrapTableEvent,
} from "./layout";
import { layoutRegistry } from "./layoutRegistry";
import {
  aggregatePayouts,
  buildShowdownBadge,
  getPayoutTotalsByUser,
  getTotalPayoutAmount,
  isShowdownPhase,
  resolveShowdownHighlightCards,
  type ShowdownDetails,
  type ShowdownPayout,
} from "./showdown";
import { getFx, patchFx, type FlyingChip } from "./tableFx";
import { useTableStore } from "./tableStore";

const CHIP_COLLECT_DURATION_MS = 650;
const CHIP_COLLECT_STAGGER_MS = 90;
const CHIP_PAYOUT_STAGGER_MS = 80;
const CARD_DEAL_MS = 400;
const FLOP_EXTRA_MS = 800;
const HOLE_DEAL_MS = 850;
const TABLE_UPDATE_DEBOUNCE_MS = 50;
const RECENT_WS_MS = 4000;
const STREET_ORDER = [
  "WAITING_FOR_PLAYERS",
  "PRE_FLOP",
  "FLOP",
  "TURN",
  "RIVER",
  "SHOWDOWN",
  "CLEANUP",
];

type ToastFn = (type: "error" | "success" | "warning", errorType: string, message: string) => void;

let toastFn: ToastFn | null = null;
let stompClient: Client | null = null;
let tableId = "";
let flySeq = 1;
let emoteSeq = 1;
let fxGen = 0;
let pumping = false;
let skipVisualOnce = false;
let showdownHighlightDone = false;
let holeCardsInflight: Promise<void> | null = null;
let lastWsAt = 0;
let tableUpdateTimer: number | null = null;
let streetCoalesceUntil = 0;

export function setTableToastHandler(fn: ToastFn | null) {
  toastFn = fn;
}

export function setTableStompClient(client: Client | null, id: string) {
  stompClient = client;
  tableId = id;
}

export function isTableFxBusy() {
  return pumping || getFx().streetBusy || getFx().showdownRunning;
}

export function resetTablePipeline() {
  fxGen += 1;
  pumping = false;
  skipVisualOnce = false;
  showdownHighlightDone = false;
  lastWsAt = 0;
  streetCoalesceUntil = 0;
  if (tableUpdateTimer != null) {
    window.clearTimeout(tableUpdateTimer);
    tableUpdateTimer = null;
  }
  clearHeroHoleCache();
  layoutRegistry.clear();
  patchFx({
    hideBets: false,
    flying: [],
    potPulse: null,
    winnerPulseUserId: null,
    displayedPot: null,
    chipOverrides: {},
    dimCards: false,
    rankTokens: [],
    kickerTokens: [],
    badges: [],
    emotes: [],
    dealFrom: 99,
    holeDealFrom: 99,
    streetBusy: false,
    showdownRunning: false,
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function afterPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function logical() {
  return useTableStore.getState().logical;
}

function displayed() {
  return useTableStore.getState().displayed;
}

function setLogical(next: TableSnapshot) {
  useTableStore.getState().setLogical(next);
}

function setDisplayed(next: TableSnapshot) {
  useTableStore.getState().setDisplayed(next);
}

function markWsEvent() {
  lastWsAt = Date.now();
}

function eventTurnSeat(event: Record<string, unknown>): number | undefined {
  if (event.current_turn_seat != null) {
    return Number(event.current_turn_seat);
  }
  if (event.currentTurnSeat != null) {
    return Number(event.currentTurnSeat);
  }
  return undefined;
}

function isTurnPlaceholderUpdate(from: TableSnapshot, to: TableSnapshot) {
  return (
    Number(to.game.current_turn_seat) === -1 &&
    Number(from.game.current_turn_seat ?? -1) >= 0 &&
    from.game.state === to.game.state &&
    boardOf(from).join() === boardOf(to).join()
  );
}

function isStreetAdvanced(previousState: string | undefined, nextState: string | undefined) {
  const prevIdx = STREET_ORDER.indexOf(previousState || "");
  const nextIdx = STREET_ORDER.indexOf(nextState || "");
  return prevIdx >= 0 && nextIdx > prevIdx;
}

function boardOf(data: TableSnapshot | null) {
  return data?.community_cards?.length
    ? data.community_cards
    : data?.game.community_cards || [];
}

function contributionsFromSnapshot(data: TableSnapshot | null) {
  const list: Array<{ user_id: string; amount: number }> = [];
  (data?.game.players || []).forEach((player) => {
    const amount = Number(player.round_contribution || 0);
    if (amount > 0) {
      list.push({ user_id: String(player.user_id), amount });
    }
  });
  return list;
}

function withZeroBets(data: TableSnapshot): TableSnapshot {
  const players = (data.game.players || []).map((p) => ({ ...p, round_contribution: 0 }));
  const byId = new Map(players.map((p) => [String(p.user_id), p] as const));
  const opponent_seats_by_pos = { ...data.opponent_seats_by_pos };
  for (const [pos, seat] of Object.entries(opponent_seats_by_pos)) {
    if (!seat) {
      continue;
    }
    const patched = byId.get(String(seat.user_id));
    opponent_seats_by_pos[pos] = patched
      ? { ...seat, ...patched, round_contribution: 0 }
      : { ...seat, round_contribution: 0 };
  }
  return {
    ...data,
    opponent_seats_by_pos,
    game: { ...data.game, players },
    my_player: data.my_player
      ? { ...(byId.get(String(data.my_player.user_id)) || data.my_player), round_contribution: 0 }
      : data.my_player,
  };
}

function patchDisplayedContributions(
  view: TableSnapshot,
  contributions: Array<{ user_id: string; amount: number }>,
): TableSnapshot {
  const byId = new Map(
    contributions.map((entry) => [String(entry.user_id), Number(entry.amount)] as const),
  );
  const players = (view.game.players || []).map((p) => {
    const amount = byId.get(String(p.user_id));
    return amount != null ? { ...p, round_contribution: amount } : p;
  });
  const opponent_seats_by_pos = { ...view.opponent_seats_by_pos };
  for (const [pos, seat] of Object.entries(opponent_seats_by_pos)) {
    if (!seat) {
      continue;
    }
    const amount = byId.get(String(seat.user_id));
    if (amount != null) {
      opponent_seats_by_pos[pos] = { ...seat, round_contribution: amount };
    }
  }
  const heroAmount =
    view.my_player != null ? byId.get(String(view.my_player.user_id)) : undefined;
  return {
    ...view,
    opponent_seats_by_pos,
    game: { ...view.game, players },
    my_player:
      view.my_player && heroAmount != null
        ? { ...view.my_player, round_contribution: heroAmount }
        : view.my_player,
  };
}

function mergeBoard(data: TableSnapshot, board: string[]): TableSnapshot {
  return {
    ...data,
    community_cards: board,
    game: { ...data.game, community_cards: board },
  };
}

function mergeHoles(from: TableSnapshot, to: TableSnapshot): TableSnapshot {
  const byId = new Map((to.game.players || []).map((p) => [String(p.user_id), p] as const));
  const players = (from.game.players || []).map((p) => {
    const next = byId.get(String(p.user_id));
    return next ? { ...p, cards: next.cards } : p;
  });
  const opponent_seats_by_pos = { ...from.opponent_seats_by_pos };
  Object.keys(opponent_seats_by_pos).forEach((pos) => {
    const seat = opponent_seats_by_pos[pos];
    if (!seat) {
      return;
    }
    const next = byId.get(String(seat.user_id));
    if (next) {
      opponent_seats_by_pos[pos] = { ...seat, cards: next.cards };
    }
  });
  return {
    ...from,
    my_cards: to.my_cards,
    game: { ...from.game, players },
    opponent_seats_by_pos,
  };
}

function snapshotsVisuallyEqual(a: TableSnapshot, b: TableSnapshot) {
  return (
    a.game.state === b.game.state &&
    a.game.pot === b.game.pot &&
    a.game.current_turn_seat === b.game.current_turn_seat &&
    boardOf(a).join() === boardOf(b).join() &&
    (a.my_cards || []).join() === (b.my_cards || []).join() &&
    (a.game.players || [])
      .map((p) => `${p.user_id}:${p.chips}:${p.round_contribution}:${p.status}:${(p.cards || []).join()}`)
      .join("|") ===
      (b.game.players || [])
        .map((p) => `${p.user_id}:${p.chips}:${p.round_contribution}:${p.status}:${(p.cards || []).join()}`)
        .join("|")
  );
}

function clearShowdownFx() {
  patchFx({
    dimCards: false,
    rankTokens: [],
    kickerTokens: [],
    badges: [],
    winnerPulseUserId: null,
  });
}

function jumpDisplayed(next: TableSnapshot, opts: { staticShowdown?: boolean } = {}) {
  setDisplayed(next);
  patchFx({
    hideBets: false,
    flying: [],
    potPulse: null,
    winnerPulseUserId: null,
    displayedPot: next.game.pot ?? 0,
    chipOverrides: {},
    dealFrom: 99,
    holeDealFrom: 99,
  });
  if (opts.staticShowdown && next.game.showdown_details?.payouts?.length) {
    applyStaticShowdown(next.game.showdown_details);
  } else if (!isShowdownPhase(next.game.state)) {
    clearShowdownFx();
  }
}

async function spawnFlyingChip(
  from: { x: number; y: number },
  to: { x: number; y: number },
  amount: number,
  delayMs: number,
  gen: number,
) {
  const chip: FlyingChip = {
    id: flySeq++,
    amount,
    x: from.x,
    y: from.y,
    dx: to.x - from.x,
    dy: to.y - from.y,
    delay: delayMs,
    duration: CHIP_COLLECT_DURATION_MS,
  };
  patchFx({ flying: [...getFx().flying, chip] });
  await sleep(CHIP_COLLECT_DURATION_MS + delayMs + 30);
  if (gen !== fxGen) {
    return;
  }
  patchFx({ flying: getFx().flying.filter((item) => item.id !== chip.id) });
}

async function collectBetsToPot(
  contributions: Array<{ user_id: string; amount: number }>,
  newPot: number | undefined,
  gen: number,
) {
  const active = contributions.filter((c) => c.amount > 0);
  if (!active.length) {
    return;
  }
  await afterPaint();
  if (gen !== fxGen) {
    return;
  }
  const potCenter = layoutRegistry.potCenter();
  if (!potCenter) {
    const view = displayed();
    if (view) {
      setDisplayed(withZeroBets(view));
    }
    if (newPot != null) {
      patchFx({ displayedPot: newPot, hideBets: false });
    }
    return;
  }
  patchFx({ hideBets: true });
  await Promise.all(
    active.map((entry, index) => {
      const from = layoutRegistry.betCenter(entry.user_id);
      if (!from) {
        return Promise.resolve();
      }
      return spawnFlyingChip(from, potCenter, entry.amount, index * CHIP_COLLECT_STAGGER_MS, gen);
    }),
  );
  if (gen !== fxGen) {
    return;
  }
  const view = displayed();
  if (view) {
    setDisplayed(withZeroBets(view));
  }
  patchFx({
    hideBets: false,
    potPulse: "collect",
    displayedPot: newPot ?? getFx().displayedPot,
  });
  playSound("bet");
  window.setTimeout(() => {
    if (getFx().potPulse === "collect") {
      patchFx({ potPulse: null });
    }
  }, 400);
}

async function payPotToWinner(userId: string, amount: number, gen: number) {
  if (!amount || amount <= 0) {
    return;
  }
  await afterPaint();
  if (gen !== fxGen) {
    return;
  }
  const potCenter = layoutRegistry.potCenter();
  const target = layoutRegistry.chipCenter(userId);
  if (!potCenter || !target) {
    return;
  }
  const chipCount = amount >= 400 ? 3 : amount >= 150 ? 2 : 1;
  const baseAmount = Math.floor(amount / chipCount);
  const remainder = amount - baseAmount * chipCount;
  await Promise.all(
    Array.from({ length: chipCount }, (_, i) => {
      const chipAmount = i === chipCount - 1 ? baseAmount + remainder : baseAmount;
      return spawnFlyingChip(potCenter, target, chipAmount, i * CHIP_PAYOUT_STAGGER_MS, gen);
    }),
  );
  if (gen !== fxGen) {
    return;
  }
  const currentPot = getFx().displayedPot ?? displayed()?.game.pot ?? 0;
  const chips = { ...getFx().chipOverrides };
  chips[String(userId)] = (chips[String(userId)] ?? 0) + amount;
  patchFx({
    displayedPot: Math.max(0, Number(currentPot) - amount),
    chipOverrides: chips,
    potPulse: "payout",
    winnerPulseUserId: String(userId),
  });
  playSound("bet");
  window.setTimeout(() => {
    if (getFx().potPulse === "payout") {
      patchFx({ potPulse: null, winnerPulseUserId: null });
    }
  }, 500);
}

function needsPrivateHeroCards(data: TableSnapshot | null): boolean {
  if (!data || data.is_dev_table) {
    return false;
  }
  const state = data.game.state || "";
  if (!["PRE_FLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"].includes(state)) {
    return false;
  }
  return realHoleCards(data.my_cards).length === 0;
}

function requestHeroHoleCards(id: string) {
  if (!id || holeCardsInflight) {
    return;
  }
  holeCardsInflight = fetchHeroHoleCards(id)
    .then((cards) => {
      if (!cards.length) {
        return;
      }
      const prev = logical();
      if (!prev || prev.table_id !== id || !needsPrivateHeroCards(prev)) {
        return;
      }
      setLogical({ ...prev, my_cards: cards });
      requestFxPump();
    })
    .finally(() => {
      holeCardsInflight = null;
    });
}

function resolveEventHeroCards(
  state: Record<string, unknown>,
  hinted?: string[],
): string[] | undefined {
  const fromHint = realHoleCards(hinted);
  if (fromHint.length) {
    return fromHint;
  }
  const prevSnap = logical();
  const myId = String(prevSnap?.user?.user_id || prevSnap?.my_player?.user_id || "");
  const fromEvent = heroCardsFromPayload(state, myId);
  return fromEvent.length ? fromEvent : hinted;
}

function applyLogicalFromEvent(
  event: Record<string, unknown>,
  options: { myCards?: string[] } = {},
): TableSnapshot | null {
  const prev = logical();
  if (!prev) {
    return null;
  }
  const nested =
    event.game && typeof event.game === "object"
      ? (event.game as Record<string, unknown>)
      : event;
  const game = gameFromPayload({ ...prev.game, ...nested });
  const incomingPlayers = Array.isArray(nested.players)
    ? game.players
    : Array.isArray(event.players)
      ? gameFromPayload({ players: event.players }).players
      : undefined;
  game.players = mergePlayersList(prev.game.players, incomingPlayers);
  if (event.showdown_details || event.showdownDetails) {
    game.showdown_details = (event.showdown_details ||
      event.showdownDetails) as TableSnapshot["game"]["showdown_details"];
  }
  const next = buildSnapshotFromGame(game, prev, options.myCards ?? prev.my_cards);
  setLogical(next);
  if (needsPrivateHeroCards(next)) {
    requestHeroHoleCards(next.table_id);
  }
  return next;
}

function applyLogicalStreetEnd(event: Record<string, unknown>) {
  const prev = logical();
  if (!prev) {
    return;
  }
  const withZero: TableSnapshot = {
    ...prev,
    game: {
      ...prev.game,
      players: (prev.game.players || []).map((p) => ({ ...p, round_contribution: 0 })),
    },
  };
  const next = applyStreetEndEvent(withZero, event);
  setLogical(next);
  if (needsPrivateHeroCards(next)) {
    requestHeroHoleCards(next.table_id);
  }
}

function prepareShowdownChipOverrides(
  details: ShowdownDetails,
  players: TableSnapshot["game"]["players"],
) {
  const payoutByUser = getPayoutTotalsByUser(details.payouts);
  const overrides: Record<string, number> = {};
  (players || []).forEach((p) => {
    const win = payoutByUser[String(p.user_id)] || 0;
    if (win > 0) {
      overrides[String(p.user_id)] = p.chips - win;
    }
  });
  return overrides;
}

function applyStaticShowdown(details: ShowdownDetails) {
  const rank: string[] = [];
  const kicker: string[] = [];
  const badges = (details.payouts || []).map((payout) => {
    const cards = resolveShowdownHighlightCards(payout, details);
    rank.push(...cards.rankCards);
    kicker.push(...cards.kickerCards);
    return buildShowdownBadge(payout);
  });
  patchFx({
    dimCards: true,
    rankTokens: [...new Set(rank)],
    kickerTokens: [...new Set(kicker)],
    badges,
  });
}

async function playShowdownSequence(details: ShowdownDetails, gen: number) {
  const raw = details.payouts || [];
  if (!raw.length) {
    return;
  }
  patchFx({ showdownRunning: true });
  const unique = new Set(raw.map((p) => String(p.user_id)));
  const payouts = aggregatePayouts(raw);
  const view = displayed() || logical();
  if (view) {
    patchFx({
      chipOverrides: prepareShowdownChipOverrides(details, view.game.players),
      displayedPot: Math.max(
        Number(getFx().displayedPot ?? view.game.pot ?? 0),
        getTotalPayoutAmount(details.payouts as ShowdownPayout[]),
      ),
    });
  }
  for (const payout of payouts) {
    if (gen !== fxGen) {
      break;
    }
    const { rankCards, kickerCards } = resolveShowdownHighlightCards(payout, details);
    patchFx({
      dimCards: true,
      rankTokens: rankCards,
      kickerTokens: kickerCards,
      badges: [buildShowdownBadge(payout, true)],
    });
    await sleep(unique.size === 1 ? 4000 : 2500);
    if (gen !== fxGen) {
      break;
    }
    await payPotToWinner(String(payout.user_id), payout.amount, gen);
    await sleep(unique.size === 1 ? 1500 : 1000);
  }
  if (gen === fxGen) {
    await sleep(800);
    clearShowdownFx();
    showdownHighlightDone = true;
    patchFx({ displayedPot: 0, chipOverrides: {}, showdownRunning: false });
  } else {
    patchFx({ showdownRunning: false });
  }
}

function hiddenDocument() {
  return typeof document !== "undefined" && document.hidden;
}

async function playDealBoard(fromLen: number, board: string[], gen: number) {
  const view = displayed();
  if (!view) {
    return;
  }
  setDisplayed(mergeBoard(view, board));
  patchFx({ dealFrom: fromLen });
  const added = board.length - fromLen;
  for (let i = 0; i < added; i += 1) {
    playSound("card");
  }
  const waitMs = fromLen === 0 && board.length >= 3 ? CARD_DEAL_MS + FLOP_EXTRA_MS : CARD_DEAL_MS + 50;
  await sleep(waitMs);
  if (gen !== fxGen) {
    return;
  }
  patchFx({ dealFrom: 99 });
}

async function playDealHoles(gen: number) {
  const view = displayed();
  const next = logical();
  if (!view || !next) {
    return;
  }
  setDisplayed(mergeHoles(view, next));
  patchFx({ holeDealFrom: 0 });
  playSound("card");
  await sleep(HOLE_DEAL_MS);
  if (gen !== fxGen) {
    return;
  }
  patchFx({ holeDealFrom: 99 });
}

function commitDisplayed(next: TableSnapshot) {
  const view = displayed();
  if (view && isTurnPlaceholderUpdate(view, next)) {
    return;
  }
  if (next.game.state === "WAITING_FOR_PLAYERS") {
    showdownHighlightDone = false;
    clearShowdownFx();
    patchFx({ displayedPot: null, chipOverrides: {}, dealFrom: 99, holeDealFrom: 99 });
  } else if (!isShowdownPhase(next.game.state) && getFx().displayedPot == null) {
    patchFx({ displayedPot: next.game.pot ?? 0 });
  } else if (!isShowdownPhase(next.game.state) && !getFx().showdownRunning) {
    patchFx({ displayedPot: next.game.pot ?? getFx().displayedPot });
  }
  setDisplayed(next);
  if (needsPrivateHeroCards(next)) {
    requestHeroHoleCards(next.table_id);
  }
}

async function pumpFx() {
  if (pumping) {
    return;
  }
  pumping = true;
  const gen = fxGen;
  patchFx({ streetBusy: true });
  try {
    while (gen === fxGen) {
      const from = displayed();
      const to = logical();
      if (!from || !to) {
        break;
      }
      const skip = skipVisualOnce || to.game.skip_animations === true || hiddenDocument();
      if (skip) {
        skipVisualOnce = false;
        jumpDisplayed(to, {
          staticShowdown: Boolean(to.game.showdown_details?.payouts?.length),
        });
        if (isShowdownPhase(to.game.state) && to.game.showdown_details?.payouts?.length) {
          showdownHighlightDone = true;
        }
        break;
      }

      const contrib = contributionsFromSnapshot(from);
      const toHasBets = contributionsFromSnapshot(to).length > 0;
      if (
        contrib.length &&
        !toHasBets &&
        (isStreetAdvanced(from.game.state, to.game.state) ||
          (from.game.state === to.game.state && Number(from.game.pot) !== Number(to.game.pot)))
      ) {
        await collectBetsToPot(contrib, to.game.pot, gen);
        continue;
      }

      const fromBoard = boardOf(from);
      const toBoard = boardOf(to);
      if (toBoard.length > fromBoard.length) {
        await playDealBoard(fromBoard.length, toBoard, gen);
        continue;
      }

      const fromHoles = realHoleCards(from.my_cards).length;
      const toHoles = realHoleCards(to.my_cards).length;
      const fromHadBacks = (from.my_cards || []).length === 0 && from.game.state === "WAITING_FOR_PLAYERS";
      const toHasBacks =
        (to.my_player && (to.my_cards || []).length > 0) ||
        (to.game.players || []).some((p) => (p.cards || []).length > 0);
      if (
        (fromHoles === 0 && toHoles > 0) ||
        (fromHadBacks && toHasBacks && from.game.state === "WAITING_FOR_PLAYERS" && to.game.state === "PRE_FLOP")
      ) {
        await playDealHoles(gen);
        continue;
      }

      if (
        isShowdownPhase(to.game.state) &&
        to.game.showdown_details?.payouts?.length &&
        !showdownHighlightDone &&
        !getFx().showdownRunning
      ) {
        const payoutTotal = getTotalPayoutAmount(to.game.showdown_details.payouts as ShowdownPayout[]);
        patchFx({
          displayedPot: Math.max(Number(getFx().displayedPot ?? 0), payoutTotal),
        });
        commitDisplayed({
          ...to,
          community_cards: boardOf(to).length ? boardOf(to) : from.community_cards,
        });
        await playShowdownSequence(to.game.showdown_details, gen);
        continue;
      }

      if (isTurnPlaceholderUpdate(from, to)) {
        break;
      }

      if (!snapshotsVisuallyEqual(from, to)) {
        commitDisplayed(to);
      }
      break;
    }
  } finally {
    if (gen === fxGen) {
      pumping = false;
      patchFx({ streetBusy: false });
      const from = displayed();
      const to = logical();
      if (from && to && !snapshotsVisuallyEqual(from, to)) {
        void pumpFx();
      }
    } else {
      pumping = false;
    }
  }
}

export function requestFxPump() {
  void pumpFx();
}

export async function applyHttpTableSnapshot(data: TableSnapshot, reason: string) {
  console.log(`🔄 HTTP resync стола (${reason})`);
  const prevLogical = logical();

  if (!prevLogical) {
    useTableStore.getState().setSnapshot(data);
    patchFx({ dealFrom: 99, holeDealFrom: 99, displayedPot: data.game.pot ?? null });
    if (isShowdownPhase(data.game.state) && data.game.showdown_details) {
      applyStaticShowdown(data.game.showdown_details);
      showdownHighlightDone = true;
    }
    if (needsPrivateHeroCards(data)) {
      requestHeroHoleCards(data.table_id);
    }
    return;
  }
  if (prevLogical.my_player && !data.my_player) {
    const cards = realHoleCards(data.my_cards);
    if (cards.length) {
      setLogical({ ...prevLogical, my_cards: cards });
    }
    return;
  }
  const next = {
    ...buildSnapshotFromGame(data.game, { ...prevLogical, ...data }, data.my_cards),
    panel_emotes: data.panel_emotes || prevLogical.panel_emotes,
    emotes_dict: data.emotes_dict || prevLogical.emotes_dict,
    emotes_lottie_dict: data.emotes_lottie_dict || prevLogical.emotes_lottie_dict,
    is_dev_table: data.is_dev_table ?? prevLogical.is_dev_table,
  };
  setLogical(next);
  if (needsPrivateHeroCards(next)) {
    requestHeroHoleCards(next.table_id);
  }

  const reconnectLike = reason === "snapshot-fallback" || reason.startsWith("reconnect");
  const recentWs = lastWsAt > 0 && Date.now() - lastWsAt < RECENT_WS_MS;
  if (!reconnectLike && recentWs) {
    return;
  }
  if (isTableFxBusy() && !reconnectLike) {
    return;
  }
  skipVisualOnce = true;
  requestFxPump();
}

export function showPlayerEmote(userId: string, emoteId: string) {
  const id = emoteSeq++;
  patchFx({
    emotes: [
      ...getFx().emotes.filter((e) => e.userId !== String(userId)),
      { id, userId: String(userId), emoteId },
    ],
  });
  window.setTimeout(() => {
    patchFx({ emotes: getFx().emotes.filter((e) => e.id !== id) });
  }, 3000);
}

export function sendTableEmote(emoteId: string, userId: string) {
  if (stompClient?.connected && tableId) {
    stompClient.publish({
      destination: `/app/table/${tableId}/emote`,
      body: JSON.stringify({
        event_type: "EMOTE",
        user_id: userId,
        emote_id: emoteId,
      }),
    });
    return;
  }
  const snap = logical();
  if (snap?.is_dev_table) {
    showPlayerEmote(userId, emoteId);
  }
}

export async function dispatchTableEvent(data: Record<string, unknown>) {
  const event = unwrapTableEvent(data);
  const type = String(event.event_type ?? "");
  console.log("⚡ ИВЕНТ:", type, event);
  markWsEvent();

  switch (type) {
    case "TABLE_UPDATE": {
      applyLogicalFromEvent(event, { myCards: resolveEventHeroCards(event) });
      if (event.skip_animations === true) {
        skipVisualOnce = true;
        if (tableUpdateTimer != null) {
          window.clearTimeout(tableUpdateTimer);
          tableUpdateTimer = null;
        }
        requestFxPump();
        break;
      }
      const turn = eventTurnSeat(event);
      if (turn === -1 && Date.now() >= streetCoalesceUntil) {
        if (tableUpdateTimer != null) {
          window.clearTimeout(tableUpdateTimer);
        }
        tableUpdateTimer = window.setTimeout(() => {
          tableUpdateTimer = null;
          requestFxPump();
        }, TABLE_UPDATE_DEBOUNCE_MS);
        break;
      }
      if (tableUpdateTimer != null) {
        window.clearTimeout(tableUpdateTimer);
        tableUpdateTimer = null;
      }
      requestFxPump();
      break;
    }
    case "STREET_END": {
      const view = displayed();
      const fromEvent = normalizeContributions(event.contributions);
      const contrib = fromEvent.length ? fromEvent : contributionsFromSnapshot(view);
      applyLogicalStreetEnd(event);
      streetCoalesceUntil = Date.now() + TABLE_UPDATE_DEBOUNCE_MS + 30;
      if (contrib.length && view) {
        setDisplayed(patchDisplayedContributions(view, contrib));
      }
      requestFxPump();
      break;
    }
    case "PLAYER_ACTION": {
      const prev = logical();
      if (prev) {
        const next = applyPlayerActionEvent(prev, event);
        setLogical(next);
        const view = displayed();
        if (view) {
          setDisplayed(applyPlayerActionEvent(view, event));
        } else {
          setDisplayed(next);
        }
        const status = (event.player_state as { status?: string } | undefined)?.status;
        playSound(status === "FOLDED" ? "fold" : "bet");
      }
      break;
    }
    case "PLAYER_STATUS":
      break;
    case "EMOTE":
      showPlayerEmote(String(event.user_id ?? ""), String(event.emote_id ?? ""));
      break;
    case "ERROR":
    case "EMOTE_REJECTED": {
      const errorType = String(event.errorType || event.error_type || "");
      const message = String(event.message || event.error_message || "Действие отклонено");
      const isEmoteError =
        type === "EMOTE_REJECTED" ||
        /emote/i.test(errorType) ||
        /emote/i.test(message) ||
        Boolean(event.emote_id);
      if (isEmoteError) {
        toastFn?.("error", errorType || "EmoteRejected", message);
      }
      break;
    }
    default:
      break;
  }
}

export async function applyStompSnapshotPayload(
  data: Record<string, unknown>,
  _isReconnect: boolean,
) {
  const event = unwrapTableEvent(data);
  markWsEvent();
  skipVisualOnce = true;
  applyLogicalFromEvent(event, { myCards: resolveEventHeroCards(event) });
  requestFxPump();
}

export function seedInitialTableFx(data: TableSnapshot) {
  resetTablePipeline();
  useTableStore.getState().setSnapshot(data);
  patchFx({
    displayedPot: data.game.pot ?? 0,
    dealFrom: 99,
    holeDealFrom: 99,
  });
  if (isShowdownPhase(data.game.state) && data.game.showdown_details?.payouts?.length) {
    applyStaticShowdown(data.game.showdown_details);
    showdownHighlightDone = true;
  }
  if (needsPrivateHeroCards(data)) {
    requestHeroHoleCards(data.table_id);
  }
}

export function resetShowdownPipelineFlags() {
  showdownHighlightDone = false;
  fxGen += 1;
  pumping = false;
  patchFx({ streetBusy: false, showdownRunning: false, flying: [], hideBets: false });
}
