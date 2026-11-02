import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FiArrowRight,
  FiArrowUpRight,
  FiArrowUp,
  FiChevronDown,
  FiCoffee,
  FiCheck,
  FiSliders,
  FiHome,
  FiGrid,
  FiLayers,
  FiCreditCard,
  FiBarChart2,
  FiUsers,
  FiSettings,
  FiFileText,
  FiShield,
} from "react-icons/fi";
import { Button } from "../../components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { SkipLink } from "../../components/layout/SkipLink";
import { StatusBadge } from "../../components/paserve/StatusBadge";
import { useHandoffMotion } from "./useHandoffMotion";
import { useLandingMotion } from "./useLandingMotion";
import { CounterScene } from "./CounterScene";
import { LandingIntro } from "./LandingIntro";
import "./landing.css";
import "./counter-scene.css";
import "./service-story.css";
import "./colophon.css";
import "./team-showcase.css";

const handoffs = [
  {
    label: "Customer",
    state: "PENDING_CONFIRMATION",
    title: "Their order. Their details.",
    description:
      "Customers open your menu, choose their items and add their notes. No customer account needed.",
    next: "Ready for cashier review",
  },
  {
    label: "Cashier",
    state: "QUEUED",
    title: "A clear handoff at the counter.",
    description:
      "Scan the order QR, review the details, then confirm and record payment together. Paid orders enter the prep queue.",
    next: "In the preparation queue",
  },
  {
    label: "Kitchen",
    state: "PREPARING",
    title: "The right details, right there.",
    description:
      "The kitchen or barista sees the items, quantities and notes. Update preparation, mark ready, then complete the handoff.",
    next: "Preparing for pickup",
  },
] as const;

const roles = [
  {
    id: "owner",
    label: "Owner",
    heading: "The whole shop, in view.",
    text: "Set up your shop, shape your menu, invite your team and review sales. Switch between your shops from one account.",
    items: [
      "Shop setup and menu management",
      "Team invitations and roles",
      "Orders and sales reports",
    ],
    page: "Your shop",
    note: "One account. Every workspace.",
    rows: [
      "Sales dashboard",
      "Menu & catalog",
      "Staff & invitations",
      "Shop settings",
    ],
  },
  {
    id: "admin",
    label: "Admin",
    heading: "Keep the day moving.",
    text: "Keep the menu, tables and preparation organized while staying close to daily service.",
    items: [
      "Menu and availability management",
      "Sales reports and daily operations",
      "Table and preparation oversight",
    ],
    page: "Daily workspace",
    note: "The details behind a good shift.",
    rows: ["Sales dashboard", "Menu & catalog", "Tables", "Kitchen / Barista"],
  },
  {
    id: "manager",
    label: "Manager",
    heading: "Stay close to the floor.",
    text: "Work across the counter, preparation queue and menu while keeping an eye on sales.",
    items: [
      "Counter and preparation workspaces",
      "Menu and availability updates",
      "Sales reports",
    ],
    page: "On the floor",
    note: "Keep service and preparation in sync.",
    rows: ["Cashier", "Kitchen / Barista", "Menu & catalog", "Sales dashboard"],
  },
  {
    id: "cashier",
    label: "Cashier",
    heading: "A calmer counter.",
    text: "Find the right order, check the total and record the payment. The confirmed order moves into the preparation queue.",
    items: [
      "Order QR scanning and lookup",
      "Order review before confirmation",
      "Payment and change handling",
    ],
    page: "Cashier workspace",
    note: "Review first. Confirm and pay together.",
    rows: [
      "Scan order QR",
      "Review items & notes",
      "Confirm and pay",
      "View receipt",
    ],
  },
  {
    id: "kitchen",
    label: "Kitchen",
    heading: "Less guessing. More making.",
    text: "Give your kitchen and baristas a clear preparation queue, with the item details and notes they need.",
    items: [
      "A shared preparation queue",
      "Visible quantities and modifiers",
      "Preparing, ready and completed states",
    ],
    page: "Kitchen / Barista",
    note: "The order stays clear through the handoff.",
    rows: [
      "Queued orders",
      "Items & special notes",
      "Start preparation",
      "Ready for handoff",
    ],
  },
] as const;

const roleIcons = [FiHome, FiGrid, FiLayers, FiCreditCard, FiCoffee];
function workspaceIcon(label: string) {
  if (/sales/i.test(label)) return FiBarChart2;
  if (/staff/i.test(label)) return FiUsers;
  if (/settings/i.test(label)) return FiSettings;
  if (/menu|table/i.test(label)) return FiGrid;
  if (/pay|cashier/i.test(label)) return FiCreditCard;
  if (/kitchen|preparation|queued/i.test(label)) return FiCoffee;
  return FiFileText;
}

