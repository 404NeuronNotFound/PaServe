import { create } from "zustand";

type Appearance = "day" | "night";

function initialAppearance(): Appearance {
  try {
    const saved = localStorage.getItem("paserve-appearance");
    if (saved === "day" || saved === "night") return saved;
  } catch {
    // Appearance remains usable when the browser blocks storage.
  }
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "night"
      : "day";
  } catch {
    return "day";
  }
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

function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.appearance = appearance;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", appearance === "night" ? "#151e18" : "#f5f3ec",
  );
}

// Apply globally, including routes without a mounted appearance switch.
applyAppearance(useAppearanceStore.getState().appearance);
useAppearanceStore.subscribe(({ appearance }) => applyAppearance(appearance));
