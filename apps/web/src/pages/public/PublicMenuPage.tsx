import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { PublicMenuResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import "./public-menu.css";
import { PublicMenuView } from "./PublicMenuView";

export function PublicMenuPage() {
  const { shopSlug = "" } = useParams();
  const menu = useQuery({
    queryKey: ["public-menu", shopSlug],
    queryFn: async ({ signal }) =>
      (
        await api.get<PublicMenuResponse>(
          `/menu/${encodeURIComponent(shopSlug)}`,
          { signal },
        )
      ).data,
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    document.title = menu.data
      ? `${menu.data.shop.name} menu · PaServe`
      : "Menu · PaServe";
  }, [menu.data]);
  if (menu.isPending)
    return (
      <main className="public-menu" role="status">
        Loading menu…
      </main>
    );
  if (menu.isError)
    return (
      <main className="public-menu">
        <h1>Menu unavailable</h1>
        <p role="alert">
          {isAxiosError(menu.error) && menu.error.response?.status === 404
            ? "This menu is unavailable."
            : "We could not load this menu. Check your connection and try again."}
        </p>
        <button className="primary-button" onClick={() => void menu.refetch()}>
          Try again
        </button>
      </main>
    );
  return <PublicMenuView menu={menu.data} />;
}
