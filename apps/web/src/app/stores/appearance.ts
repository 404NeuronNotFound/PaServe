import { create } from "zustand";

type Appearance = "day" | "night";

function initialAppearance(): Appearance {
  try {
    const saved = localStorage.getItem("paserve-appearance");
    if (saved === "day" || saved === "night") return saved;
  } catch {
    // Appearance remains usable when the browser blocks storage.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "night"
    : "day";
}

export const useAppearanceStore = create<{
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}>((set) => ({
  appearance: initialAppearance(),
  setAppearance: (appearance) => {
    set({ appearance });
    try {
      localStorage.setItem("paserve-appearance", appearance);
    } catch {
      // Saving the preference is optional; authentication is unaffected.
    }
  },
}));
