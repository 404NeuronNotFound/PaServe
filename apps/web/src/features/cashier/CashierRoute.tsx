import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey } from "../auth/api/session";
import { getShopMembership } from "../shops/api/context";
import { ActiveShopContext, useActiveShop } from "../shops/active-shop";
import { canUseCashier } from "./access";

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
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const status = isAxiosError(access.error)
    ? access.error.response?.status
    : undefined;
  if (access.isPending || access.isFetching)
    return (
      <section className="dashboard-status" role="status">
        Checking cashier access…
      </section>
    );
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
        <p role="alert">
          {access.isError && !unavailable
            ? "Please check your connection and try again."
            : "You need an active cashier, owner, admin, or manager membership in this shop."}
        </p>
        {access.isError && !unavailable && (
          <button
            className="primary-button"
            onClick={() => void access.refetch()}
          >
            Try again
          </button>
        )}
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
