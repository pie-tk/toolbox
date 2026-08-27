import { create } from "zustand";
import type { ProgressEvent } from "@/lib/types";

export interface ActiveOp {
  opId: string;
  current: number;
  total: number;
  phase: string;
}

interface ProgressState {
  active: ActiveOp | null;
  /** Whether the latest completed op finished with failures (for StatusBar). */
  lastHadFailures: boolean;
  setActive: (e: ProgressEvent) => void;
  clear: () => void;
  setLastHadFailures: (v: boolean) => void;
}

export const useProgressStore = create<ProgressState>((set) => ({
  active: null,
  lastHadFailures: false,
  setActive: (e) => set({ active: { ...e } }),
  clear: () => set({ active: null }),
  setLastHadFailures: (v) => set({ lastHadFailures: v }),
}));
