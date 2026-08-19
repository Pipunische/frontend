import { create } from "zustand";
import type { TableSnapshot } from "../api/table";

type TableStore = {
  snapshot: TableSnapshot | null;
  pingMs: number;
  setSnapshot: (snapshot: TableSnapshot | null) => void;
  setPingMs: (pingMs: number) => void;
  reset: () => void;
};

export const useTableStore = create<TableStore>((set) => ({
  snapshot: null,
  pingMs: 9999,
  setSnapshot: (snapshot) => set({ snapshot }),
  setPingMs: (pingMs) => set({ pingMs }),
  reset: () => set({ snapshot: null, pingMs: 9999 }),
}));
