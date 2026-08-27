import { create } from "zustand";

interface SelectionState {
  /** Image ids checked for batch delete. */
  deleteIds: Set<string>;
  /** Image ids checked for batch reverse. */
  reverseIds: Set<string>;
  toggleDelete: (id: string) => void;
  toggleReverse: (id: string) => void;
  setDelete: (id: string, on: boolean) => void;
  setReverse: (id: string, on: boolean) => void;
  selectAllDelete: (ids: string[]) => void;
  clearAll: () => void;
}

function toggle(set: Set<string>, id: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  deleteIds: new Set(),
  reverseIds: new Set(),
  toggleDelete: (id) =>
    set((s) => ({ deleteIds: toggle(s.deleteIds, id, !s.deleteIds.has(id)) })),
  toggleReverse: (id) =>
    set((s) => ({ reverseIds: toggle(s.reverseIds, id, !s.reverseIds.has(id)) })),
  setDelete: (id, on) => set((s) => ({ deleteIds: toggle(s.deleteIds, id, on) })),
  setReverse: (id, on) => set((s) => ({ reverseIds: toggle(s.reverseIds, id, on) })),
  selectAllDelete: (ids) => set({ deleteIds: new Set(ids) }),
  clearAll: () => set({ deleteIds: new Set(), reverseIds: new Set() }),
}));
