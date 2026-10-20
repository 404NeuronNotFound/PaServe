import { useEffect } from "react";
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
  const user =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user;
  const context = useQuery({
    queryKey: activeShopKey(user.id, shopId),
    queryFn: ({ signal }) => getShopMembership(shopId, signal),
    retry: false,
    // Attempt validation even when the browser reports offline; show a retryable
    // error instead of exposing cached context while a query is paused.
    networkMode: "always",
    staleTime: 0,
    gcTime: 0,
    // Automatic background validation would replace the outlet with the access
    // loader and silently discard an in-progress settings draft. Validate on
    // route entry; business requests still enforce live membership in the API.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const status = isAxiosError(context.error)
    ? context.error.response?.status
    : undefined;
  const unavailable = status === 400 || status === 403 || status === 404;
  useEffect(() => {
    if (context.isSuccess && !context.isFetching)
      rememberShop(user.id, context.data.shopId);
    if (unavailable && rememberedShop(user.id) === shopId)
      rememberShop(user.id, null);
  }, [
    context.isSuccess,
    context.isFetching,
    context.data,
    unavailable,
    user.id,
    shopId,
  ]);
  if (context.isPending || context.isFetching)
    return (
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
  if (status === 401)
    return (
      <Navigate to="/login" replace state={{ returnTo: location.pathname }} />
    );
  if (context.isError)
    return (
      <DashboardFrame membership={null}>
        <section className="dashboard-status shop-context-error">
          <h1>
            {unavailable ? "Shop unavailable" : "Unable to open this shop"}
          </h1>
          {unavailable ? <p role="alert">This shop is unavailable or you no longer have access.</p> : (
            <ErrorState error={context.error} resource="this shop workspace" publicView
              pending={context.isFetching} onRetry={() => context.refetch()} retryLabel="Try again" />
          )}
          <Link className="secondary-button" to="/app/shops">
            Choose another shop
          </Link>
        </section>
      </DashboardFrame>
    );
  return (
    <ActiveShopContext.Provider value={context.data}>
      <Outlet />
    </ActiveShopContext.Provider>
  );
}
