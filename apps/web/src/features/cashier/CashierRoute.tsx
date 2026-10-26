import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { ErrorState } from "../../components/feedback/ErrorState";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey } from "../auth/api/session";
import { getShopMembership } from "../shops/api/context";
import { ActiveShopContext, useActiveShop } from "../shops/active-shop";
import { canUseCashier } from "./access";
import { AccessSkeleton } from "../../components/feedback/LoadingSkeleton";

// Every future scanner/payment child belongs beneath this boundary. The API
// must also enforce the action permission and live shop access on each request.
export function CashierRoute() {
  const { shopId } = useActiveShop();
  const location = useLocation();
  const user =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user;
  const access = useQuery({
    queryKey: ["cashier", "access", user.id, shopId],
    queryFn: ({ signal }) => getShopMembership(shopId, signal),
    retry: false,
    networkMode: "always",
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    // Keep the selected order/payment step mounted when returning to the tab.
    // Entry and explicit revalidation still fail closed; every API action checks
    // live cashier access, and the open order refreshes independently in place.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const status = isAxiosError(access.error)
    ? access.error.response?.status
    : undefined;
  if (access.isPending || access.isFetching)
    return <AccessSkeleton label="Checking cashier access…" view="cashier" />;
  if (status === 401)
    return (
      <Navigate to="/login" replace state={{ returnTo: location.pathname }} />
    );
  const unavailable = status === 400 || status === 403 || status === 404;
  if (access.isError || !canUseCashier(access.data.role))
    return (
      <section className="dashboard-status shop-context-error">
        <h1>
          {access.isError && !unavailable
            ? "Unable to check cashier access"
            : "Cashier access required"}
        </h1>
        {access.isError && !unavailable ? (
          <ErrorState error={access.error} resource="cashier access" publicView
            pending={access.isFetching} onRetry={() => access.refetch()} retryLabel="Try again" />
        ) : <p role="alert">You need an active cashier, owner, admin, or manager membership in this shop.</p>}
        <Link className="secondary-button" to="/app/shops">
          Choose another shop
        </Link>
      </section>
    );
  return (
    <ActiveShopContext.Provider value={access.data}>
      <Outlet />
    </ActiveShopContext.Provider>
  );
}
