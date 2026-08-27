import { create } from "zustand";

interface DraftsState {
  /** Edited new names keyed by image id. */
  drafts: Record<string, string>;
  setDraft: (id: string, name: string) => void;
  /** Returns the draft if present, else the original name. */
  getDraft: (id: string, original: string) => string;
  /** Collect (id, newName) tasks where the draft differs from the original. */
  collectTasks: (originals: Record<string, string>) => { id: string; newName: string }[];
  clear: () => void;
}

export const useDraftsStore = create<DraftsState>((set, get) => ({
  drafts: {},
  setDraft: (id, name) =>
    set((s) => {
      // Drop the draft entry when it matches the original (treated as no change).
      const next = { ...s.drafts };
      if (name) next[id] = name;
      else delete next[id];
      return { drafts: next };
    }),
  getDraft: (id, original) => get().drafts[id] ?? original,
  collectTasks: (originals) => {
    const { drafts } = get();
    const tasks: { id: string; newName: string }[] = [];
    for (const [id, newName] of Object.entries(drafts)) {
      if (originals[id] !== undefined && originals[id] !== newName) {
        tasks.push({ id, newName: newName.trim() });
      }
    }
    return tasks;
  },
  clear: () => set({ drafts: {} }),
}));
