import { useRef } from "react";
import { StatusBadge } from "../../components/paserve/StatusBadge";
import { useHandoffMotion } from "./useHandoffMotion";

const states = ["PENDING_CONFIRMATION", "QUEUED", "PREPARING"] as const;
const messages = [
  "Ready for cashier review",
  "Confirmed, paid and queued",
  "Preparing for pickup",
];

/** The original counter composition, rebuilt as layered device, paper and cup surfaces. */
export function CounterScene({ stage }: { stage: number }) {
  const scene = useRef<HTMLDivElement>(null);
  useHandoffMotion(scene, stage);
  return (
    <div
      ref={scene}
      className="landing-hero-board-wrap landing-counter-scene"
      data-phase={stage}
      aria-hidden="true"
    >
      <div className="landing-counter-rig">
        <div className="landing-counter-backdrop" />
        <div className="landing-counter-shadow" />
        <div className="landing-counter-plinth" />
        <div className="landing-diorama-phone">
          <div className="landing-diorama-screen">
            <div className="landing-diorama-phone-header">
              <strong>PaServe.</strong>
              <span>Menu</span>
            </div>
            <div className="landing-diorama-menu">
              <span className="landing-diorama-kicker">
                A LITTLE PICK-ME-UP
              </span>
              <p className="landing-diorama-menu-title">
                Your usual.
                <br />
                Or something new.
              </p>
              <div className="landing-diorama-menu-row">
                <span className="landing-diorama-mini-cup" />
                <div>
                  <strong>Iced latte</strong>
                  <span>Oat milk / Less ice</span>
                </div>
                <span>1</span>
              </div>
              <div className="landing-diorama-menu-row">
                <span className="landing-diorama-mini-cup landing-diorama-mini-dark" />
                <div>
                  <strong>Americano</strong>
                  <span>Hot / Regular</span>
                </div>
                <span>1</span>
              </div>
              <div className="landing-diorama-order-strip">
                <strong>Your order</strong>
                <span>2 items</span>
              </div>
            </div>
          </div>
          <div className="landing-diorama-glass" />
        </div>
        <div className="landing-diorama-cup">
          <div className="landing-diorama-cup-bottom" />
          <div className="landing-diorama-cup-body">
            <span>PaServe.</span>
            <small>
              GOOD DAYS.
              <br />
              GREAT SERVICE.
            </small>
          </div>
          <div className="landing-diorama-cup-lid">
            <span />
          </div>
        </div>
        <div className="landing-diorama-receipt">
          <div className="landing-diorama-receipt-body landing-board-body">
            <div className="landing-diorama-receipt-meta">
              <span>PICKUP</span>
              <span>2 ITEMS</span>
            </div>
            <p className="landing-diorama-receipt-number">B-024</p>
            <span className="landing-diorama-receipt-label">SAMPLE ORDER</span>
            <div className="landing-diorama-receipt-items">
              <p>
                <span>01</span>
                <strong>Iced latte</strong>
              </p>
              <small>Oat milk / Less ice</small>
              <p>
                <span>01</span>
                <strong>Americano</strong>
              </p>
              <small>Hot / Regular</small>
            </div>
            <div className="landing-diorama-status">
              <StatusBadge state={states[stage]} />
              <p>{messages[stage]}</p>
            </div>
          </div>
          <div className="landing-diorama-perforation" />
        </div>
      </div>
      <div className="landing-diorama-caption">
        <span>THE DAILY SERVICE</span>
        <span>ONE CLEAR HANDOFF</span>
      </div>
    </div>
  );
}
