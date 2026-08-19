export type Point = { x: number; y: number };

function centerOf(el: Element | null | undefined): Point | null {
  if (!el) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    return null;
  }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const seats = new Map<string, HTMLElement>();
const bets = new Map<string, HTMLElement>();
const chips = new Map<string, HTMLElement>();
let potEl: HTMLElement | null = null;

export const layoutRegistry = {
  setPot(el: HTMLElement | null) {
    potEl = el;
  },
  setSeat(userId: string, el: HTMLElement | null) {
    const id = String(userId);
    if (!id) {
      return;
    }
    if (el) {
      seats.set(id, el);
    } else {
      seats.delete(id);
    }
  },
  setBet(userId: string, el: HTMLElement | null) {
    const id = String(userId);
    if (!id) {
      return;
    }
    if (el) {
      bets.set(id, el);
    } else {
      bets.delete(id);
    }
  },
  setChips(userId: string, el: HTMLElement | null) {
    const id = String(userId);
    if (!id) {
      return;
    }
    if (el) {
      chips.set(id, el);
    } else {
      chips.delete(id);
    }
  },
  potCenter(): Point | null {
    return centerOf(potEl);
  },
  betCenter(userId: string): Point | null {
    const id = String(userId);
    return centerOf(bets.get(id)) || centerOf(seats.get(id));
  },
  chipCenter(userId: string): Point | null {
    const id = String(userId);
    return centerOf(chips.get(id)) || centerOf(seats.get(id));
  },
  clear() {
    seats.clear();
    bets.clear();
    chips.clear();
    potEl = null;
  },
};
