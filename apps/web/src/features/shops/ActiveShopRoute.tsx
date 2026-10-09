import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link, Navigate, Outlet, useParams } from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey } from "../auth/api/session";
import { getShopMembership } from "./api/context";
import {
  ActiveShopContext,
  activeShopKey,
  rememberShop,
  rememberedShop,
} from "./active-shop";

export function ActiveShopRoute() {
  const { shopId = "" } = useParams();
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
      <main className="connection-page" role="status">
        Checking shop access…
      </main>
    );
  if (status === 401) return <Navigate to="/login" replace />;
  if (context.isError)
    return (
      <main className="connection-page shop-context-error">
        <h1>{unavailable ? "Shop unavailable" : "Unable to open this shop"}</h1>
        <p role="alert">
          {unavailable
            ? "This shop is unavailable or you no longer have access."
            : "Please check your connection and try again."}
        </p>
        {!unavailable && (
          <button
            className="primary-button"
            onClick={() => void context.refetch()}
          >
            Try again
          </button>
        )}
        <Link className="secondary-button" to="/app/shops">
          Choose another shop
        </Link>
      </main>
    );
  return (
    <ActiveShopContext.Provider value={context.data}>
      <Outlet />
    </ActiveShopContext.Provider>
  );
}
