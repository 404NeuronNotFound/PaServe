import { useEffect } from "react";
import { FiMoon, FiSun } from "react-icons/fi";
import { useAppearanceStore } from "../../app/stores/appearance";

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
      onClick={() => setAppearance(appearance === "night" ? "day" : "night")}
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
