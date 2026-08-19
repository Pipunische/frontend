import { create } from "zustand";
import type { ShowdownBadge } from "./showdown";

export type FlyingChip = {
  id: number;
  amount: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
  duration: number;
};

export type SeatEmote = {
  id: number;
  userId: string;
  emoteId: string;
};

export type TableFx = {
  hideBets: boolean;
  flying: FlyingChip[];
  potPulse: "collect" | "payout" | null;
  winnerPulseUserId: string | null;
  displayedPot: number | null;
  chipOverrides: Record<string, number>;
  dimCards: boolean;
  rankTokens: string[];
  kickerTokens: string[];
  badges: ShowdownBadge[];
  emotes: SeatEmote[];
  dealFrom: number;
  holeDealFrom: number;
  streetBusy: boolean;
  showdownRunning: boolean;
};

const emptyFx = (): TableFx => ({
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

type FxStore = {
  fx: TableFx;
  setFx: (patch: Partial<TableFx>) => void;
  resetFx: () => void;
};

export const useTableFxStore = create<FxStore>((set) => ({
  fx: emptyFx(),
  setFx: (patch) => set((state) => ({ fx: { ...state.fx, ...patch } })),
  resetFx: () => set({ fx: emptyFx() }),
}));

export function patchFx(patch: Partial<TableFx>) {
  useTableFxStore.getState().setFx(patch);
}

export function getFx(): TableFx {
  return useTableFxStore.getState().fx;
}