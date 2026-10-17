import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import {
  FiUsers,
  FiLink,
  FiUserPlus,
  FiSearch,
  FiX,
  FiLock,
  FiClock,
  FiArrowUpRight,
  FiUserMinus,
  FiMail,
} from "react-icons/fi";
import {
  STAFF_ROLES,
  type ApiErrorResponse,
  type CurrentUserResponse,
  type StaffRole,
} from "@paserve/contracts";
import isEmail from "validator/lib/isEmail";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  changeStaffRole,
  inviteStaff,
  listStaff,
  removeStaff,
  revokeInvitation,
  staffInvitationLink,
} from "../../features/shops/api/staff";
import { SelectField } from "../../components/forms/SelectField";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { feedback } from "../../app/stores/feedback";
import "./staff.css";

const roles = STAFF_ROLES.map((value) => ({
  value,
  label: value[0] + value.slice(1).toLowerCase(),
}));
function errorMessage(error: unknown) {
  return isAxiosError<ApiErrorResponse>(error)
    ? (error.response?.data?.message ??
        "Unable to complete this action. Check your connection and try again.")
    : "Unable to complete this action. Check your connection and try again.";
}
type Decision = {
  kind: "role" | "remove" | "revoke";
  id: string;
  email: string;
  role?: StaffRole;
  previousRole?: StaffRole;
};
const roleDescriptions: Record<StaffRole, string> = {
  CASHIER:
    "Scan and read orders, confirm or reject orders, record payments, and update item availability. No menu or price editing, reports, kitchen preparation, staff management, settings, ownership, or billing access.",
  KITCHEN: "Kitchen preparation access.",
  MANAGER:
    "Daily operations, menu, orders, reports, cashier, and kitchen. Table management, staff management, settings, ownership, and billing are excluded.",
  ADMIN:
    "Shop operations, menu, tables, reports, cashier, and kitchen. Staff management, settings, ownership, and billing remain owner-only.",
};

