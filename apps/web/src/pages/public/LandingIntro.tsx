import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FiArrowRight, FiCoffee } from "react-icons/fi";
import { Button } from "../../components/ui/button";
import "./landing-intro.css";

const sessionKey = "paserve.landing-intro.v4";
let memorySeen = false;

function shouldPlayIntro() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function" ||
    typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.location.hash || document.hidden) return false;
  try { return sessionStorage.getItem(sessionKey) !== "seen"; }
  catch { return !memorySeen; }
}

/** A finite brand opening, never a network/loading gate. Native dialog owns focus. */
export function LandingIntro() {
  const [active, setActive] = useState(shouldPlayIntro);
  const dialog = useRef<HTMLDialogElement>(null);
  const finish = useCallback(() => {
    dialog.current?.close();
    setActive(false);
    document.getElementById("landing-main")?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    const surface = dialog.current;
    if (!surface) return;
    const startedAt = performance.now();
    try { surface.showModal(); } catch { return; }
    memorySeen = true;
    try { sessionStorage.setItem(sessionKey, "seen"); } catch { /* session-only memory fallback */ }
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const viewportWidth = document.documentElement.clientWidth;
    const scrollbarWidth = viewportWidth > 0 ? Math.max(0, window.innerWidth - viewportWidth) : 0;
    const padding = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth) document.body.style.paddingRight = `${padding + scrollbarWidth}px`;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { if (preference.matches) finish(); };
    const hidden = () => { if (document.hidden) finish(); };
    const page = surface.closest<HTMLElement>(".landing-page");
    const prepareHandoff = () => {
      const seal = surface.querySelector<HTMLElement>(".intro-seal");
      const target = page?.querySelector<HTMLElement>(".landing-brand .brand-symbol");
      if (!seal || !target) return;
      // Read the settled seal before the composition exits. No frame-by-frame layout work.
      const from = seal.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      if (!from.width || !to.width || !to.height) return;
      const icon = target.querySelector("svg");
      const iconWidth = icon?.getBoundingClientRect().width || to.width * 0.6;
      const targetStyle = getComputedStyle(target);
      const scale = to.width / from.width;
      const delay = Math.max(0, 2140 - (performance.now() - startedAt));
      const values = {
        "--flight-left": `${from.left}px`,
        "--flight-top": `${from.top}px`,
        "--flight-size": `${from.width}px`,
        "--flight-x": `${to.left + to.width / 2 - from.left - from.width / 2}px`,
        "--flight-y": `${to.top + to.height / 2 - from.top - from.height / 2}px`,
        "--flight-scale": String(scale),
        "--flight-radius": `${(parseFloat(targetStyle.borderRadius) || 13) / scale}px`,
        "--flight-icon": `${iconWidth / scale}px`,
        "--flight-border": `${1 / scale}px`,
        "--flight-border-color": targetStyle.borderTopColor,
        "--flight-stroke": `${icon ? parseFloat(getComputedStyle(icon).strokeWidth) || 2 : 2}px`,
        "--flight-delay": `${delay}ms`,
        "--flight-background": targetStyle.backgroundColor,
        "--flight-color": targetStyle.color,
      };
      Object.entries(values).forEach(([name, value]) => surface.style.setProperty(name, value));
      surface.dataset.flightReady = "true";
      page!.dataset.introFlight = "true";
    };
    const handoff = window.setTimeout(prepareHandoff, 1800);
    preference.addEventListener("change", changed);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("resize", finish);
    // CSS finishes at 3.2s. This also releases the page if an animation event is lost.
    const timeout = window.setTimeout(finish, 3500);
    return () => {
      clearTimeout(timeout);
      clearTimeout(handoff);
      preference.removeEventListener("change", changed);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("resize", finish);
      if (page) delete page.dataset.introFlight;
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      surface.close();
    };
  }, [active, finish]);

  if (!active) return null;
  return <dialog ref={dialog} className="landing-intro" aria-label="Welcome to PaServe"
    onCancel={(event) => { event.preventDefault(); finish(); }}
    onAnimationEnd={(event) => { if (event.target === event.currentTarget && event.animationName === "paserve-intro-open") finish(); }}>
    <div className="intro-curtains" aria-hidden="true"><div /><div /></div>
    <div className="intro-flight-mark" aria-hidden="true"><FiCoffee /></div>
    <div className="intro-topline" aria-hidden="true"><span>FOR THE PEOPLE BEHIND THE COUNTER</span><span>PASERVE / WELCOME</span></div>
    <div className="intro-composition">
      <div className="intro-prologue" aria-hidden="true"><span>Your space.</span><em>Your people.</em></div>
      <div className="intro-brand-stage">
      <div className="intro-coffee" aria-hidden="true">
        <span className="intro-seal-rule" />
        <div className="intro-seal">
          <svg className="intro-seal-rings" viewBox="0 0 88 88" fill="none">
            <circle cx="44" cy="44" r="41" pathLength="100" />
            <circle cx="44" cy="44" r="34" pathLength="100" />
          </svg>
          <FiCoffee />
        </div>
        <span className="intro-seal-rule" />
      </div>
      <h2 className="intro-wordmark" aria-label="PaServe">
        {"PaServe.".split("").map((letter, index) => <span key={index} aria-hidden="true" style={{ animationDelay: `${1000 + index * 40}ms` }} data-period={letter === "."}>{letter}</span>)}
      </h2>
      <p className="intro-message"><span>Good days.</span> <em>Great service.</em></p>
      <div className="intro-rule" aria-hidden="true"><span /></div>
      </div>
    </div>
    <div className="intro-bottomline"><span aria-hidden="true">A LITTLE MORE HUMAN.<br />A LOT MORE POSSIBILITY.</span>
      <Button variant="outline" autoFocus onClick={finish}>Skip intro <FiArrowRight aria-hidden="true" /></Button>
    </div>
  </dialog>;
}