const questions = [
  [
    "Do customers need a PaServe account?",
    "No. Customers can browse a shop's public menu and place an order without creating a staff account.",
  ],
  [
    "Can I use it for dine-in and pickup?",
    "Yes. PaServe supports table-based ordering and pickup. Customers use the shop's menu link or table QR to start.",
  ],
  [
    "Does every team member get the same access?",
    "No. Owner, admin, manager, cashier and kitchen roles have different workspaces and permissions. You choose the role when inviting a team member.",
  ],
  [
    "How do I get started?",
    "Create your account, verify your email or use your Google account, then set up your shop. Add your menu and invite your team. If you're joining an existing team, use the invitation they sent you.",
  ],
] as const;

function ServiceBoard({ stage }: { stage: number }) {
  const current = handoffs[stage];
  const StageIcon = [FiSliders, FiCheck, FiCoffee][stage];
  const details = [
    ["THE CUSTOMER'S CHOICES", "Oat milk. Less ice. Just how they like it."],
    ["REVIEWED AT THE COUNTER", "Confirmed and paid. Next stop: the prep queue."],
    ["ON THE PREP TICKET", "Same drinks. Same notes. Ready for your team."],
  ];
  const board = useRef<HTMLDivElement>(null);
  useHandoffMotion(board, stage);
  return (
    <div
      ref={board}
      className="landing-service-board"
      data-service-stage={stage}
    >
      <div className="landing-board-masthead">
        <span className="landing-board-brand"><FiCoffee aria-hidden="true" /> PaServe.</span>
        <span className="landing-board-workspace"><span aria-hidden="true" />{current.label.toUpperCase() + " WORKSPACE"}</span>
      </div>
      <div className="landing-board-body">
        <div className="landing-board-reference">
          <span>ONE ORDER / PICKUP</span>
          <span>SAMPLE PREVIEW</span>
        </div>
        <div className="landing-board-title">
          <strong>B-024</strong>
          <span>
            Two drinks.
            <br />
            All the details.
          </span>
        </div>
        <div className="landing-order-lines">
          <div>
            <span className="landing-story-drink landing-story-latte" aria-hidden="true"><FiCoffee /></span>
            <div>
              <strong>Iced latte <small>? 1</small></strong>
              <p>Oat milk / Less ice</p>
            </div>
            <span className="landing-order-note">CUSTOMIZED</span>
          </div>
          <div>
            <span className="landing-story-drink landing-story-americano" aria-hidden="true"><FiCoffee /></span>
            <div>
              <strong>Americano <small>? 1</small></strong>
              <p>Hot / Regular</p>
            </div>
          </div>
        </div>
        <div className="landing-board-insight">
          <StageIcon aria-hidden="true" />
          <div><span>{details[stage][0]}</span><p>{details[stage][1]}</p></div>
        </div>
        <div className="landing-board-route" aria-hidden="true">
          {handoffs.map((item, index) => (
            <span key={item.label} data-reached={index <= stage}>
              <i>{index < stage ? <FiCheck /> : `0${index + 1}`}</i>{item.label}
            </span>
          ))}
        </div>
        <div className="landing-board-state">
          <StatusBadge state={current.state} />
          <span>{current.next}</span>
        </div>
      </div>
      <div className="landing-board-paper-edge" aria-hidden="true" />
    </div>
  );
}
function CounterPreview() {
  const [stage, setStage] = useState(0);
  const current = handoffs[stage];
  return (
    <figure className="landing-preview" aria-label="Interactive sample order">
      <div className="landing-preview-meta">
        <span>YOUR SERVICE, CONNECTED.</span>
        <span>0{stage + 1} / 03</span>
      </div>
      <CounterScene stage={stage} />
      <figcaption className="landing-preview-caption">
        <div
          className="landing-handoff-switch"
          role="group"
          aria-label="Follow a sample order"
        >
          {handoffs.map((item, index) => (
            <Button
              key={item.label}
              variant="segment"
              aria-pressed={stage === index}
              aria-controls="landing-handoff-description"
              onClick={() => setStage(index)}
            >
              <span className="landing-handoff-number">0{index + 1}</span>
              {item.label}
            </Button>
          ))}
        </div>
        <div
          id="landing-handoff-description"
          className="landing-handoff-description"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>{current.title}</strong>
          <p>{current.description}</p>
        </div>
      </figcaption>
    </figure>
  );
}
export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState(0);
  useLandingMotion(root, setChapter);
  useEffect(() => {
    document.title = "PaServe | Good days. Great service.";
  }, []);
  return (
    <div className="landing-page" ref={root}>
      <LandingIntro />
      <div className="landing-reading-progress" aria-hidden="true" />
      <SkipLink targetId="landing-main">Skip to page content</SkipLink>
      <header className="landing-header landing-wrap">
        <Link
          to="/"
          className="wordmark landing-brand"
          aria-label="PaServe home"
        >
          <span className="brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          <span>
            PaServe<span className="wordmark-period">.</span>
          </span>
        </Link>
        <nav className="landing-nav" aria-label="Explore PaServe">
          <a href="#service-flow">The flow</a>
          <a href="#your-team">Your team</a>
          <a href="#questions">Questions</a>
        </nav>
        <div className="landing-header-actions">
          <AppearanceToggle />
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild className="landing-header-cta">
            <Link to="/register">
              Create account <FiArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>
      <main id="landing-main" tabIndex={-1}>
        <section
          className="landing-hero landing-wrap"
          aria-labelledby="landing-title"
        >
          <div className="landing-hero-copy">
            <p className="landing-eyebrow landing-hero-eyebrow">
              <span aria-hidden="true" /> GOOD DAYS START BEHIND THE COUNTER
            </p>
            <h1 id="landing-title">
              <span>Less &ldquo;asan na?&rdquo;</span>
              <em>More &ldquo;ready na.&rdquo;</em>
            </h1>
            <p className="landing-hero-description">
              <strong>A busy shop. A team in sync.</strong>
              From the first pa-order to the final pickup, keep your customers,
              cashier and kitchen on the same page. Every order, with its details
              intact.
            </p>
            <div className="landing-hero-actions">
              <Button asChild size="lg" className="landing-hero-cta">
                <Link to="/register">
                  Set up your shop
                  <span className="landing-cta-arrow">
                    <FiArrowRight aria-hidden="true" />
                  </span>
                </Link>
              </Button>
              <a className="landing-text-link" href="#your-team">
                Find your workspace <FiArrowUpRight aria-hidden="true" />
              </a>
            </div>
            <p className="landing-hero-note">
              Already part of a team?{" "}
              <Link to="/login">Sign in to your workspace.</Link>
            </p>
            <a className="landing-scroll-cue" href="#service-flow">
              <span className="landing-scroll-line" aria-hidden="true" />
              One order. From choice to pickup.<span>01 / 03</span>
            </a>
          </div>
          <CounterPreview />
        </section>
        <section
          className="landing-flow"
          id="service-flow"
          tabIndex={-1}
          aria-labelledby="landing-flow-title"
        >
          <div className="landing-wrap">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">01 / FOLLOW THE HANDOFF</p>
              <h2 id="landing-flow-title" data-reveal="heading">
                An order moves.
                <br />
                <em>The details stay.</em>
              </h2>
              <p>
                Follow the same two drinks from the customer's choices to the
                kitchen's queue. Scroll to see each handoff.
              </p>
            </div>
            <div className="landing-scroll-story" data-chapter={chapter}>
              <div className="landing-story-chapters">
                {handoffs.map((step, index) => (
                  <article
                    key={step.label}
                    className="landing-story-chapter"
                    data-service-chapter={index}
                    data-active={chapter === index}
                  >
                    <div className="landing-chapter-index">
                      <span>0{index + 1}</span>
                      <span>{step.label.toUpperCase()}</span>
                    </div>
                    <h3>
                      {
                        [
                          "Their order, just right.",
                          "A clear counter check.",
                          "Ready for the people making it.",
                        ][index]
                      }
                    </h3>
                    <p>{step.description}</p>
                    <div className="landing-chapter-detail">
                      <span>
                        {
                          [
                            "THE DETAILS START HERE",
                            "THE HANDOFF IS CONFIRMED",
                            "THE DETAILS ARRIVE INTACT",
                          ][index]
                        }
                      </span>
                      <p>
                        {
                          [
                            "Iced latte. Oat milk. Less ice. Those choices travel with the order.",
                            "The cashier reviews the order and records payment as part of confirmation.",
                            "The kitchen sees the quantities, modifiers and notes, then updates preparation.",
                          ][index]
                        }
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <div className="landing-story-stage">
                <div className="landing-story-stage-top">
                  <span>THE SAME ORDER, EVERY STEP.</span>
                  <span>0{chapter + 1} / 03</span>
                </div>
                <ServiceBoard stage={chapter} />
                <div
                  className="landing-story-controls"
                  role="group"
                  aria-label="Choose a service stage"
                >
                  {handoffs.map((step, index) => (
                    <Button
                      key={step.label}
                      variant="segment"
                      aria-pressed={chapter === index}
                      onClick={() => setChapter(index)}
                    >
                      <span className="landing-stage-number" aria-hidden="true">0{index + 1}</span>{step.label}
                    </Button>
                  ))}
                </div>
                <p
                  className="landing-story-status"
                  role="status"
                  aria-live="polite"
                >
                  {handoffs[chapter].next}
                </p>
                <div className="landing-story-rail" aria-hidden="true">
                  <span />
                </div>
              </div>
            </div>
            <div className="landing-flow-bottom">
              <span>The same items. The same notes. A clear next step.</span>
              <a href="#your-team">
                Meet the workspaces <FiArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
        <section
          className="landing-team landing-wrap"
          id="your-team"
          tabIndex={-1}
          aria-labelledby="landing-team-title"
        >
          <div className="landing-section-heading">
            <p className="landing-eyebrow">02 / YOUR PEOPLE, THEIR SPACE</p>
            <h2 id="landing-team-title" data-reveal="heading">
              One team.
              <br />
              <em>Room for every role.</em>
            </h2>
            <p>
              A cashier needs a clear counter. A barista needs a clear queue.
              Give each person the workspace that fits their part.
            </p>
          </div>
          <Tabs defaultValue="owner" className="landing-role-tabs">
            <TabsList aria-label="Explore team workspaces">
              {roles.map((role, index) => {
                const RoleIcon = roleIcons[index];
                return <TabsTrigger key={role.id} value={role.id}>
                  <RoleIcon aria-hidden="true" /><span>{role.label}</span>
                </TabsTrigger>;
              })}
            </TabsList>
            {roles.map((role, index) => (
              <TabsContent key={role.id} value={role.id}>
                <div className="landing-role-copy">
                  <span className="landing-eyebrow">
                    0{index + 1} / {role.label.toUpperCase()}
                  </span>
                  <h3>{role.heading}</h3>
                  <p>{role.text}</p>
                  <ul>
                    {role.items.map((item) => (
                      <li key={item}><FiCheck aria-hidden="true" />{item}</li>
                    ))}
                  </ul>
                  <Button asChild variant="outline">
                    <Link to="/register">
                      Bring your team to PaServe{" "}
                      <FiArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
                <div
                  className="landing-workspace-sample"
                  aria-label={role.label + " workspace illustration"}
                >
                  <div className="landing-workspace-masthead">
                    <span className="team-preview-brand"><FiCoffee aria-hidden="true" />PaServe.</span>
                    <span className="team-access-label"><FiShield aria-hidden="true" />{role.label}</span>
                  </div>
                  <div className="team-preview-shell">
                    <div className="team-preview-rail" aria-hidden="true">
                      {role.rows.map((row, rowIndex) => {
                        const RowIcon = workspaceIcon(row);
                        return <span key={row} data-current={rowIndex === 0}><RowIcon /></span>;
                      })}
                      <span className="team-rail-person">P</span>
                    </div>
                    <div className="landing-workspace-content">
                      <p className="landing-small-label">YOUR SPACE / {role.label.toUpperCase()}</p>
                      <h4>{role.page}</h4>
                      <p>{role.note}</p>
                      <div className="team-workspace-divider"><span>IN YOUR WORKSPACE</span><span aria-hidden="true">04</span></div>
                      <ol className="team-workspace-modules" data-layout={index > 2 ? "workflow" : "overview"}>
                        {role.rows.map((row, rowIndex) => {
                          const RowIcon = workspaceIcon(row);
                          return <li key={row}>
                            <span className="team-module-icon" aria-hidden="true"><RowIcon /></span>
                            <div><small>0{rowIndex + 1}</small><strong>{row}</strong></div>
                            <FiArrowUpRight aria-hidden="true" />
                          </li>;
                        })}
                      </ol>
                      <span className="landing-sample-note"><FiShield aria-hidden="true" />Illustrative layout. Access depends on your role.</span>
                    </div>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </section>
        <section
          className="landing-menu-story landing-wrap"
          aria-labelledby="landing-menu-title"
        >
          <div className="landing-menu-statement">
            <p className="landing-eyebrow">03 / THE LITTLE DETAILS MATTER</p>
            <h2 id="landing-menu-title" data-reveal="heading">
              Less ice.
              <br />
              Oat milk.
              <br />
              <em>Got it.</em>
            </h2>
            <p>
              A good order is more than a product name. Keep choices, modifiers
              and notes with the order, all the way to the people making it.
            </p>
          </div>
          <div className="landing-details-ledger">
            <article>
              <span className="landing-small-label">YOUR MENU</span>
              <h3>Make it feel like your place.</h3>
              <p>
                Organize products, categories and add-ons. Keep prices and
                availability up to date as your menu changes.
              </p>
            </article>
            <article>
              <span className="landing-small-label">YOUR SERVICE</span>
              <h3>At a table. Or on the go.</h3>
              <p>
                Offer table-based ordering and pickup through your public menu.
                Customers can get started without a staff account.
              </p>
            </article>
            <article>
              <span className="landing-small-label">YOUR SHOPS</span>
              <h3>Different places. One account.</h3>
              <p>
                Choose a shop and step into the right workspace. Memberships and
                roles stay specific to each shop.
              </p>
            </article>
          </div>
        </section>
        <section
          className="landing-questions landing-wrap"
          id="questions"
          tabIndex={-1}
          aria-labelledby="landing-questions-title"
        >
          <div>
            <p className="landing-eyebrow">BEFORE YOUR FIRST SHIFT</p>
            <h2 id="landing-questions-title" data-reveal="heading">
              A few things
              <br />
              <em>you might ask.</em>
            </h2>
          </div>
          <div className="landing-faq-list">
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <FiChevronDown aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section
          className="landing-final"
          aria-labelledby="landing-final-title"
        >
          <div className="landing-wrap landing-final-content">
            <div>
              <p className="landing-eyebrow">A FRESH START FOR YOUR PLACE</p>
              <h2 id="landing-final-title" data-reveal="heading">
                Your next good day
                <br />
                <em>starts here.</em>
              </h2>
              <p>
                Set up your shop. Bring in your people.
                <br />
                Make room for great service.
              </p>
            </div>
            <div className="landing-final-actions">
              <Button asChild size="lg">
                <Link to="/register">
                  Create your PaServe account{" "}
                  <FiArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Link to="/login">Already have an account? Sign in</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer landing-colophon">
        <div className="landing-wrap">
          <div className="colophon-heading">
            <span><FiCoffee aria-hidden="true" /> GOOD DAYS. GREAT SERVICE.</span>
            <a href="#landing-main" className="colophon-back">Back to top <FiArrowUp aria-hidden="true" /></a>
          </div>
          <div className="colophon-grid">
            <div className="colophon-intro">
              <p className="colophon-statement">A little more human.<br /><em>A lot more possibility.</em></p>
              <p className="colophon-description">For the early risers, the coffee makers,<br />and the people behind every good day.</p>
              <div className="landing-footer-signature colophon-signature" aria-hidden="true">
                <div className="landing-footer-lettering">
                  {"PaServe.".split("").map((letter, index) => (
                    <span key={index} data-footer-letter data-period={letter === "."}>{letter}</span>
                  ))}
                </div>
                <div className="landing-footer-foil" />
              </div>
            </div>
            <div className="colophon-directory">
              <nav className="colophon-links" aria-label="Footer navigation">
                <div>
                  <h3>Get to know PaServe</h3>
                  <a href="#service-flow">Follow an order <FiArrowUpRight aria-hidden="true" /></a>
                  <a href="#your-team">Find your workspace <FiArrowUpRight aria-hidden="true" /></a>
                  <a href="#questions">A few good answers <FiArrowUpRight aria-hidden="true" /></a>
                </div>
                <div>
                  <h3>Pull up a chair</h3>
                  <Link to="/register">Create account <FiArrowUpRight aria-hidden="true" /></Link>
                  <Link to="/login">Sign in <FiArrowUpRight aria-hidden="true" /></Link>
                  <Link to="/terms">Terms of Service <FiArrowUpRight aria-hidden="true" /></Link>
                  <Link to="/privacy">Privacy Notice <FiArrowUpRight aria-hidden="true" /></Link>
                </div>
              </nav>
              <div className="colophon-maker">
                <div className="colophon-maker-top"><span>THE PEOPLE BEHIND THE BUILD</span><span aria-hidden="true">01 / 01</span></div>
                <a href="https://keybeen-fullstack-developer.vercel.app" target="_blank" rel="noopener noreferrer" aria-label="404NeuronNotFound portfolio, opens in a new tab">
                  <span className="colophon-maker-mark" aria-hidden="true">404</span>
                  <span><small>Developed by</small><strong>404NeuronNotFound</strong></span>
                  <FiArrowUpRight aria-hidden="true" />
                </a>
                <p>With <strong>Codex</strong>, an AI coding agent.</p>
              </div>
            </div>
          </div>
          <div className="landing-footer-rule" aria-hidden="true" />
          <div className="colophon-bottom">
            <span>Your space. Your people. Your PaServe.</span>
            <span>From the first order to the last handoff.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