function roleDecisionCopy(decision: Decision, shopName: string) {
  const assignedRole =
    decision.role === "ADMIN"
      ? "an admin"
      : decision.role === "MANAGER"
        ? "a manager"
        : decision.role === "CASHIER"
          ? "a cashier"
          : decision.role?.toLowerCase();
  const description = `${decision.email} will become ${assignedRole} in ${shopName}.`;
  const permissionDescription = decision.role
    ? roleDescriptions[decision.role]
    : "";
  if (decision.role === "ADMIN")
    return {
      title: "Assign admin role?",
      description: `${description} ${roleDescriptions.ADMIN}`,
      confirmLabel: "Assign admin",
      success: "Admin role assigned.",
    };
  if (decision.previousRole === "ADMIN")
    return {
      title: "Remove admin role?",
      description: `${description} They will lose admin permissions. Their shop membership stays active with the selected role's permissions. ${permissionDescription}`,
      confirmLabel: "Remove admin role",
      success: "Admin role removed.",
    };
  if (decision.role === "MANAGER")
    return {
      title: "Assign manager role?",
      description: `${description} ${roleDescriptions.MANAGER}`,
      confirmLabel: "Assign manager",
      success: "Manager role assigned.",
    };
  if (decision.previousRole === "MANAGER")
    return {
      title: "Remove manager role?",
      description: `${description} They will lose manager permissions. Their shop membership stays active with the selected role's permissions. ${permissionDescription}`,
      confirmLabel: "Remove manager role",
      success: "Manager role removed.",
    };
  if (decision.role === "CASHIER")
    return {
      title: "Assign cashier role?",
      description: `${description} ${roleDescriptions.CASHIER}`,
      confirmLabel: "Assign cashier",
      success: "Cashier role assigned.",
    };
  if (decision.previousRole === "CASHIER")
    return {
      title: "Remove cashier role?",
      description: `${description} They will lose counter permissions. Their shop membership stays active with the selected role's permissions. ${permissionDescription}`,
      confirmLabel: "Remove cashier role",
      success: "Cashier role removed.",
    };
  return {
    title: "Change staff role?",
    description,
    confirmLabel: "Change role",
    success: "Staff access updated.",
  };
}
export function StaffPage() {
  const { shopId } = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return <StaffWorkspace key={`${userId}:${shopId}`} userId={userId} />;
}
function StaffWorkspace({ userId }: { userId: string }) {
  const membership = useActiveShop();
  const { shopId } = membership;
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const headingFocused = useRef(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("CASHIER");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [lostAccess, setLostAccess] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [search, setSearch] = useState("");
  const authorized = membership.role === "OWNER" && !lostAccess;
  const query = useQuery({
    queryKey: ["staff", userId, shopId],
    queryFn: ({ signal }) => listStaff(shopId, signal),
    enabled: authorized,
    retry: false,
    networkMode: "always",
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    mounted.current = true;
    document.title = `Staff · ${membership.shop.name} · PaServe`;
    heading.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, [membership.shop.name]);
  const stillHere = () =>
    mounted.current &&
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
      userId;
  useEffect(() => {
    if (
      query.isSuccess &&
      !query.isFetching &&
      !headingFocused.current &&
      heading.current
    ) {
      heading.current.focus();
      headingFocused.current = true;
    }
  }, [query.isSuccess, query.isFetching]);
  const denied =
    isAxiosError(query.error) &&
    [401, 403, 404].includes(query.error.response?.status ?? 0);
  async function run(work: () => Promise<unknown>, success: string) {
    if (running.current || !authorized || !query.isSuccess || query.isFetching)
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      if (!stillHere()) return;
      setDecision(null);
      feedback.toast(success);
      // Membership changes may also invalidate cached account/shop roles.
      await client.invalidateQueries({ queryKey: ["cashier"] });
      await query.refetch();
    } catch (failure) {
      if (
        stillHere() &&
        isAxiosError(failure) &&
        [401, 403, 404].includes(failure.response?.status ?? 0)
      ) {
        setLostAccess(true);
        setLink("");
      }
      throw failure;
    } finally {
      running.current = false;
      if (stillHere()) setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!isEmail(normalized) || normalized.length > 254) {
      setError("Enter a valid email address.");
      return;
    }
    if (running.current) return;
    try {
      await run(async () => {
        setLink("");
        const result = await inviteStaff(shopId, { email: normalized, role });
        if (stillHere()) {
          setLink(staffInvitationLink(shopId, result.token));
          setEmail("");
        }
      }, "Invitation created.");
    } catch (failure) {
      if (stillHere()) setError(errorMessage(failure));
    }
  }
  async function copy() {
    if (copying) return;
    setCopying(true);
    setError("");
    try {
      await navigator.clipboard.writeText(link);
      if (stillHere()) feedback.toast("Invitation link copied.");
    } catch {
      if (stillHere())
        setError(
          "Copy is unavailable. Select and copy the invitation link below.",
        );
    } finally {
      if (stillHere()) setCopying(false);
    }
  }
  if (!authorized || denied)
    return (
      <section className="dashboard-status">
        <h1>Owner access required</h1>
        <p role="alert">Only this shop’s owner can manage staff.</p>
        <Link className="secondary-button" to="/app/shops">
          Choose another shop
        </Link>
      </section>
    );
  if (query.isPending || query.isFetching)
    return (
      <section className="dashboard-status" role="status">
        Checking staff access…
      </section>
    );
  if (query.isError)
    return (
      <section className="dashboard-status">
        <h1>Unable to load staff</h1>
        <InlineMessage>{errorMessage(query.error)}</InlineMessage>
        <button className="primary-button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </section>
    );
  const members = query.data.members.filter((member) =>
    `${member.email} ${member.role}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const pendingCount = query.data.invitations.filter(
    (invitation) => invitation.status === "PENDING",
  ).length;
  const roleDecision =
    decision?.kind === "role"
      ? roleDecisionCopy(decision, membership.shop.name)
      : null;
  return (
    <section className="shop-context-content staff-workspace">
      <header className="staff-heading">
        <div>
          <p className="section-label">YOUR PEOPLE</p>
          <h1 ref={heading} tabIndex={-1}>
            Staff & invitations
          </h1>
          <p>Manage access to {membership.shop.name}.</p>
        </div>
        <div className="staff-overview" role="group" aria-label="Team overview">
          <span>
            <FiUsers aria-hidden="true" />
            {query.data.members.length}{" "}
            {query.data.members.length === 1 ? "member" : "members"}
          </span>
          <span>
            <FiClock aria-hidden="true" />
            {pendingCount} pending {pendingCount === 1 ? "invite" : "invites"}
          </span>
        </div>
      </header>
      <div className="staff-grid">
        <div className="staff-team-panels">
          <section className="staff-panel" aria-labelledby="staff-list-title">
            <header className="staff-panel-heading">
              <div>
                <p className="section-label">TEAM ACCESS</p>
                <h2 id="staff-list-title">Shop members</h2>
              </div>
              <span className="staff-count">{query.data.members.length}</span>
            </header>
            <p id="staff-owner-protection" className="staff-owner-protection">
              <FiLock aria-hidden="true" />
              Owner memberships are protected. They cannot be removed or have
              their role changed here, so the shop keeps its owner.
            </p>
            <div className="staff-search">
              <FiSearch aria-hidden="true" />
              <input
                aria-label="Search shop members"
                ref={searchInput}
                placeholder="Search by email or role"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear member search"
                  onClick={() => {
                    setSearch("");
                    searchInput.current?.focus();
                  }}
                >
                  <FiX aria-hidden="true" />
                </button>
              )}
            </div>
            {search && (
              <p className="staff-search-results" role="status">
                {members.length} {members.length === 1 ? "member" : "members"}{" "}
                found.
              </p>
            )}
            <ul className="staff-list">
              {members.map((member) => (
                <li key={member.id}>
                  <div className="staff-person">
                    <span className="staff-avatar" aria-hidden="true">
                      {member.email.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="staff-person-details">
                      <strong>{member.email}</strong>
                      <span>
                        {member.role.toLowerCase()}
                        {!member.isActive ? " · account inactive" : ""}
                      </span>
                    </div>
                  </div>
                  {member.role === "OWNER" ? (
                    <span
                      className="staff-owner-badge"
                      aria-describedby="staff-owner-protection"
                    >
                      <FiLock aria-hidden="true" /> Owner
                    </span>
                  ) : (
                    <div className="staff-actions">
                      <SelectField
                        id={`role-${member.id}`}
                        label={`Role for ${member.email}`}
                        value={member.role}
                        options={roles}
                        onChange={(value) => {
                          if (value !== member.role)
                            setDecision({
                              kind: "role",
                              id: member.id,
                              email: member.email,
                              role: value as StaffRole,
                              previousRole: member.role as StaffRole,
                            });
                        }}
                        disabled={busy}
                      />
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          setDecision({
                            kind: "remove",
                            id: member.id,
                            email: member.email,
                          })
                        }
                      >
                        <FiUserMinus aria-hidden="true" /> Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {!members.length && (
              <div className="staff-empty">
                <FiUsers aria-hidden="true" />
                <p>
                  {search
                    ? "No members match your search."
                    : "No shop members to show."}
                </p>
                {search && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSearch("");
                      searchInput.current?.focus();
                    }}
                  >
                    Show all members
                  </button>
                )}
              </div>
            )}
          </section>
          <section className="staff-panel" aria-labelledby="invitations-title">
            <header className="staff-panel-heading">
              <div>
                <p className="section-label">INVITATION HISTORY</p>
                <h2 id="invitations-title">Recent invitations</h2>
              </div>
              <span className="staff-count">
                {query.data.invitations.length}
              </span>
            </header>
            {!query.data.invitations.length ? (
              <div className="staff-empty">
                <FiMail aria-hidden="true" />
                <p>No invitations yet.</p>
                <span>Your first invitation will appear here.</span>
              </div>
            ) : (
              <ul className="staff-list">
                {query.data.invitations.map((invitation) => (
                  <li key={invitation.id}>
                    <div className="staff-person">
                      <span
                        className="staff-avatar staff-invitation-avatar"
                        aria-hidden="true"
                      >
                        <FiMail />
                      </span>
                      <div className="staff-person-details">
                        <strong>{invitation.email}</strong>
                        <span>
                          {invitation.role.toLowerCase()}{" "}
                          <span
                            className={`staff-invitation-status is-${invitation.status.toLowerCase()}`}
                          >
                            {invitation.status.toLowerCase()}
                          </span>
                        </span>
                        <span>
                          <FiClock aria-hidden="true" />{" "}
                          {invitation.status === "PENDING"
                            ? "Expires"
                            : "Link expiry"}{" "}
                          <time dateTime={invitation.expiresAt}>
                            {new Date(invitation.expiresAt).toLocaleString()}
                          </time>
                        </span>
                      </div>
                    </div>
                    {["PENDING", "EXPIRED"].includes(invitation.status) && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          setDecision({
                            kind: "revoke",
                            id: invitation.id,
                            email: invitation.email,
                          })
                        }
                      >
                        Revoke invitation
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <section
          className="staff-panel staff-invite-panel"
          aria-labelledby="invite-staff-title"
        >
          <header className="staff-invite-heading">
            <span className="staff-invite-icon">
              <FiUserPlus aria-hidden="true" />
            </span>
            <p className="section-label">GROW YOUR TEAM</p>
            <h2 id="invite-staff-title">Invite staff</h2>
            <p>Give the right person the right access.</p>
          </header>
          <div className="staff-invite-body">
            <form
              className="registration-form"
              onSubmit={(event) => void submit(event)}
              noValidate
            >
              <div className="field">
                <label htmlFor="staff-email">Staff email address</label>
                <input
                  id="staff-email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                  required
                  placeholder="name@example.com"
                />
              </div>
              <SelectField
                id="staff-role"
                label="Shop role"
                value={role}
                options={roles}
                onChange={(value) => setRole(value as StaffRole)}
                disabled={busy}
                describedBy="staff-role-description"
              />
              <p id="staff-role-description" className="staff-role-description">
                {roleDescriptions[role]}
              </p>
              <button className="primary-button" disabled={busy}>
                {busy ? "Saving…" : "Create invitation link"}
                <FiArrowUpRight aria-hidden="true" />
              </button>
            </form>
            <p className="staff-hint">
              <FiLock aria-hidden="true" />
              They sign in or create their own account using the invited email.
              Share the link directly; you never need their password.
            </p>
            <details className="staff-invite-guidance">
              <summary>How invitation links work</summary>
              <p>
                Links expire after 7 days. Creating another invitation for the
                same email replaces the previous unaccepted link.
              </p>
            </details>
            {error && <InlineMessage>{error}</InlineMessage>}
            {link && (
              <div className="staff-link field">
                <label htmlFor="invitation-link">
                  Invitation link — save it before leaving this page
                </label>
                <input
                  id="invitation-link"
                  value={link}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <button
                  className="secondary-button"
                  onClick={() => void copy()}
                  disabled={copying || busy}
                >
                  <FiLink aria-hidden="true" />
                  {copying ? "Copying…" : "Copy invitation link"}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
      <DecisionDialog
        open={Boolean(decision)}
        title={
          roleDecision
            ? roleDecision.title
            : decision?.kind === "remove"
              ? "Remove staff access?"
              : "Revoke invitation?"
        }
        description={
          roleDecision
            ? roleDecision.description
            : decision?.kind === "remove"
              ? `${decision.email} will lose access to this shop. Their account and other shop memberships remain available.`
              : `The invitation for ${decision?.email} will stop working.`
        }
        confirmLabel={
          roleDecision
            ? roleDecision.confirmLabel
            : decision?.kind === "remove"
              ? "Remove access"
              : "Revoke invitation"
        }
        destructive={decision?.kind !== "role"}
        onClose={() => setDecision(null)}
        errorMessage={errorMessage}
        onConfirm={async () => {
          if (!decision) return;
          await run(
            () =>
              decision.kind === "role"
                ? changeStaffRole(shopId, decision.id, decision.role!)
                : decision.kind === "remove"
                  ? removeStaff(shopId, decision.id)
                  : revokeInvitation(shopId, decision.id),
            roleDecision?.success ?? "Staff access updated.",
          );
        }}
      />
    </section>
  );
}
