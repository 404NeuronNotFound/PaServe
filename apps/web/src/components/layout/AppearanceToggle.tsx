import { useEffect } from "react";
import { FiMoon, FiSun } from "react-icons/fi";
import { useAppearanceStore } from "../../app/stores/appearance";
import { feedback } from "../../app/stores/feedback";

export function AppearanceToggle() {
  const { appearance, setAppearance } = useAppearanceStore();
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);

  return (
    <button
      className="appearance-toggle"
      type="button"
      role="switch"
      aria-label="Dark appearance"
      aria-checked={appearance === "night"}
      data-mode={appearance}
      onClick={() => {
        const previous = appearance;
        const next = appearance === "night" ? "day" : "night";
        setAppearance(next);
        feedback.snackbar(
          `${next === "night" ? "Night" : "Day"} appearance enabled.`,
          {
            label: "Undo",
            onClick: () => setAppearance(previous),
          },
          { key: "appearance" },
        );
      }}
    >
      <span className="appearance-thumb" aria-hidden="true" />
      <span className="day-label" aria-hidden="true">
        <FiSun />
        <span>Day</span>
      </span>
      <span className="night-label" aria-hidden="true">
        <FiMoon />
        <span>Night</span>
      </span>
    </button>
  );
}
