export function formatPokerAmount(value: unknown): string {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) {
    return value != null ? String(value) : "0";
  }

  if (n >= 1_000_000) {
    const scaled = n / 1_000_000;
    if (scaled === Math.floor(scaled)) {
      return `${Math.floor(scaled)}M`;
    }
    return `${Number.parseFloat(scaled.toFixed(1))}M`;
  }

  if (n >= 1_000) {
    const scaled = n / 1_000;
    if (scaled === Math.floor(scaled)) {
      return `${Math.floor(scaled)}K`;
    }
    return `${Number.parseFloat(scaled.toFixed(1))}K`;
  }

  return String(n);
}

export function formatSpacedInt(value: unknown): string {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) {
    return value != null ? String(value) : "0";
  }
  return n.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

export function formatBlinds(blinds: unknown): string {
  const text = String(blinds ?? "").trim();
  if (!text) {
    return "0/0";
  }
  if (/[a-zA-Z]/.test(text)) {
    return text;
  }
  const parts = text.split("/");
  if (parts.length === 2) {
    return `${formatPokerAmount(parts[0].trim())}/${formatPokerAmount(parts[1].trim())}`;
  }
  return formatPokerAmount(text);
}

export function stakeClass(minBuyIn: number): string {
  if (minBuyIn >= 10000) {
    return "stake-vip";
  }
  if (minBuyIn >= 1000) {
    return "stake-standard";
  }
  return "stake-low";
}
