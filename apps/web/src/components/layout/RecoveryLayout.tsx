import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { FiCoffee } from "react-icons/fi";
import { AppearanceToggle } from "./AppearanceToggle";
import { SkipLink } from "./SkipLink";
import "./recovery-layout.css";

export function RecoveryLayout({ children, contentId }: { children: ReactNode; contentId: string }) {
  return (
    <div className="recovery-page phase-two">
      <SkipLink targetId={contentId}>Skip to page content</SkipLink>
      <header className="recovery-header">
        <Link className="wordmark" to="/" aria-label="PaServe home">
          <span className="brand-symbol"><FiCoffee aria-hidden="true" /></span>
          <span>PaServe<span className="wordmark-period">.</span></span>
        </Link>
        <AppearanceToggle />
      </header>
      {children}
      <footer className="recovery-footer">PaServe · Your everyday space.</footer>
    </div>
  );
}
