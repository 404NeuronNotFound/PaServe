import { useId, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { FiChevronDown, FiHome, FiUser } from "react-icons/fi";
import type { UserMembership } from "@paserve/contracts";
import { shopPath } from "../../features/shops/active-shop";
import { navigationForRole } from "./workspace-navigation";

function NavigationGroup({
  label,
  name,
  active,
  rail,
  children,
}: {
  label: string;
  name: string;
  active: boolean;
  rail: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(active);
  return (
    <div
      className="dashboard-nav-group dashboard-nav-disclosure"
      role="group"
      aria-label={name}
    >
      <button
        type="button"
        className="dashboard-nav-group-toggle"
        aria-expanded={expanded || rail}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{label}</span>
        <FiChevronDown aria-hidden="true" />
      </button>
      <div id={id} className="dashboard-nav-links" hidden={!expanded && !rail}>
        {children}
      </div>
    </div>
  );
}

export function DashboardSidebarNavigation({
  membership,
  rail,
  onNavigate,
}: {
  membership: UserMembership | null;
  rail: boolean;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const base = membership ? shopPath(membership.shopId) : "";
  const groups = membership ? navigationForRole(membership.role) : [];
  return (
    <nav aria-label="Shop navigation">
      {groups.map((group) => {
        const active = group.items.some((item) => item.path && (
          pathname === `${base}/${item.path}` || pathname.startsWith(`${base}/${item.path}/`)
        ));
        const links = group.items.map(({ path, label, icon: Icon }) => (
          <NavLink key={path} to={path ? `${base}/${path}` : base}
            end={!path} onClick={onNavigate} title={rail ? label : undefined}>
            <Icon aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ));
        return group.id === "daily" ? (
          <div key={group.id} className="dashboard-nav-group" role="group" aria-label={group.name}>
            <p className="dashboard-nav-label">{group.label}</p>
            <div className="dashboard-nav-links">{links}</div>
          </div>
        ) : (
          <NavigationGroup key={`${base}-${group.id}-${active}`} label={group.label}
            name={group.name} rail={rail} active={active}>
            {links}
          </NavigationGroup>
        );
      })}
      <div className="dashboard-nav-group dashboard-nav-account" role="group" aria-label="Account">
        <p className="dashboard-nav-label">Personal</p>
        <div className="dashboard-nav-links">
          <NavLink to="/app/shops" end onClick={onNavigate} title={rail ? "Your shops" : undefined}>
            <FiHome aria-hidden="true" /><span>Your shops</span>
          </NavLink>
          <NavLink to="/app/account" onClick={onNavigate} title={rail ? "Your account" : undefined}>
            <FiUser aria-hidden="true" /><span>Your account</span>
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
