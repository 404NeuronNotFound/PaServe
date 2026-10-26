import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { ErrorState } from "../../components/feedback/ErrorState";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey } from "../auth/api/session";
import { getShopMembership } from "../shops/api/context";
import { ActiveShopContext, useActiveShop } from "../shops/active-shop";
import { canUseKitchen } from "./access";
import { AccessGate } from "../auth/components/AccessGate";
import {
  accessRevalidation,
  useAccessOnline,
  useAccessDenial,
  useDiscardAccessCache,
  useEndRevokedSession,
  useRecentAccess,
} from "../auth/access-revalidation";
import { AccessSkeleton } from "../../components/feedback/LoadingSkeleton";

// Every preparation child belongs beneath this boundary. The API
// must also enforce the action permission and live shop access on each request.
export function KitchenRoute() {
  const { shopId } = useActiveShop();
  const online = useAccessOnline();
  const location = useLocation();
  const client = useQueryClient();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ?? "";
  const access = useQuery({
    queryKey: ["kitchen", "access", userId, shopId],
    queryFn: ({ signal }) => getShopMembership(shopId, signal),
    enabled: Boolean(userId),
    retry: false,
    networkMode: "always",
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    ...accessRevalidation,
  });
  const status = useAccessDenial(
    `${userId}:${shopId}`,
    isAxiosError(access.error) ? access.error.response?.status : undefined,
  );
  useEndRevokedSession(status === 401);
  useDiscardAccessCache(
    client,
    status !== undefined,
    status === 401 ? undefined : shopId,
  );
  const recent = useRecentAccess(access.dataUpdatedAt);
  const loading = (
    <AccessSkeleton label="Checking kitchen access..." view="kitchen" />
  );
  if (status === 401 || !userId)
    return (
      <Navigate to="/login" replace state={{ returnTo: location.pathname }} />
    );
  const unavailable = status === 400 || status === 403 || status === 404;
  if (access.data && !canUseKitchen(access.data.role) && !access.isFetching)
    return <Navigate to={`/app/shops/${encodeURIComponent(shopId)}`} replace />;
  const error = (
    <section className="dashboard-status shop-context-error">
      <h1>
        {access.isError && !unavailable
          ? "Unable to check kitchen access"
          : "Kitchen access required"}
      </h1>
      {access.isError && !unavailable ? (
        <ErrorState
          error={access.error}
          resource="kitchen access"
          publicView
          pending={access.isFetching}
          onRetry={() => access.refetch()}
          retryLabel="Try again"
        />
      ) : (
        <p role="alert">
          You need an active kitchen, owner, admin, or manager membership in
          this shop.
        </p>
      )}
      <Link className="secondary-button" to="/app/shops">
        Choose another shop
      </Link>
    </section>
  );
  if (unavailable) return error;
  const pending = access.isPending || access.isFetching;
  const granted =
    access.isSuccess && !!access.data && canUseKitchen(access.data.role);
  return (
    <AccessGate
      key={`${userId}:${shopId}`}
      allowed={online && granted && recent && access.isFetchedAfterMount}
      pending={pending && online}
      fallback={pending && online ? loading : error}
      label="Checking kitchen access..."
    >
      {access.data && (
        <ActiveShopContext.Provider value={access.data}>
          <Outlet />
        </ActiveShopContext.Provider>
      )}
    </AccessGate>
  );
}
