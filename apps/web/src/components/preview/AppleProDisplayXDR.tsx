// Adapted from Cult UI's apple-pro-display-xdr component.
// https://www.cult-ui.com/docs/components/apple-pro-display-xdr
// See CULT-UI-LICENSE.txt. Hardware is decorative; menu content stays interactive.
import type { ReactNode } from "react";
import "./apple-pro-display-xdr.css";

export function AppleProDisplayXDR({
  screenContent,
}: {
  screenContent: ReactNode;
}) {
  return (
    <div className="xdr-preview-stage">
      <div className="apple-pro-display-xdr">
        <div className="xdr-aluminum-frame">
          <div className="xdr-black-bezel">
            <div className="xdr-camera" aria-hidden="true">
              <i />
              <i />
            </div>
            <div className="xdr-screen">
              <div
                className="xdr-menu-screen"
                role="region"
                aria-label="Menu inside desktop display"
                tabIndex={0}
              >
                {screenContent}
              </div>
            </div>
            <div className="xdr-glass-highlight" aria-hidden="true" />
          </div>
        </div>
        <div className="xdr-stand" aria-hidden="true">
          <div className="xdr-hinge" />
          <div className="xdr-column">
            <div className="xdr-cable-opening" />
          </div>
          <div className="xdr-foot" />
        </div>
      </div>
      <p className="device-preview-caption">
        <strong>Pro Display XDR</strong>
        <span>Scroll inside the screen to explore your menu</span>
      </p>
    </div>
  );
}
