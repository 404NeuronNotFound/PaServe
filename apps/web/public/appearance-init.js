// Run before styles/React without inline script or relaxed CSP permissions.
(() => {
  let appearance;
  try {
    const saved = localStorage.getItem("paserve-appearance");
    if (saved === "day" || saved === "night") appearance = saved;
  } catch {
    // Saving appearance is optional.
  }
  if (!appearance) {
    try {
      appearance = window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "night" : "day";
    } catch {
      appearance = "day";
    }
  }
  document.documentElement.dataset.appearance = appearance;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", appearance === "night" ? "#151e18" : "#f5f3ec",
  );
})();
