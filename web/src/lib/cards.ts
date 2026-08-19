export function isFaceDownCard(card: unknown): boolean {
  if (card == null) {
    return true;
  }
  const value = String(card).trim().toLowerCase();
  return !value || value === "card_back" || value === "back";
}

export function realHoleCards(cards: unknown): string[] {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards.filter((card): card is string => typeof card === "string" && !isFaceDownCard(card));
}

export function normalizeCardFileName(card: string | null | undefined): string {
  if (isFaceDownCard(card)) {
    return "card_back";
  }
  return String(card).trim().toUpperCase();
}

export function parseCardToken(card: unknown): string | null {
  if (card == null) {
    return null;
  }
  if (typeof card === "string") {
    const trimmed = card.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.includes("_")) {
      const [rank, suit] = trimmed.split("_");
      return `${rank}${suit}`;
    }
    return trimmed;
  }
  if (typeof card === "object") {
    const rec = card as Record<string, unknown>;
    const rank = rec.rank ?? rec.Rank ?? rec.value ?? rec.cardRank;
    const suit = rec.suit ?? rec.Suit ?? rec.cardSuit;
    if (rank && suit) {
      const suitMap: Record<string, string> = {
        hearts: "H",
        heart: "H",
        diamonds: "D",
        diamond: "D",
        clubs: "C",
        club: "C",
        spades: "S",
        spade: "S",
      };
      const suitKey = String(suit).toLowerCase();
      const suitChar =
        suitMap[suitKey] || (String(suit).length === 1 ? String(suit).toUpperCase() : "");
      return `${rank}${suitChar}`;
    }
  }
  return String(card);
}

export function cardToken(card: unknown): string {
  return normalizeCardFileName(parseCardToken(card));
}

export function cardPngUrl(card: string | null | undefined): string {
  const name = normalizeCardFileName(card);
  if (name === "card_back") {
    return "/static/cards/card_back.png";
  }
  return `/static/cards/${name}.png`;
}
