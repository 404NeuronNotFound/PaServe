// Adapted from Cult UI's apple-iphone-17-pro component.
// https://www.cult-ui.com/docs/components/apple-iphone-17-pro
// See CULT-UI-LICENSE.txt. Static device chrome; screen content stays interactive.
import type { ReactNode } from "react";
import { FiWifi } from "react-icons/fi";
import "./iphone-17-pro.css";

export function IPhone17ProMax({ children }: { children: ReactNode }) {
  return (
    <div className="iphone-preview-stage">
      <div className="iphone-17-pro">
        <div className="iphone-bezel">
          <div className="iphone-screen">
            <div className="iphone-status-bar" aria-hidden="true">
              <span>9:41</span>
              <div className="iphone-status-icons">
                <span className="iphone-signal">
                  {[1, 2, 3, 4].map((bar) => (
                    <i key={bar} style={{ height: 3 + bar * 2 }} />
                  ))}
                </span>
                <FiWifi />
                <span className="iphone-battery">
                  <i />
                </span>
              </div>
            </div>
            <div className="iphone-dynamic-island" aria-hidden="true">
              <i />
            </div>
            <div
              className="iphone-menu-screen"
              role="region"
              aria-label="Menu inside phone"
              tabIndex={0}
            >
              {children}
            </div>
            <div className="iphone-home-indicator" aria-hidden="true" />
          </div>
        </div>
        <div className="iphone-side-button power" aria-hidden="true" />
        <div className="iphone-side-button action" aria-hidden="true" />
        <div className="iphone-side-button volume-up" aria-hidden="true" />
        <div className="iphone-side-button volume-down" aria-hidden="true" />
      </div>
      <p className="device-preview-caption">
        <strong>iPhone 17 Pro Max</strong>
        <span>Scroll inside the screen to explore your menu</span>
      </p>
    </div>
  );
}
