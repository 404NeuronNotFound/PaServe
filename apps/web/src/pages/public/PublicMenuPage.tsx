import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { PublicMenuResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import "./public-menu.css";
import { PublicMenuView } from "./PublicMenuView";
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
  const [code] = useState(
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
          { signal },
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
  if (menu.isPending || (code && menu.isFetching))
    return (
      <main className="public-menu" role="status">
        Loading menu…
      </main>
    );
  if (menu.isError || !contextMatches)
    return (
      <main className="public-menu">
        <h1>{code ? "Table menu unavailable" : "Menu unavailable"}</h1>
        <p role="alert">
          {!contextMatches ||
          (isAxiosError(menu.error) && menu.error.response?.status === 404)
            ? code
              ? "This table link is unavailable. Ask staff for the current QR code."
              : "This menu is unavailable."
            : "We could not load this menu. Check your connection and try again."}
        </p>
        <button className="primary-button" onClick={() => void menu.refetch()}>
          Try again
        </button>
      </main>
    );
  return <PublicMenuView key={shopSlug} menu={menu.data} />;
}
