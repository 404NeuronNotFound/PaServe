import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiArrowLeft, FiArrowUpRight, FiCoffee } from "react-icons/fi";
import { RecoveryLayout } from "../../components/layout/RecoveryLayout";
import { Button } from "../../components/ui/button";
import { useSessionStore } from "../../features/auth/stores/session";
import "./not-found.css";

export function NotFoundPage() {
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const signedIn = useSessionStore((state) => Boolean(state.accessToken));
  // Browser-router indices distinguish an in-app return from an external visit.
  const canGoBack = Number.isInteger(window.history.state?.idx) && window.history.state.idx > 0;
  const destination = signedIn ? "/app/account/places" : "/login";
  useEffect(() => {
    document.title = "Page not found · PaServe";
    heading.current?.focus();
  }, []);
  return (
    <RecoveryLayout contentId="not-found-content">
      <main id="not-found-content" className="not-found-content" tabIndex={-1} aria-labelledby="not-found-title">
        <div className="not-found-copy">
          <p className="section-label">404 · A LITTLE OFF COURSE</p>
          <h1 id="not-found-title" ref={heading} tabIndex={-1}>Page not found</h1>
          <p className="not-found-description">We couldn’t find this page. The link may have changed, or there may be a typo in the address.</p>
          <div className="not-found-actions">
            <Button asChild size="lg"><Link to={destination}>
              {signedIn ? "Go to your places" : "Go to sign in"}<FiArrowUpRight aria-hidden="true" />
            </Link></Button>
            {canGoBack && <Button variant="outline" size="lg" onClick={() => void navigate(-1)}>
              <FiArrowLeft aria-hidden="true" /> Go back
            </Button>}
          </div>
          <p className="not-found-help">Looking for a shop’s menu? Scan its QR code again or ask the team for the latest link.</p>
        </div>
        <div className="not-found-art" aria-hidden="true">
          <span className="not-found-orbit" />
          <div className="not-found-code"><span>4</span><span className="not-found-cup"><FiCoffee /></span><span>4</span></div>
          <span className="not-found-art-caption">A small detour.</span>
        </div>
      </main>
    </RecoveryLayout>
  );
}
