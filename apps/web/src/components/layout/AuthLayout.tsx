import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { FiArrowUpRight, FiCoffee, FiLock } from "react-icons/fi";
import { AppearanceToggle } from "./AppearanceToggle";

export function AuthLayout({
  children,
  headingId,
  skipLabel = "Skip to sign in",
}: {
  children: ReactNode;
  headingId: string;
  skipLabel?: string;
}) {
  return (
    <>
      <a className="skip-link" href="#auth-content">
        {skipLabel}
      </a>
      <main className="auth-page">
        <aside className="welcome-panel" aria-label="About PaServe">
          <Link className="wordmark" to="/" aria-label="PaServe home">
            <span className="brand-symbol">
              <FiCoffee className="brand-icon" aria-hidden="true" />
            </span>
            <span>
              PaServe<span className="wordmark-period">.</span>
            </span>
          </Link>
          <div className="brand-edition">
            A LITTLE MORE HUMAN.<span> A LOT MORE POSSIBILITY.</span>
          </div>
          <div className="welcome-content">
            <p className="section-label">
              <span className="little-star" aria-hidden="true">
                ✳
              </span>{" "}
              FOR THE PEOPLE BEHIND THE COUNTER
            </p>
            <h2>
              Good days.
              <br />
              <em>Great service.</em>
            </h2>
            <p className="welcome-description">
              For the early risers, the coffee makers, and the people who make a
              place feel like home.
            </p>
            <div className="coffee-art" aria-hidden="true">
              <div className="art-disc" />
              <div className="art-orbit" />
              <span className="art-spark">✳</span>
              <div className="art-stamp">
                <span>BREW A</span>
                <strong>better day.</strong>
                <span>WITH PASERVE</span>
              </div>
              <svg viewBox="0 0 360 260" fill="none">
                <ellipse cx="174" cy="210" rx="127" ry="28" fill="#c9ef83" />
                <ellipse
                  cx="174"
                  cy="209"
                  rx="96"
                  ry="16"
                  stroke="#243329"
                  strokeWidth="2"
                />
                <path
                  d="M235 91h25c44 0 47 67 2 72h-27"
                  stroke="#f3f0e5"
                  strokeWidth="16"
                />
                <path
                  d="M87 88h151v70c0 36-31 55-75 55s-76-20-76-55V88Z"
                  fill="#f3f0e5"
                />
                <ellipse cx="162" cy="88" rx="75" ry="22" fill="#d9d4c4" />
                <ellipse cx="162" cy="89" rx="63" ry="15" fill="#8a593c" />
                <path
                  d="M147 83c14-12 30-6 29 3-1 9-17 10-14 17-13-5-29-14-15-20Z"
                  fill="#f3e4c9"
                />
                <path
                  d="M121 65c-18-21 20-29 2-49M164 59c-18-21 20-29 2-49M207 65c-18-21 20-29 2-49"
                  stroke="#c9ef83"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path
                  d="M106 115v41c0 19 9 30 26 36"
                  stroke="#d9d4c4"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="art-caption">
                YOUR DAILY DOSE OF POSSIBILITY ↗
              </span>
            </div>
            <div className="daily-note">
              <span className="note-number">01—</span>
              <p>
                A space for your people.
                <br />
                <strong>A fresh start for your place.</strong>
              </p>
              <FiArrowUpRight aria-hidden="true" />
            </div>
          </div>
          <div className="welcome-footer">
            <span>COFFEE. PEOPLE. POSSIBILITY.</span>
            <FiArrowUpRight aria-hidden="true" />
          </div>
        </aside>
        <section
          id="auth-content"
          tabIndex={-1}
          className="form-panel"
          aria-labelledby={headingId}
        >
          <div className="form-topline">
            <AppearanceToggle />
            <nav className="auth-tabs" aria-label="Account access">
              <NavLink to="/login">Sign in</NavLink>
              <NavLink to="/register">Create account</NavLink>
            </nav>
          </div>
          <div className="form-content">
            <div className="form-emblem" aria-hidden="true">
              <FiArrowUpRight />
            </div>
            {children}
          </div>
          <footer className="form-footer">
            <FiLock aria-hidden="true" /> Your space. Your people. Your PaServe.
          </footer>
        </section>
      </main>
    </>
  );
}
