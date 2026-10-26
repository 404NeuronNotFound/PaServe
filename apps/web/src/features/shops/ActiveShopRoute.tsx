import { useEffect } from "react";
import { AccessGate } from "../auth/components/AccessGate";
import {
  accessRevalidation,
  useAccessDenial,
  useAccessOnline,
  useDiscardAccessCache,
  useDiscardRoleData,
  useEndRevokedSession,
  useRecentAccess,
} from "../auth/access-revalidation";
import { navigationForRole } from "../../components/layout/workspace-navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { ErrorState } from "../../components/feedback/ErrorState";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey } from "../auth/api/session";
import { getShopMembership } from "./api/context";
import { DashboardFrame } from "../../components/layout/OwnerDashboardLayout";
import { AccessSkeleton } from "../../components/feedback/LoadingSkeleton";
import {
  ActiveShopContext,
  activeShopKey,
  rememberShop,
  rememberedShop,
} from "./active-shop";

export function ActiveShopRoute() {
  const { shopId = "" } = useParams();
  const location = useLocation();
  const client = useQueryClient();
  const online = useAccessOnline();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ?? "";
  const context = useQuery({
    queryKey: activeShopKey(userId, shopId),
    queryFn: ({ signal }) => getShopMembership(shopId, signal),
    enabled: Boolean(userId),
    retry: false,
    // Attempt validation even when the browser reports offline; show a retryable
    // error instead of exposing cached context while a query is paused.
    networkMode: "always",
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    ...accessRevalidation,
  });
  const status = useAccessDenial(
    `${userId}:${shopId}`,
    isAxiosError(context.error) ? context.error.response?.status : undefined,
  );
  useEndRevokedSession(status === 401);
  useDiscardAccessCache(
    client,
    status !== undefined,
    status === 401 ? undefined : shopId,
  );
  useDiscardRoleData(
    client,
    `${userId}:${shopId}`,
    shopId,
    context.isSuccess && !context.isFetching ? context.data.role : undefined,
  );
  const unavailable = status === 400 || status === 403 || status === 404;
  const recent = useRecentAccess(context.dataUpdatedAt);
  useEffect(() => {
    if (context.isSuccess && !context.isFetching)
      rememberShop(userId, context.data.shopId);
    if (unavailable && rememberedShop(userId) === shopId)
      rememberShop(userId, null);
  }, [
    context.isSuccess,
    context.isFetching,
    context.data,
    unavailable,
    userId,
    shopId,
  ]);
  const loading = (
    <DashboardFrame membership={null}>
      <AccessSkeleton
        label="Checking shop access…"
        view={
          /\/cashier(?:\/|$)/.test(location.pathname)
            ? "cashier"
            : /\/kitchen(?:\/|$)/.test(location.pathname)
              ? "kitchen"
              : "workspace"
        }
      />
    </DashboardFrame>
  );
  if (status === 401 || !userId)
    return (
      <Navigate to="/login" replace state={{ returnTo: location.pathname }} />
    );
  if (unavailable)
    return (
      <Navigate
        to="/app/account"
        replace
        state={{
          accessNotice:
            "This shop is unavailable or you no longer have access.",
        }}
      />
    );
  const error = (
    <DashboardFrame membership={null}>
      <section className="dashboard-status shop-context-error">
        <h1>{unavailable ? "Shop unavailable" : "Unable to open this shop"}</h1>
        {unavailable ? (
          <p role="alert">
            This shop is unavailable or you no longer have access.
          </p>
        ) : (
          <ErrorState
            error={context.error}
            resource="this shop workspace"
            publicView
            pending={context.isFetching}
            onRetry={() => context.refetch()}
            retryLabel="Try again"
          />
        )}
        <Link className="secondary-button" to="/app/shops">
          Choose another shop
        </Link>
      </section>
    </DashboardFrame>
  );
  const pending = context.isPending || context.isFetching;
  const membership = context.data;
  const relativePath = location.pathname.split("/").slice(4).join("/");
  const destination = relativePath.split("/")[0];
  const permitted =
    membership &&
    navigationForRole(membership.role).some((group) =>
      group.items.some((item) => item.path === destination),
    );
  return (
    <AccessGate
      key={`${userId}:${shopId}`}
      allowed={
        online && context.isSuccess && recent && context.isFetchedAfterMount
      }
      pending={pending && online}
      fallback={pending && online ? loading : error}
      label="Checking shop access…"
    >
      {membership && (
        <ActiveShopContext.Provider value={membership}>
          {permitted ? (
            <Outlet />
          ) : (
            <Navigate
              to={`/app/shops/${encodeURIComponent(shopId)}`}
              replace
              state={{
                accessNotice:
                  "Your shop permissions changed. Choose an available workspace.",
              }}
            />
          )}
        </ActiveShopContext.Provider>
      )}
    </AccessGate>
  );
}
