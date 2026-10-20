import { MenuSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useEffect, useState } from "react";
import { ErrorState } from "../../components/feedback/ErrorState";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { PublicMenuResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import "./public-menu.css";
import { PublicMenuView } from "./PublicMenuView";
import { useMenuAvailability } from "../../features/products/useMenuAvailability";
import { saveOrderReceipt } from "../../features/cart/order-receipt";
import { readMenuLayoutHint, rememberMenuLayoutHint } from "../../features/shops/menu-layout-hint";
import {
  useCustomerTables,
  customerTableCode,
  isPublicTableContext,
} from "../../features/shops/customer-table";

export function PublicMenuPage() {
  const { shopSlug = "", tableCode } = useParams();
  return (
    <PublicMenuSession
      key={`${shopSlug}:${tableCode ?? "browse"}`}
      shopSlug={shopSlug}
      tableCode={tableCode}
    />
  );
}
function PublicMenuSession({
  shopSlug,
  tableCode,
}: {
  shopSlug: string;
  tableCode?: string;
}) {
  const navigate = useNavigate();
  useMenuAvailability(shopSlug);
  const [code, setCode] = useState(
    () =>
      tableCode ??
      customerTableCode(useCustomerTables.getState().codes, shopSlug),
  );
  const menu = useQuery({
    queryKey: code
      ? ["public-menu", shopSlug, "table", code]
      : ["public-menu", shopSlug],
    queryFn: async ({ signal }) =>
      (
        await api.get<PublicMenuResponse>(
          `/menu/${encodeURIComponent(shopSlug)}${code ? `/table/${encodeURIComponent(code)}` : ""}`,
          { signal, timeout: 15_000 },
        )
      ).data,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: !code,
  });
  useEffect(() => {
    if (!code || !menu.isFetching) return;
    try {
      useCustomerTables.getState().beginResolution(shopSlug, code);
    } catch {
      useCustomerTables.getState().clear(shopSlug);
    }
  }, [shopSlug, code, menu.isFetching]);
  const contextMatches =
    !menu.data ||
    (menu.data.shop.slug === shopSlug &&
      (code
        ? isPublicTableContext(menu.data.table) &&
          menu.data.table.code === code &&
          menu.data.table.shopSlug === shopSlug
        : !menu.data.table));
  useEffect(() => {
    if (menu.isSuccess && !menu.isFetching && contextMatches && menu.data.table)
      useCustomerTables.getState().setResolved(menu.data.table);
    else if (
      (menu.isSuccess && !menu.isFetching && !contextMatches) ||
      (menu.isError &&
        isAxiosError(menu.error) &&
        menu.error.response?.status === 404)
    )
      useCustomerTables.getState().clear(shopSlug);
  }, [
    menu.isSuccess,
    menu.isError,
    menu.isFetching,
    menu.data,
    menu.error,
    contextMatches,
    shopSlug,
  ]);
  useEffect(() => {
    document.title = menu.data
      ? `${menu.data.shop.name} menu · PaServe`
      : "Menu · PaServe";
  }, [menu.data]);
  useEffect(() => {
    if (menu.isSuccess && contextMatches) rememberMenuLayoutHint(menu.data);
  }, [menu.isSuccess, menu.data, contextMatches]);
  if (menu.isPending)
    return (
      <MenuSkeleton {...readMenuLayoutHint(shopSlug)} />
    );
  if (menu.isError || !contextMatches)
    return (
      <main className="public-menu">
        <h1>{code ? "Table menu unavailable" : "Menu unavailable"}</h1>
        {!contextMatches ? (
          <p role="alert">{code
            ? "This table link is unavailable. Ask staff for the current QR code."
            : "This menu is unavailable. Ask the shop for its current menu link."}</p>
        ) : (
          <ErrorState error={menu.error} resource={code ? "this table menu" : "this menu"} action="load"
            publicView pending={menu.isFetching} onRetry={() => menu.refetch()} retryLabel="Try again"
            permissionMessage="This menu is unavailable. Ask the shop staff to check the link."
            unavailableMessage={code ? "This table link is unavailable. Ask staff for the current QR code." : "This menu is unavailable. Ask the shop for its current menu link."} />
        )}
        {code && (
          <button
            className="secondary-button"
            onClick={() => {
              useCustomerTables.getState().clear(shopSlug);
              setCode(undefined);
              if (tableCode)
                navigate(`/${encodeURIComponent(shopSlug)}`, { replace: true });
            }}
          >
            Browse for pickup
          </button>
        )}
      </main>
    );
  return (
    <PublicMenuView
      key={shopSlug}
      menu={menu.data}
      onOrderPlaced={(order) => {
        saveOrderReceipt(shopSlug, menu.data.shop.name, order, menu.data.shop);
        navigate(
          `/menu/${encodeURIComponent(shopSlug)}/orders/${encodeURIComponent(order.id)}`,
        );
      }}
    />
  );
}
