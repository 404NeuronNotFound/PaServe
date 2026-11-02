import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FiArrowLeft,
  FiArrowUp,
  FiArrowUpRight,
  FiCoffee,
  FiMail,
  FiPrinter,
} from "react-icons/fi";
import { REGISTRATION_POLICY_VERSION } from "@paserve/contracts";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import {
  privacySections,
  termsSections,
  PRIVACY_CONTACT,
} from "./legal-content";
import "./legal.css";

export function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const privacy = kind === "privacy";
  const title = privacy ? "Privacy Notice" : "Terms of Service";
  const sections = privacy ? privacySections : termsSections;
  const [active, setActive] = useState(sections[0].id);
  const progress = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const entries = [
    ...sections.map((s) => ({
      id: s.id,
      title: s.title.replace(/^\d+\.\s*/, ""),
    })),
    { id: "contact", title: "Get in touch" },
    { id: "references", title: "Legal references" },
  ];

  useEffect(() => {
    document.title = `${title} · PaServe`;
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) target.scrollIntoView?.({ block: "start" });
    else window.scrollTo(0, 0);
    let frame = 0;
    const nodes = [
      ...sections.map((s) => document.getElementById(s.id)),
      document.getElementById("contact"),
      document.getElementById("references"),
    ].filter((node): node is HTMLElement => !!node);
    const update = () => {
      frame = 0;
      if (document.hidden) return;
      const mobileHeight =
        document.querySelector(".legal-mobile-jump")?.getBoundingClientRect()
          .height ?? 0;
      const top =
        (header.current?.getBoundingClientRect().bottom ?? 80) +
        64 +
        mobileHeight;
      let current = nodes[0]?.id;
      for (const node of nodes)
        if (node.getBoundingClientRect().top <= top) current = node.id;
      if (current) setActive(current);
      const range = document.documentElement.scrollHeight - window.innerHeight;
      const fraction =
        range > 0 ? Math.max(0, Math.min(1, window.scrollY / range)) : 0;
      if (progress.current)
        progress.current.style.transform = `scaleX(${fraction})`;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [title, sections]);

  function jumpTo(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    window.history.replaceState(window.history.state, "", `#${id}`);
    target.scrollIntoView?.({ block: "start" });
    target.focus({ preventScroll: true });
    setActive(id);
  }

  return (
    <div className="legal-page" id="legal-top">
      <a className="skip-link" href="#legal-content">
        Skip to {title}
      </a>
      <header className="legal-header" ref={header}>
        <Link to="/" className="legal-brand">
          <span className="legal-brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          PaServe<span className="legal-brand-period">.</span>
        </Link>
        <span className="legal-header-caption">A LITTLE MORE CLARITY.</span>
        <div className="legal-header-actions">
          <AppearanceToggle />
          <Button asChild variant="outline">
            <Link to="/login">
              Sign in <FiArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="legal-reading-track" aria-hidden="true">
          <div ref={progress} />
        </div>
      </header>
      <main id="legal-content" tabIndex={-1}>
        <div className="legal-hero">
          <div className="legal-intro">
            <Link to="/" className="legal-back">
              <FiArrowLeft aria-hidden="true" /> Back to PaServe
            </Link>
            <p className="section-label">YOUR SPACE. YOUR RIGHTS.</p>
            <p className="legal-print-version">
              Policy reference: {REGISTRATION_POLICY_VERSION}. Updated 2
              November 2026.
            </p>
            <h1>
              {privacy ? (
                <>
                  Privacy <br />
                  <em>Notice.</em>
                </>
              ) : (
                <>
                  Terms of <br />
                  <em>Service.</em>
                </>
              )}
            </h1>
            <p className="legal-deck">
              {privacy
                ? "What we use, why we need it, and the choices that stay yours."
                : "Clear expectations for the people behind the counter and the people they serve."}
            </p>
            <nav aria-label="Legal documents" className="legal-documents">
              <Link to="/terms" aria-current={!privacy ? "page" : undefined}>
                Terms of Service
              </Link>
              <Link to="/privacy" aria-current={privacy ? "page" : undefined}>
                Privacy Notice
              </Link>
            </nav>
          </div>
          <aside className="legal-cover" aria-label="Document information">
            <div className="legal-cover-top">
              <FiCoffee aria-hidden="true" />
              <span>PASERVE / THE DETAILS</span>
              <span>{privacy ? "02" : "01"}</span>
            </div>
            <p className="legal-cover-title">
              {privacy ? (
                <>
                  Your information.
                  <br />
                  <em>Your say.</em>
                </>
              ) : (
                <>
                  Good service.
                  <br />
                  <em>Clear terms.</em>
                </>
              )}
            </p>
            <div className="legal-cover-bottom">
              <span>
                UPDATED
                <br />
                <strong>02 NOV 2026</strong>
              </span>
              <span>
                DOCUMENT
                <br />
                <strong>
                  {privacy ? "PRIVACY NOTICE" : "TERMS OF SERVICE"}
                </strong>
              </span>
            </div>
            <p className="legal-version">
              Version {REGISTRATION_POLICY_VERSION}
            </p>
          </aside>
        </div>
        <div className="legal-reading-toolbar">
          <span>THE FULL PICTURE, AT YOUR PACE.</span>
          <Button type="button" variant="ghost" onClick={() => window.print()}>
            <FiPrinter aria-hidden="true" /> Print or save PDF
          </Button>
        </div>
        <div className="legal-layout">
          <aside className="legal-directory">
            <nav aria-label="On this page" className="legal-index">
              <p className="legal-index-caption">IN THIS DOCUMENT</p>
              {entries.map((s, index) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  aria-current={active === s.id ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    jumpTo(s.id);
                  }}
                >
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{s.title}</span>
                  <FiArrowUpRight aria-hidden="true" />
                </a>
              ))}
            </nav>
            <div className="legal-directory-note">
              <span>Need a hand?</span>
              <a href={`mailto:${PRIVACY_CONTACT}`}>
                Let's talk <FiArrowUpRight aria-hidden="true" />
              </a>
            </div>
            <div className="legal-mobile-jump">
              <Select
                id="legal-section"
                label="Jump to a section"
                value={active}
                options={entries.map((s) => ({ value: s.id, label: s.title }))}
                onChange={jumpTo}
              />
            </div>
          </aside>
          <article className="legal-article" aria-label={title}>
            <aside className="legal-summary">
              <span className="legal-summary-kicker">BEFORE THE DETAILS</span>
              <strong>
                {privacy
                  ? "A notice, not blanket consent."
                  : "For your shop. And your peace of mind."}
              </strong>
              <p>
                {privacy
                  ? "You can ask questions, request your information or raise a concern at any time. Start with our privacy contact."
                  : "You must be 18 or older, authorised to act for your shop, and use your own verified email. Customers can order without registering."}
              </p>
              <a
                href={privacy ? "#rights" : "#age"}
                onClick={(event) => {
                  event.preventDefault();
                  jumpTo(privacy ? "rights" : "age");
                }}
              >
                {privacy ? "Go to your rights" : "Read account eligibility"}
                <FiArrowUpRight aria-hidden="true" />
              </a>
            </aside>
            {sections.map((s, index) => (
              <section
                key={s.id}
                id={s.id}
                tabIndex={-1}
                className="legal-clause"
              >
                <div className="legal-clause-heading">
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2>{s.title.replace(/^\d+\.\s*/, "")}</h2>
                </div>
                <div className="legal-clause-copy">
                  {s.paragraphs.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </div>
              </section>
            ))}
            <section
              id="contact"
              tabIndex={-1}
              className="legal-contact-section"
            >
              <p className="section-label">A REAL PERSON, ON THE OTHER SIDE.</p>
              <h2>
                Let's handle
                <br />
                <em>your concern.</em>
              </h2>
              <p>
                Email{" "}
                <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>.
                Please leave passwords and verification codes out of your
                message.
              </p>
              <Button asChild>
                <a className="legal-contact" href={`mailto:${PRIVACY_CONTACT}`}>
                  <FiMail aria-hidden="true" /> Contact PaServe{" "}
                  <FiArrowUpRight aria-hidden="true" />
                </a>
              </Button>
            </section>
            <section id="references" tabIndex={-1} className="legal-references">
              <h2>Philippine legal references</h2>
              <ul>
                <li>
                  <a href="https://privacy.gov.ph/data-privacy-act/">
                    Republic Act No. 10173 — Data Privacy Act of 2012
                    <FiArrowUpRight aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <a href="https://privacy.gov.ph/the-right-to-be-informed/">
                    NPC guidance on the right to be informed
                    <FiArrowUpRight aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <a href="https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/7025">
                    Republic Act No. 6809 — age of majority
                    <FiArrowUpRight aria-hidden="true" />
                  </a>
                </li>
              </ul>
            </section>
          </article>
        </div>
      </main>
      <footer className="legal-footer">
        <Link to="/" className="legal-footer-wordmark">
          PaServe<span>.</span>
        </Link>
        <span>
          Good days. Great service.
          <br />
          Clearer on the details.
        </span>
        <div>
          <Link to="/register">
            Create an account <FiArrowUpRight aria-hidden="true" />
          </Link>
          <a href="#legal-top">
            Back to top <FiArrowUp aria-hidden="true" />
          </a>
        </div>
      </footer>
    </div>
  );
}
