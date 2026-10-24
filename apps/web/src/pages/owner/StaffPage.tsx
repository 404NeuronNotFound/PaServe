import { StatusBadge } from "../../components/paserve/StatusBadge";
import { RowActions } from "../../components/paserve/RowActions";
import { FormField } from "../../components/forms/FormField";
import { ListPagination } from "../../components/paserve/ListPagination";
import { listPage } from "../../lib/list-page";
import { useDraftGuard } from "../../app/router/useDraftGuard";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { StaffSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EmptyState } from "../../components/feedback/EmptyState";
import { ErrorState } from "../../components/feedback/ErrorState";
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
  FiUnlock,
  FiMoreHorizontal,
} from "react-icons/fi";
import {
  STAFF_ROLES,
  hasShopPermission,
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
  setStaffAccess,
} from "../../features/shops/api/staff";
import { SelectField } from "../../components/forms/SelectField";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { feedback } from "../../app/stores/feedback";
import "./staff.css";
import { PermissionMatrix } from "./PermissionMatrix";

const roles = STAFF_ROLES.map((value) => ({
  value,
  label:
    value === "KITCHEN"
      ? "Kitchen / Barista"
      : value[0] + value.slice(1).toLowerCase(),
}));
class StaffRefreshPending extends Error {}
function errorMessage(error: unknown) {
  if (error instanceof StaffRefreshPending)
    return "Staff details are refreshing. Wait for the latest details before confirming.";
  return isAxiosError<ApiErrorResponse>(error)
    ? (error.response?.data?.message ??
        "Unable to complete this action. Check your connection and try again.")
    : "Unable to complete this action. Check your connection and try again.";
}
type Decision = {
  kind: "role" | "remove" | "revoke" | "enable" | "disable";
  id: string;
  email: string;
  role?: StaffRole;
  previousRole?: StaffRole;
};
const roleDescriptions: Record<StaffRole, string> = {
  CASHIER:
    "Scan and read orders, confirm or reject orders, record payments, and update item availability. No menu or price editing, reports, kitchen preparation, staff management, settings, ownership, or billing access.",
  KITCHEN:
    "Kitchen and barista preparation: view the preparation queue and update preparation status. No order approval, payments, menu or price editing, reports, staff management, settings, ownership, or billing access.",
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
          : "kitchen/barista staff";
  const description = `${decision.email} will become ${assignedRole} in ${shopName}.`;
  const permissionDescription = decision.role
    ? roleDescriptions[decision.role]
    : "";
  if (decision.role === "KITCHEN")
    return {
      title: "Assign kitchen/barista role?",
      description: `${description} ${roleDescriptions.KITCHEN} ${decision.previousRole === "CASHIER" ? "They will lose counter permissions." : decision.previousRole === "ADMIN" ? "They will lose admin permissions." : decision.previousRole === "MANAGER" ? "They will lose manager permissions." : ""} Their membership keeps its current enabled or disabled status and uses the selected role's permissions.`,
      confirmLabel: "Assign kitchen/barista",
      success: "Kitchen/barista role assigned.",
    };
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
      description: `${description} They will lose admin permissions. Their membership keeps its current enabled or disabled status and uses the selected role's permissions. ${permissionDescription}`,
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
      description: `${description} They will lose manager permissions. Their membership keeps its current enabled or disabled status and uses the selected role's permissions. ${permissionDescription}`,
      confirmLabel: "Remove manager role",
      success: "Manager role removed.",
    };
  if (decision.role === "CASHIER")
    return {
      title: "Assign cashier role?",
      description: `${description} ${roleDescriptions.CASHIER}${decision.previousRole === "KITCHEN" ? " They will lose preparation permissions. Their membership keeps its current enabled or disabled status and uses the selected role's permissions." : ""}`,
      confirmLabel: "Assign cashier",
      success: "Cashier role assigned.",
    };
  return {
    title: "Change staff role?",
    description,
    confirmLabel: "Change role",
    success: "Staff access updated.",
  };
}
export function StaffPage() {
  const { shopId, role } = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return <StaffWorkspace key={`${userId}:${shopId}:${role}`} userId={userId} />;
}
function StaffWorkspace({ userId }: { userId: string }) {
  const membership = useActiveShop();
  const { shopId } = membership;
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const invitationEmail = useRef<HTMLInputElement>(null);
  const headingFocused = useRef(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const [email, setEmail] = useState("");
  const [managedMember, setManagedMember] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");
  const [roleError, setRoleError] = useState("");
  const serverErrorFocus = useRef<"staff-email" | "staff-role" | null>(null);
  const [role, setRole] = useState<StaffRole>("CASHIER");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [linkRecipient, setLinkRecipient] = useState("");
  const [linkInvitationId, setLinkInvitationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyingGuard = useRef(false);
  const [lostAccess, setLostAccess] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  useDraftGuard(Boolean(email), busy);
  const [search, setSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const [invitationPage, setInvitationPage] = useState(1);
  const [accessFilter, setAccessFilter] = useState("");
  const [memberSort, setMemberSort] = useState("roster");
  const [invitationSearch, setInvitationSearch] = useState("");
  const [invitationStatus, setInvitationStatus] = useState("");
  function resetMembers() {
    setSearch("");
    setAccessFilter("");
    setMemberPage(1);
    searchInput.current?.focus();
  }
  const authorized =
    hasShopPermission(membership.role, "shop.staff.manage") && !lostAccess;
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
    if (query.isFetching) throw new StaffRefreshPending();
    if (running.current || !authorized || !query.isSuccess || query.isFetching)
      return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      if (!stillHere()) return;
      if (decision?.kind === "revoke" && decision.id === linkInvitationId)
        setLink("");
      setDecision(null);
      feedback.toast(success);
      // Membership changes may also invalidate cached account/shop roles.
      await client.invalidateQueries({ queryKey: ["cashier"] });
      await query.refetch();
    } catch (failure) {
      if (
        stillHere() &&
        isAxiosError<ApiErrorResponse>(failure) &&
        failure.response?.status === 404 &&
        ["MEMBER_UNAVAILABLE", "INVITATION_UNAVAILABLE"].includes(
          failure.response.data?.code ?? "",
        )
      ) {
        // A stale target does not mean the acting owner lost shop access.
        // Refresh through the server; a genuine access denial still hides staff.
        setDecision(null);
        setError(errorMessage(failure));
        await query.refetch();
        return;
      }
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
      setError("");
      setEmailError("Enter a valid email address.");
      invitationEmail.current?.focus();
      return;
    }
    setEmailError("");
    setRoleError("");
    if (running.current) return;
    try {
      await run(async () => {
        setLink("");
        const result = await inviteStaff(shopId, { email: normalized, role });
        if (stillHere()) {
          setLink(staffInvitationLink(shopId, result.token));
          setLinkRecipient(normalized);
          setLinkInvitationId(result.invitation.id);
          setEmail("");
        }
      }, `Invitation link created for ${normalized}.`);
    } catch (failure) {
      if (stillHere()) {
        const fields = isAxiosError<ApiErrorResponse>(failure)
          ? failure.response?.data.fieldErrors
          : undefined;
        setEmailError(fields?.email?.[0] ?? "");
        setRoleError(fields?.role?.[0] ?? "");
        setError(errorMessage(failure));
        serverErrorFocus.current = fields?.email?.length
          ? "staff-email" : fields?.role?.length ? "staff-role" : null;
      }
    }
  }
  useEffect(() => {
    if (busy || !serverErrorFocus.current) return;
    document.getElementById(serverErrorFocus.current)?.focus();
    serverErrorFocus.current = null;
  }, [busy, emailError, roleError]);
  async function copy() {
    if (copyingGuard.current || !link || busy) return;
    copyingGuard.current = true;
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
      copyingGuard.current = false;
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
  if (query.isPending || (query.isFetching && !query.isFetchedAfterMount))
    return (
      <StaffSkeleton />
    );
  if (query.isError)
    return (
      <section className="dashboard-status">
        <h1>Unable to load staff</h1>
        <ErrorState error={query.error} resource="your staff and invitations"
          pending={query.isFetching} onRetry={() => query.refetch()} retryLabel="Try again" />
      </section>
    );
  const members = query.data.members.filter((member) =>
    `${member.email} ${member.role} ${member.role === "KITCHEN" ? "barista" : ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()) &&
      (!accessFilter || (accessFilter === "inactive" ? !member.isActive :
        accessFilter === "enabled" ? member.isEnabled && member.isActive : !member.isEnabled)),
  );
  if (memberSort !== "roster") members.sort((a, b) =>
    memberSort === "role" ? a.role.localeCompare(b.role) || a.email.localeCompare(b.email) :
      memberSort === "email-desc" ? b.email.localeCompare(a.email) : a.email.localeCompare(b.email));
  const memberResults = listPage(members, memberPage, 10);
  const invitations = query.data.invitations.filter((invitation) =>
    `${invitation.email} ${invitation.role} ${invitation.role === "KITCHEN" ? "barista" : ""}`
      .toLowerCase().includes(invitationSearch.trim().toLowerCase()) &&
    (!invitationStatus || invitation.status === invitationStatus));
  const invitationResults = listPage(invitations, invitationPage, 10);
  const hasMemberFilters = Boolean(search || accessFilter);
  const hasInvitationFilters = Boolean(invitationSearch || invitationStatus);
  const pendingCount = query.data.invitations.filter(
    (invitation) => invitation.status === "PENDING",
  ).length;
  const roleDecision =
    decision?.kind === "role"
      ? roleDecisionCopy(decision, membership.shop.name)
      : null;
  const accessDecision =
    decision?.kind === "enable" || decision?.kind === "disable"
      ? {
          title:
            decision.kind === "enable"
              ? "Enable shop access?"
              : "Disable shop access?",
          description:
            decision.kind === "enable"
              ? `${decision.email} will regain access to ${membership.shop.name} with their saved role. Their account must also be active.`
              : `${decision.email} will lose access to ${membership.shop.name} until re-enabled. Their account, role, history, and other shop memberships are kept.`,
          confirmLabel:
            decision.kind === "enable" ? "Enable access" : "Disable access",
          success:
            decision.kind === "enable"
              ? "Shop access enabled."
              : "Shop access disabled.",
        }
      : null;
  return (
    <section className="shop-context-content staff-workspace" aria-busy={query.isFetching}>
      <header className="staff-heading">
        <div>
          <p className="section-label">YOUR PEOPLE</p>
          <h1 ref={heading} tabIndex={-1}>
            Staff & invitations
          </h1>
          <p>Manage access to {membership.shop.name}.</p>
          <span className="staff-refresh-status" role={query.isFetching ? "status" : undefined}>
            {query.isFetching ? "Refreshing staff…" : ""}
          </span>
        </div>
        <div className="staff-heading-actions">
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
          <Button type="button" disabled={busy} onClick={() => invitationEmail.current?.focus()}>
            <FiUserPlus aria-hidden="true" /> Invite staff
          </Button>
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
              Owner memberships are protected. They cannot be disabled, removed,
              or have their role changed here, so the shop keeps its owner.
            </p>
            <div className="staff-search">
              <FiSearch aria-hidden="true" />
              <Input
                aria-label="Search shop members"
                ref={searchInput}
                placeholder="Search by email or role"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setMemberPage(1); }}
              />
              {search && (
                <Button variant="ghost" size="inherit"
                  type="button"
                  aria-label="Clear member search"
                  onClick={() => {
                    setSearch("");
                    setMemberPage(1);
                    searchInput.current?.focus();
                  }}
                >
                  <FiX aria-hidden="true" />
                </Button>
              )}
            </div>
            <div className="management-filters staff-member-filters">
              <FormField id="staff-access-filter" label="Access">
                <SelectField id="staff-access-filter" label="Filter member access" value={accessFilter}
                  disabled={busy} onChange={(value) => { setAccessFilter(value); setMemberPage(1); }}
                  options={[{ value: "", label: "All access states" }, { value: "enabled", label: "Enabled and active" },
                    { value: "disabled", label: "Access disabled" }, { value: "inactive", label: "Account inactive" }]} />
              </FormField>
              <FormField id="staff-sort" label="Sort by">
                <SelectField id="staff-sort" label="Sort members" value={memberSort}
                  disabled={busy} onChange={(value) => { setMemberSort(value); setMemberPage(1); }}
                  options={[{ value: "roster", label: "Roster order" }, { value: "email", label: "Email A to Z" },
                    { value: "email-desc", label: "Email Z to A" }, { value: "role", label: "Role, then email" }]} />
              </FormField>
            </div>
            <div className="staff-filter-results">
              <p className="management-results staff-search-results" role="status">
              {memberResults.first}-{memberResults.last} of {members.length} {members.length === 1 ? "member" : "members"}
              {hasMemberFilters ? " found." : "."}
              </p>
              {hasMemberFilters && <Button variant="ghost" size="sm" type="button"
                aria-label="Clear member filters" disabled={busy} onClick={resetMembers}>
                <FiX aria-hidden="true" /> Clear filters
              </Button>}
            </div>
            <ul className="staff-list staff-member-list">
              {memberResults.records.map((member) => (
                <li key={member.id}>
                  <div className="staff-person">
                    <span className="staff-avatar" aria-hidden="true">
                      {member.email.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="staff-person-details">
                      <strong>{member.email}</strong>
                      <span className="staff-member-meta">
                        {member.role === "KITCHEN"
                          ? "kitchen / barista"
                          : member.role.toLowerCase()}
                        {!member.isActive ? " · account inactive" : ""}
                        <StatusBadge state={member.isEnabled ? "ENABLED" : "DISABLED"} />
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
                    <Button variant="ghost" type="button" className="staff-manage-trigger"
                      aria-label={`Manage access for ${member.email}`}
                      title={`Manage access for ${member.email}`}
                      aria-expanded={managedMember === member.id}
                      aria-controls={managedMember === member.id ? `staff-access-${member.id}` : undefined}
                      disabled={busy}
                      onClick={() => setManagedMember(managedMember === member.id ? null : member.id)}>
                      <span>Manage access</span> <FiMoreHorizontal aria-hidden="true" />
                    </Button>
                  )}
                  {member.role !== "OWNER" && managedMember === member.id && (
                    <RowActions id={`staff-access-${member.id}`} label={`Actions for ${member.email}`} className="staff-actions">
                      <FormField id={`role-${member.id}`} label="Shop role" className="staff-member-role">
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
                      </FormField>
                      <Button variant="outline" size="inherit" type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          setDecision({
                            kind: member.isEnabled ? "disable" : "enable",
                            id: member.id,
                            email: member.email,
                          })
                        }
                      >
                        {member.isEnabled ? <FiLock aria-hidden="true" /> : <FiUnlock aria-hidden="true" />}
                        {member.isEnabled ? "Disable" : "Enable"}
                      </Button>
                      <Button variant="outline" size="inherit" type="button"
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
                      </Button>
                    </RowActions>
                  )}
                </li>
              ))}
            </ul>
            {query.data.members.length > 10 && <ListPagination label="Shop members pagination" page={memberResults.page} pageCount={memberResults.pageCount}
              hasNext={memberResults.hasNext} pending={busy}
              onPrevious={() => setMemberPage(memberResults.page - 1)} onNext={() => setMemberPage(memberResults.page + 1)} />}
            {!members.length && (
              <EmptyState icon={<FiUsers />} title={hasMemberFilters ? "No members match your search." : "No shop members to show."}
                description={hasMemberFilters ? "Try another email, role or access state, or show the full team." : "Invite a teammate and choose the access they need for this shop."}>
                {hasMemberFilters && (
                  <Button variant="outline" size="inherit" type="button"
                    className="secondary-button"
                    onClick={() => {
                      resetMembers();
                    }}
                  >
                    Show all members
                  </Button>
                )}
                {!hasMemberFilters && <Button variant="default" size="inherit" type="button" className="primary-button" disabled={busy}
                  onClick={() => document.getElementById("staff-email")?.focus()}>Invite your first teammate</Button>}
              </EmptyState>
            )}
            {!hasMemberFilters && query.data.members.length > 0 && query.data.members.every((member) => member.role === "OWNER") && (
              <EmptyState icon={<FiUsers />} title="Your team starts with you."
                description="No staff have joined this shop yet. Invite a teammate and choose the access they need.">
                <Button variant="default" size="inherit" type="button" className="primary-button" disabled={busy}
                  onClick={() => document.getElementById("staff-email")?.focus()}>Invite your first teammate</Button>
              </EmptyState>
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
            {query.data.invitations.length > 0 && <>
            <p className="management-results">Showing up to 100 recent invitations. Search and filters apply to this history.</p>
            <div className="management-filters">
              <FormField id="invitation-search" label="Search invitations">
                <Input id="invitation-search" type="search" autoComplete="off" value={invitationSearch}
                  placeholder="Email or role" onChange={(event) => { setInvitationSearch(event.target.value); setInvitationPage(1); }} />
              </FormField>
              <FormField id="invitation-status-filter" label="Filter invitation status">
                <SelectField id="invitation-status-filter" label="Filter invitation status" value={invitationStatus}
                  disabled={busy} onChange={(value) => { setInvitationStatus(value); setInvitationPage(1); }}
                  options={[{ value: "", label: "All invitation states" }, ...["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"].map((value) => ({ value, label: value[0] + value.slice(1).toLowerCase() }))]} />
              </FormField>
            </div>
            <p className="management-results" role="status">
              {invitationResults.first}-{invitationResults.last} of {invitations.length} invitations
              {hasInvitationFilters ? " found in recent history." : " in recent history."}
            </p>
            {hasInvitationFilters && <Button variant="outline" disabled={busy} onClick={() => {
              setInvitationSearch(""); setInvitationStatus(""); setInvitationPage(1);
              document.getElementById("invitation-search")?.focus();
            }}>Clear invitation filters</Button>}
            </>}
            {hasInvitationFilters && query.data.invitations.length > 0 && !invitations.length && <EmptyState icon={<FiMail />} title="No matching invitations."
              description="Try another email, role or status, or clear the invitation filters." />}
            {!query.data.invitations.length ? (
              <EmptyState icon={<FiMail />} title="No invitations yet."
                description="Your first invitation will appear here. Create a link and share it with your teammate.">
                <Button variant="outline" size="inherit" type="button" className="secondary-button" disabled={busy}
                  onClick={() => document.getElementById("staff-email")?.focus()}>Start an invitation</Button>
              </EmptyState>
            ) : (
              <ul className="staff-list">
                {invitationResults.records.map((invitation) => (
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
                          {invitation.role === "KITCHEN"
                            ? "kitchen / barista"
                            : invitation.role.toLowerCase()}{" "}
                          <StatusBadge state={invitation.status}
                            className={`staff-invitation-status is-${invitation.status.toLowerCase()}`}>
                            {invitation.status.toLowerCase()}
                          </StatusBadge>
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
                      <Button variant="outline" size="inherit" type="button"
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
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {query.data.invitations.length > 10 && <ListPagination label="Invitations pagination" page={invitationResults.page} pageCount={invitationResults.pageCount}
              hasNext={invitationResults.hasNext} pending={busy}
              onPrevious={() => setInvitationPage(invitationResults.page - 1)} onNext={() => setInvitationPage(invitationResults.page + 1)} />}
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
              aria-busy={busy}
              onSubmit={(event) => void submit(event)}
              noValidate
            >
              <FormField id="staff-email" label="Staff email address" error={emailError} required>
                <Input
                  ref={invitationEmail}
                  id="staff-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={254}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailError("");
                  }}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? "staff-email-error" : undefined}
                  disabled={busy}
                  required
                  placeholder="name@example.com"
                />

              </FormField>
              <FormField id="staff-role" label="Shop role" required hint={roleDescriptions[role]} hintId="staff-role-description" error={roleError}>
              <SelectField
                id="staff-role"
                label="Shop role"
                value={role}
                options={roles}
                onChange={(value) => {
                  setRole(value as StaffRole);
                  setRoleError("");
                }}
                disabled={busy}
                describedBy="staff-role-description"
              />
              </FormField>
              <Button variant="default" size="inherit" type="submit"
                aria-busy={busy || query.isFetching} className="primary-button" disabled={busy || query.isFetching}>
                {busy ? "Creating invitation…" : query.isFetching ? "Refreshing staff…" : "Create invitation link"}
                <FiArrowUpRight aria-hidden="true" />
              </Button>
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
                <InlineMessage tone="success">
                  Invitation link ready for {linkRecipient}. Share it directly with your teammate.
                </InlineMessage>
                <label htmlFor="invitation-link">
                  Invitation link — save it before leaving this page
                </label>
                <Input
                  id="invitation-link"
                  value={link}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <Button variant="outline" size="inherit" type="button"
                  className="secondary-button"
                  onClick={() => void copy()}
                  disabled={copying || busy}
                >
                  <FiLink aria-hidden="true" />
                  {copying ? "Copying…" : "Copy invitation link"}
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
      <PermissionMatrix />
      <DecisionDialog
        open={Boolean(decision)}
        title={
          accessDecision
            ? accessDecision.title
            : roleDecision
              ? roleDecision.title
              : decision?.kind === "remove"
                ? "Remove staff access?"
                : "Revoke invitation?"
        }
        description={
          accessDecision
            ? accessDecision.description
            : roleDecision
              ? roleDecision.description
              : decision?.kind === "remove"
                ? `${decision.email} will lose access to this shop. Their account and other shop memberships remain available.`
                : `The invitation for ${decision?.email} will stop working.`
        }
        confirmLabel={
          accessDecision
            ? accessDecision.confirmLabel
            : roleDecision
              ? roleDecision.confirmLabel
              : decision?.kind === "remove"
                ? "Remove access"
                : "Revoke invitation"
        }
        destructive={
          decision?.kind === "remove" ||
          decision?.kind === "revoke" ||
          decision?.kind === "disable"
        }
        onClose={() => setDecision(null)}
        errorMessage={errorMessage}
        onConfirm={async () => {
          if (!decision) return;
          await run(
            () =>
              decision.kind === "enable" || decision.kind === "disable"
                ? setStaffAccess(shopId, decision.id, {
                    isEnabled: decision.kind === "enable",
                  })
                : decision.kind === "role"
                  ? changeStaffRole(shopId, decision.id, decision.role!)
                  : decision.kind === "remove"
                    ? removeStaff(shopId, decision.id)
                    : revokeInvitation(shopId, decision.id),
            accessDecision?.success ??
              roleDecision?.success ??
              (decision.kind === "revoke"
                ? `Invitation revoked for ${decision.email}.`
                : decision.kind === "remove"
                  ? `Shop access removed for ${decision.email}.`
                  : "Staff access updated."),
          );
        }}
      />
    </section>
  );
}
