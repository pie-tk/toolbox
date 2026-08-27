import { create } from "zustand";

interface SearchState {
  query: string;
  /** Image ids matching the current query (computed by the table). */
  matches: string[];
  index: number;
  highlightedId: string | null;
  setQuery: (q: string) => void;
  setMatches: (ids: string[]) => void;
  /** Advance to the next match (wraps around). Returns the new highlighted id. */
  next: () => string | null;
  /** Advance to the previous match. */
  prev: () => string | null;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  matches: [],
  index: -1,
  highlightedId: null,
  setQuery: (q) => set({ query: q }),
  setMatches: (ids) => {
    const highlightedId = ids.length > 0 ? ids[0] : null;
    set({ matches: ids, index: ids.length > 0 ? 0 : -1, highlightedId });
  },
  next: () => {
    const { matches, index } = get();
    if (matches.length === 0) return null;
    const ni = (index + 1) % matches.length;
    set({ index: ni, highlightedId: matches[ni] });
    return matches[ni];
  },
  prev: () => {
    const { matches, index } = get();
    if (matches.length === 0) return null;
    const ni = (index - 1 + matches.length) % matches.length;
    set({ index: ni, highlightedId: matches[ni] });
    return matches[ni];
  },
  clear: () => set({ query: "", matches: [], index: -1, highlightedId: null }),
}));
