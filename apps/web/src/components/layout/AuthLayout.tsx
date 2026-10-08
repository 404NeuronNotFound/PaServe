import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { FiCoffee } from "react-icons/fi";

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
            <FiCoffee className="brand-icon" aria-hidden="true" />
            <span>PaServe</span>
          </Link>
          <div className="welcome-content">
            <p className="section-label">For your shop</p>
            <h2>
              Less admin. <br />
              More service.
            </h2>
            <p className="welcome-description">
              A simpler way to run your cafe, coffee shop, or restaurant.
            </p>
          </div>
        </aside>
        <section
          id="auth-content"
          tabIndex={-1}
          className="form-panel"
          aria-labelledby={headingId}
        >
          <div className="form-content">{children}</div>
          <footer className="form-footer">Simple tools. Better service.</footer>
        </section>
      </main>
    </>
  );
}
