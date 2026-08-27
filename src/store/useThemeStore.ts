import { create } from "zustand";

type Theme = "light" | "dark";

const KEY = "toolbox-theme";

function readStored(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyClass(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
  /** Apply the persisted theme to the document (call once before render). */
  apply: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStored(),
  toggle: () => get().set(get().theme === "dark" ? "light" : "dark"),
  set: (theme) => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
    applyClass(theme);
    set({ theme });
  },
  apply: () => applyClass(get().theme),
}));
