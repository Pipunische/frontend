import { create } from "zustand";
import type { TableSnapshot } from "../api/table";

type TableStore = {
  /** Server truth — always latest. */
  logical: TableSnapshot | null;
  /** What the table paints — lags behind while FX clips play. */
  displayed: TableSnapshot | null;
  /** Alias of displayed for existing UI. */
  snapshot: TableSnapshot | null;
  pingMs: number;
  setLogical: (snapshot: TableSnapshot | null) => void;
  setDisplayed: (snapshot: TableSnapshot | null) => void;
  setSnapshot: (snapshot: TableSnapshot | null) => void;
  setPingMs: (pingMs: number) => void;
  reset: () => void;
};

export const useTableStore = create<TableStore>((set) => ({
  logical: null,
  displayed: null,
  snapshot: null,
  pingMs: 9999,
  setLogical: (logical) => set({ logical }),
  setDisplayed: (displayed) => set({ displayed, snapshot: displayed }),
  setSnapshot: (snapshot) => set({ logical: snapshot, displayed: snapshot, snapshot }),
  setPingMs: (pingMs) => set({ pingMs }),
  reset: () => set({ logical: null, displayed: null, snapshot: null, pingMs: 9999 }),
}));
