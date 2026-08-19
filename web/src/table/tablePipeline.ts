import type { Client } from "@stomp/stompjs";
import type { TableSnapshot } from "../api/table";
import { fetchHeroHoleCards } from "../api/table";
import { playSound } from "../lib/sounds";
import { realHoleCards } from "../lib/cards";
import {
  applyPlayerActionEvent,
  applyStreetEndEvent,
  buildSnapshotFromGame,
  gameFromPayload,
} from "./layout";
import {
  aggregatePayouts,
  buildShowdownBadge,
  getPayoutTotalsByUser,
  getShowdownDetails,
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
let collectGen = 0;
let pendingTableUpdate: Record<string, unknown> | null = null;
let pendingPostShowdown: Record<string, unknown> | null = null;
let showdownHighlightDone = false;
let showdownSequenceLock = false;
let showdownAbort = false;
let holeCardsInflight: Promise<void> | null = null;

export function setTableToastHandler(fn: ToastFn | null) {
  toastFn = fn;
}

export function setTableStompClient(client: Client | null, id: string) {
  stompClient = client;
  tableId = id;
}

export function resetTablePipeline() {
  collectGen += 1;
  pendingTableUpdate = null;
  pendingPostShowdown = null;
  showdownHighlightDone = false;
  showdownSequenceLock = false;
  showdownAbort = true;
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
    streetBusy: false,
    showdownRunning: false,
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function elementCenter(el: Element | null) {
  if (!el) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function seatEl(userId: string) {
  return document.querySelector(`.player-seat[data-userid="${userId}"]`);
}

function snapshot() {
  return useTableStore.getState().snapshot;
}

function setSnapshot(next: TableSnapshot) {
  useTableStore.getState().setSnapshot(next);
}

function isStreetAdvanced(previousState: string | undefined, nextState: string | undefined) {
  const prevIdx = STREET_ORDER.indexOf(previousState || "");
  const nextIdx = STREET_ORDER.indexOf(nextState || "");
  return prevIdx >= 0 && nextIdx > prevIdx;
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

function clearShowdownFx() {
  patchFx({
    dimCards: false,
    rankTokens: [],
    kickerTokens: [],
    badges: [],
    winnerPulseUserId: null,
  });
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
  if (gen !== collectGen) {
    return;
  }
  patchFx({ flying: getFx().flying.filter((item) => item.id !== chip.id) });
}

async function collectBetsToPot(
  contributions: Array<{ user_id: string; amount: number }>,
  newPot: number | undefined,
) {
  const active = contributions.filter((c) => c.amount > 0);
  if (!active.length) {
    return;
  }
  const gen = collectGen;
  const potEl = document.querySelector(".table-pot");
  const potCenter = elementCenter(potEl);
  if (!potCenter) {
    return;
  }
  patchFx({ hideBets: true });
  await Promise.all(
    active.map((entry, index) => {
      const seat = seatEl(String(entry.user_id));
      const betEl = seat?.querySelector(".player-bet") || seat;
      const from = elementCenter(betEl) || elementCenter(seat);
      if (!from) {
        return Promise.resolve();
      }
      return spawnFlyingChip(from, potCenter, entry.amount, index * CHIP_COLLECT_STAGGER_MS, gen);
    }),
  );
  if (gen !== collectGen) {
    return;
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

async function payPotToWinner(userId: string, amount: number) {
  if (!amount || amount <= 0) {
    return;
  }
  const gen = collectGen;
  const potEl = document.querySelector(".table-pot");
  const winnerSeat = seatEl(String(userId));
  const potCenter = elementCenter(potEl);
  const target = elementCenter(winnerSeat?.querySelector(".player-chips") || winnerSeat);
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
  if (gen !== collectGen) {
    return;
  }
  const currentPot = getFx().displayedPot ?? snapshot()?.game.pot ?? 0;
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
      const prev = snapshot();
      if (!prev || prev.table_id !== id || !needsPrivateHeroCards(prev)) {
        return;
      }
      setSnapshot({ ...prev, my_cards: cards });
    })
    .finally(() => {
      holeCardsInflight = null;
    });
}

function applySnapshotFromEvent(
  event: Record<string, unknown>,
  options: { myCards?: string[]; dealFrom?: number } = {},
) {
  const prev = snapshot();
  if (!prev) {
    return;
  }
  const nested =
    event.game && typeof event.game === "object"
      ? (event.game as Record<string, unknown>)
      : event;
  const game = gameFromPayload({ ...prev.game, ...nested });
  if (!Array.isArray(nested.players) && !Array.isArray(event.players)) {
    game.players = prev.game.players;
  }
  if (event.showdown_details || event.showdownDetails) {
    game.showdown_details = (event.showdown_details ||
      event.showdownDetails) as TableSnapshot["game"]["showdown_details"];
  }
  const prevBoardLen = (prev.community_cards || prev.game.community_cards || []).length;
  const next = buildSnapshotFromGame(game, prev, options.myCards ?? prev.my_cards);
  const nextBoardLen = (next.community_cards || []).length;
  const dealFrom =
    options.dealFrom ?? (nextBoardLen > prevBoardLen ? prevBoardLen : getFx().dealFrom);
  if (nextBoardLen > prevBoardLen) {
    for (let i = 0; i < nextBoardLen - prevBoardLen; i += 1) {
      playSound("card");
    }
  }
  setSnapshot(next);
  patchFx({ dealFrom });
  if (needsPrivateHeroCards(next)) {
    requestHeroHoleCards(next.table_id);
  }
}

function applyStreetEndSnapshot(event: Record<string, unknown>) {
  const prev = snapshot();
  if (!prev) {
    return;
  }
  const prevBoardLen = (prev.community_cards || []).length;
  const withZeroBets: TableSnapshot = {
    ...prev,
    game: {
      ...prev.game,
      players: (prev.game.players || []).map((p) => ({ ...p, round_contribution: 0 })),
    },
  };
  const next = applyStreetEndEvent(withZeroBets, event);
  const nextBoardLen = (next.community_cards || []).length;
  setSnapshot(next);
  if (nextBoardLen > prevBoardLen) {
    patchFx({ dealFrom: prevBoardLen });
    for (let i = 0; i < nextBoardLen - prevBoardLen; i += 1) {
      playSound("card");
    }
  }
  if (needsPrivateHeroCards(next)) {
    requestHeroHoleCards(next.table_id);
  }
}

function enqueueTableUpdate(state: Record<string, unknown>) {
  const incomingHasShowdown = Boolean(
    getShowdownDetails(state as { showdown_details?: ShowdownDetails })?.payouts?.length,
  );
  const pendingHasShowdown = Boolean(
    pendingTableUpdate &&
      getShowdownDetails(pendingTableUpdate as { showdown_details?: ShowdownDetails })?.payouts
        ?.length,
  );
  if (pendingTableUpdate && pendingHasShowdown && !incomingHasShowdown) {
    return;
  }
  pendingTableUpdate = state;
}

function flushPendingTableUpdate() {
  if (!pendingTableUpdate) {
    return;
  }
  const state = pendingTableUpdate;
  pendingTableUpdate = null;
  void applyFullTableState(state, { skipCollectAnimation: true, afterCollect: true });
}

async function handleStreetEnd(event: Record<string, unknown>) {
  const contributions = Array.isArray(event.contributions)
    ? (event.contributions as Array<{ user_id: string; amount: number }>)
    : [];
  const hasContributions = contributions.some((c) => c.amount > 0);
  if (hasContributions) {
    await collectBetsToPot(contributions, event.pot != null ? Number(event.pot) : undefined);
  } else if (event.pot != null) {
    patchFx({ displayedPot: Number(event.pot) });
  }
  const hadPending = Boolean(pendingTableUpdate);
  flushPendingTableUpdate();
  if (!hadPending) {
    applyStreetEndSnapshot(event);
  }
  flushPendingTableUpdate();
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

async function playShowdownSequence(details: ShowdownDetails) {
  const raw = details.payouts || [];
  if (!raw.length || showdownSequenceLock || getFx().showdownRunning) {
    return;
  }
  showdownSequenceLock = true;
  showdownAbort = false;
  patchFx({ showdownRunning: true });
  const unique = new Set(raw.map((p) => String(p.user_id)));
  const payouts = aggregatePayouts(raw);
  for (const payout of payouts) {
    if (showdownAbort) {
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
    if (showdownAbort) {
      break;
    }
    await payPotToWinner(String(payout.user_id), payout.amount);
    await sleep(unique.size === 1 ? 1500 : 1000);
  }
  if (!showdownAbort) {
    await sleep(800);
    clearShowdownFx();
    showdownHighlightDone = true;
    showdownSequenceLock = false;
    patchFx({ displayedPot: 0, chipOverrides: {}, showdownRunning: false });
    if (pendingPostShowdown) {
      const pending = pendingPostShowdown;
      pendingPostShowdown = null;
      void applyFullTableState(pending, {
        skipShowdownAnimation: true,
        skipShowdownHighlight: true,
      });
    }
  } else {
    showdownSequenceLock = false;
    patchFx({ showdownRunning: false });
  }
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

function applyShowdownPhase(
  state: Record<string, unknown>,
  options: { skipShowdownAnimation?: boolean; skipShowdownHighlight?: boolean },
) {
  const gameState = String(state.state || snapshot()?.game.state || "");
  if (!isShowdownPhase(gameState)) {
    return;
  }
  if (options.skipShowdownHighlight || showdownHighlightDone || showdownSequenceLock) {
    return;
  }
  const details = getShowdownDetails(state as { showdown_details?: ShowdownDetails });
  if (!details?.payouts?.length) {
    return;
  }
  if (options.skipShowdownAnimation || state.skip_animations === true) {
    applyStaticShowdown(details);
    return;
  }
  void playShowdownSequence(details);
}

async function applyFullTableState(
  state: Record<string, unknown>,
  options: {
    myCards?: string[];
    skipShowdownAnimation?: boolean;
    skipShowdownHighlight?: boolean;
    skipCollectAnimation?: boolean;
    afterCollect?: boolean;
  } = {},
) {
  const skipCollect = Boolean(options.skipCollectAnimation || state.skip_animations === true);
  const prev = snapshot();
  if (getFx().showdownRunning && !options.skipShowdownHighlight) {
    pendingPostShowdown = state;
    return;
  }
  if (skipCollect && getFx().streetBusy) {
    collectGen += 1;
    pendingTableUpdate = null;
    patchFx({ streetBusy: false, flying: [], hideBets: false });
  }
  if (getFx().streetBusy && !options.afterCollect) {
    enqueueTableUpdate(state);
    return;
  }
  const nextState = String(state.state || "");
  const playersHaveBets =
    Array.isArray(state.players) &&
    (state.players as Array<{ round_contribution?: number }>).some(
      (p) => Number(p.round_contribution) > 0,
    );
  if (
    !options.afterCollect &&
    !skipCollect &&
    prev &&
    isStreetAdvanced(prev.game.state, nextState) &&
    contributionsFromSnapshot(prev).length > 0 &&
    !playersHaveBets
  ) {
    patchFx({ streetBusy: true });
    try {
      await collectBetsToPot(
        contributionsFromSnapshot(prev),
        state.pot != null ? Number(state.pot) : undefined,
      );
      applySnapshotFromEvent(state, { myCards: options.myCards });
      applyShowdownPhase(state, options);
    } finally {
      patchFx({ streetBusy: false });
    }
    return;
  }

  if (nextState === "WAITING_FOR_PLAYERS") {
    showdownHighlightDone = false;
    showdownSequenceLock = false;
    clearShowdownFx();
    patchFx({ displayedPot: null, chipOverrides: {}, dealFrom: 99 });
  }

  const details = getShowdownDetails(state as { showdown_details?: ShowdownDetails });
  const willAnimate =
    isShowdownPhase(nextState) &&
    Boolean(details?.payouts?.length) &&
    !options.skipShowdownAnimation &&
    state.skip_animations !== true;

  if (willAnimate && details) {
    const players = (state.players as TableSnapshot["game"]["players"]) || prev?.game.players;
    patchFx({
      chipOverrides: prepareShowdownChipOverrides(details, players),
      displayedPot: Math.max(
        Number(state.pot ?? prev?.game.pot ?? 0),
        getTotalPayoutAmount(details.payouts as ShowdownPayout[]),
      ),
    });
  } else if (state.pot != null) {
    patchFx({ displayedPot: Number(state.pot) });
  }

  applySnapshotFromEvent(state, {
    myCards: options.myCards,
    dealFrom: skipCollect ? 99 : undefined,
  });
  applyShowdownPhase(state, options);
}

export async function applyHttpTableSnapshot(data: TableSnapshot, reason: string) {
  console.log(`🔄 HTTP resync стола (${reason})`);
  const prev = snapshot();
  const canPaintShowdown =
    isShowdownPhase(data.game.state) &&
    Boolean(data.game.showdown_details?.payouts?.length) &&
    !showdownSequenceLock &&
    !showdownHighlightDone &&
    !getFx().showdownRunning;

  if (!prev) {
    setSnapshot(data);
    patchFx({ dealFrom: 99, displayedPot: data.game.pot ?? null });
    if (canPaintShowdown && data.game.showdown_details) {
      applyStaticShowdown(data.game.showdown_details);
    }
    if (needsPrivateHeroCards(data)) {
      requestHeroHoleCards(data.table_id);
    }
    return;
  }
  const next = {
    ...buildSnapshotFromGame(data.game, { ...prev, ...data }, data.my_cards),
    panel_emotes: data.panel_emotes || prev.panel_emotes,
    emotes_dict: data.emotes_dict || prev.emotes_dict,
    emotes_lottie_dict: data.emotes_lottie_dict || prev.emotes_lottie_dict,
    is_dev_table: data.is_dev_table ?? prev.is_dev_table,
  };
  setSnapshot(next);
  patchFx({ dealFrom: 99, displayedPot: data.game.pot ?? getFx().displayedPot });
  if (canPaintShowdown && data.game.showdown_details) {
    applyStaticShowdown(data.game.showdown_details);
  }
  if (needsPrivateHeroCards(next)) {
    requestHeroHoleCards(next.table_id);
  }
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
  const snap = snapshot();
  if (snap?.is_dev_table) {
    showPlayerEmote(userId, emoteId);
  }
}

export async function dispatchTableEvent(data: Record<string, unknown>) {
  const type = String(data.event_type ?? data.eventType ?? "");
  console.log("⚡ ИВЕНТ:", type, data);

  switch (type) {
    case "TABLE_UPDATE":
      if (getFx().streetBusy) {
        enqueueTableUpdate(data);
        break;
      }
      await applyFullTableState(data);
      break;
    case "STREET_END":
      patchFx({ streetBusy: true });
      try {
        await handleStreetEnd(data);
      } finally {
        patchFx({ streetBusy: false });
        flushPendingTableUpdate();
      }
      break;
    case "PLAYER_ACTION": {
      const prev = snapshot();
      if (prev) {
        setSnapshot(applyPlayerActionEvent(prev, data));
        const status = (data.player_state as { status?: string } | undefined)?.status;
        playSound(status === "FOLDED" ? "fold" : "bet");
      }
      break;
    }
    case "EMOTE":
      showPlayerEmote(String(data.user_id ?? ""), String(data.emote_id ?? ""));
      break;
    case "ERROR":
    case "EMOTE_REJECTED": {
      const errorType = String(data.errorType || data.error_type || "");
      const message = String(data.message || data.error_message || "Действие отклонено");
      const isEmoteError =
        type === "EMOTE_REJECTED" ||
        /emote/i.test(errorType) ||
        /emote/i.test(message) ||
        Boolean(data.emote_id);
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
  isReconnect: boolean,
) {
  await applyFullTableState(data, {
    skipShowdownAnimation: isReconnect,
    skipCollectAnimation: isReconnect,
  });
  if (isReconnect) {
    patchFx({ dealFrom: 99 });
  }
}

export function seedInitialTableFx(data: TableSnapshot) {
  resetTablePipeline();
  patchFx({
    displayedPot: data.game.pot ?? 0,
    dealFrom: 99,
  });
  if (isShowdownPhase(data.game.state) && data.game.showdown_details?.payouts?.length) {
    applyStaticShowdown(data.game.showdown_details);
  }
  if (needsPrivateHeroCards(data)) {
    requestHeroHoleCards(data.table_id);
  }
}

export function resetShowdownPipelineFlags() {
  showdownHighlightDone = false;
  showdownSequenceLock = false;
  showdownAbort = true;
  pendingTableUpdate = null;
  pendingPostShowdown = null;
  collectGen += 1;
  patchFx({ streetBusy: false, showdownRunning: false, flying: [], hideBets: false });
}
