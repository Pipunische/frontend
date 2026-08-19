import { cardToken } from "../lib/cards";
import { formatPokerAmount } from "../lib/format";

export type ShowdownPayout = {
  user_id: string;
  amount: number;
  hand_name?: string;
  pot_label?: string;
  is_side_pot?: boolean;
  rank_cards?: unknown;
  kicker_cards?: unknown;
  rankCards?: unknown;
  kickerCards?: unknown;
};

export type ShowdownDetails = {
  payouts?: ShowdownPayout[];
  rank_cards?: unknown;
  kicker_cards?: unknown;
  rankCards?: unknown;
  kickerCards?: unknown;
};

const HAND_NAME_RU: Record<string, string> = {
  HIGH_CARD: "Старшая карта",
  PAIR: "Пара",
  ONE_PAIR: "Пара",
  TWO_PAIR: "Две пары",
  THREE_OF_A_KIND: "Сет",
  SET: "Сет",
  TRIPS: "Трипс",
  STRAIGHT: "Стрит",
  FLUSH: "Флеш",
  FULL_HOUSE: "Фул-хаус",
  FOUR_OF_A_KIND: "Каре",
  QUADS: "Каре",
  STRAIGHT_FLUSH: "Стрит-флеш",
  ROYAL_FLUSH: "Роял-флеш",
  NO_SHOWDOWN: "Без вскрытия",
};

const POT_LABEL_RU: Record<string, string> = {
  TOTAL_POT: "Общий банк",
  MAIN_POT: "Основной банк",
  SIDE_POT: "Доп. банк",
};

function normalizeLabelKey(label: unknown): string {
  return String(label ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function formatHandName(handName: unknown): string {
  if (!handName) {
    return "";
  }
  const key = normalizeLabelKey(handName);
  if (HAND_NAME_RU[key]) {
    return HAND_NAME_RU[key];
  }
  if (/[а-яА-ЯёЁ]/.test(String(handName))) {
    return String(handName);
  }
  return String(handName)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatPotLabel(label: unknown): string {
  if (!label) {
    return "";
  }
  const key = normalizeLabelKey(label);
  return POT_LABEL_RU[key] || String(label);
}

export function normalizeCardList(cards: unknown): string[] {
  if (!cards) {
    return [];
  }
  const list = Array.isArray(cards) ? cards : [cards];
  return list.map((card) => cardToken(card)).filter((token) => token && token !== "CARD_BACK" && token !== "card_back");
}

export function getShowdownDetails(state: {
  showdown_details?: ShowdownDetails | null;
  showdownDetails?: ShowdownDetails | null;
}): ShowdownDetails | null {
  return state.showdown_details ?? state.showdownDetails ?? null;
}

export function resolveShowdownHighlightCards(
  payout: ShowdownPayout,
  details: ShowdownDetails,
): { rankCards: string[]; kickerCards: string[] } {
  return {
    rankCards: normalizeCardList(
      payout.rank_cards ?? payout.rankCards ?? details.rank_cards ?? details.rankCards,
    ),
    kickerCards: normalizeCardList(
      payout.kicker_cards ?? payout.kickerCards ?? details.kicker_cards ?? details.kickerCards,
    ),
  };
}

export function getPayoutTotalsByUser(payouts: ShowdownPayout[] | undefined): Record<string, number> {
  const totals: Record<string, number> = {};
  (payouts || []).forEach((p) => {
    const id = String(p.user_id);
    totals[id] = (totals[id] || 0) + (p.amount || 0);
  });
  return totals;
}

export function getTotalPayoutAmount(payouts: ShowdownPayout[] | undefined): number {
  return (payouts || []).reduce((sum, p) => sum + (p.amount || 0), 0);
}

export function aggregatePayouts(rawPayouts: ShowdownPayout[]): ShowdownPayout[] {
  const uniqueWinners = new Set(rawPayouts.map((p) => String(p.user_id)));
  if (uniqueWinners.size === 1) {
    const totalAmount = rawPayouts.reduce((sum, p) => sum + p.amount, 0);
    return [{ ...rawPayouts[0], amount: totalAmount, pot_label: "TOTAL POT" }];
  }
  return rawPayouts.map((p) => ({
    ...p,
    pot_label: p.is_side_pot ? "SIDE POT" : "MAIN POT",
  }));
}

export type ShowdownBadge = {
  userId: string;
  hand: string;
  amountLabel: string;
  potLabel?: string;
};

export function buildShowdownBadge(payout: ShowdownPayout, includePotLabel = false): ShowdownBadge {
  const hand = formatHandName(payout.hand_name);
  const potLabel = includePotLabel ? formatPotLabel(payout.pot_label) : "";
  return {
    userId: String(payout.user_id),
    hand: potLabel ? `${hand} | ${potLabel}` : hand,
    amountLabel: formatPokerAmount(payout.amount),
  };
}

export function isShowdownPhase(state?: string): boolean {
  return state === "SHOWDOWN" || state === "CLEANUP";
}

export function cardFxClass(
  card: string,
  dimCards: boolean,
  rankTokens: string[],
  kickerTokens: string[],
): string {
  const token = cardToken(card);
  if (rankTokens.includes(token)) {
    return "card-static card-winner-rank";
  }
  if (kickerTokens.includes(token)) {
    return "card-static card-winner-kicker";
  }
  if (dimCards) {
    return "card-static card-dimmed";
  }
  return "card-static";
}