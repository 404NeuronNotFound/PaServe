import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { FiUsers, FiLink } from "react-icons/fi";
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
    ? (error.response?.data.message ??
        "Unable to complete this action. Check your connection and try again.")
    : "Unable to complete this action. Check your connection and try again.";
}
type Decision = {
  kind: "role" | "remove" | "revoke";
  id: string;
  email: string;
  role?: StaffRole;
};
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
  return (
    <section className="shop-context-content staff-workspace">
      <header className="staff-heading">
        <FiUsers aria-hidden="true" />
        <div>
          <p className="section-label">YOUR PEOPLE</p>
          <h1 ref={heading} tabIndex={-1}>
            Staff & invitations
          </h1>
          <p>Manage access to {membership.shop.name}.</p>
        </div>
      </header>
      <div className="staff-grid">
        <section className="staff-panel" aria-labelledby="invite-staff-title">
          <h2 id="invite-staff-title">Invite staff</h2>
          <p>
            They use their own account and password. Share the link directly
            with the person you invite.
          </p>
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
              />
            </div>
            <SelectField
              id="staff-role"
              label="Shop role"
              value={role}
              options={roles}
              onChange={(value) => setRole(value as StaffRole)}
              disabled={busy}
            />
            <button className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Create invitation link"}
            </button>
          </form>
          <p className="staff-hint">
            Links expire after 7 days. Creating another invitation for the same
            email replaces the previous unaccepted link.
          </p>
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
        </section>
        <section className="staff-panel" aria-labelledby="staff-list-title">
          <h2 id="staff-list-title">Shop members</h2>
          <ul className="staff-list">
            {query.data.members.map((member) => (
              <li key={member.id}>
                <div>
                  <strong>{member.email}</strong>
                  <span>
                    {member.role.toLowerCase()}
                    {!member.isActive ? " · account inactive" : ""}
                  </span>
                </div>
                {member.role === "OWNER" ? (
                  <span>Owner</span>
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
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="staff-panel" aria-labelledby="invitations-title">
        <h2 id="invitations-title">Recent invitations</h2>
        {!query.data.invitations.length ? (
          <p>No invitations yet.</p>
        ) : (
          <ul className="staff-list">
            {query.data.invitations.map((invitation) => (
              <li key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <span>
                    {invitation.role.toLowerCase()} ·{" "}
                    {invitation.status.toLowerCase()}
                  </span>
                  <span>
                    Expires {new Date(invitation.expiresAt).toLocaleString()}
                  </span>
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
      <DecisionDialog
        open={Boolean(decision)}
        title={
          decision?.kind === "role"
            ? "Change staff role?"
            : decision?.kind === "remove"
              ? "Remove staff access?"
              : "Revoke invitation?"
        }
        description={
          decision?.kind === "role"
            ? `${decision.email} will become ${decision.role?.toLowerCase()} in this shop.`
            : decision?.kind === "remove"
              ? `${decision.email} will lose access to this shop. Their account and other shop memberships remain available.`
              : `The invitation for ${decision?.email} will stop working.`
        }
        confirmLabel={
          decision?.kind === "role"
            ? "Change role"
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
            "Staff access updated.",
          );
        }}
      />
    </section>
  );
}
