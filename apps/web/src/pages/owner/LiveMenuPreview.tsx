import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicMenuResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { useActiveShop } from "../../features/shops/active-shop";
import { PublicMenuView } from "../public/PublicMenuView";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "./menu-preview.css";

export function LiveMenuPreview({
  draft,
  unsaved = false,
}: {
  draft?: Partial<PublicMenuResponse["shop"]>;
  unsaved?: boolean;
}) {
  const membership = useActiveShop();
  const [width, setWidth] = useState<"phone" | "desktop">("phone");
  const menu = useQuery({
    queryKey: ["public-menu", membership.shop.slug],
    queryFn: async ({ signal }) =>
      (
        await api.get<PublicMenuResponse>(
          `/menu/${encodeURIComponent(membership.shop.slug)}`,
          { signal },
        )
      ).data,
    enabled: membership.role === "OWNER",
    retry: false,
    staleTime: 0,
    refetchInterval: 15000,
  });
  if (membership.role !== "OWNER")
    return (
      <InlineMessage>
        Only this shop’s owner can preview its menu here.
      </InlineMessage>
    );
  return (
    <section className="live-menu-preview" aria-label="Customer menu preview">
      <div className="menu-preview-toolbar">
        <div role="group" aria-label="Preview width">
          <button
            className="secondary-button"
            type="button"
            aria-pressed={width === "phone"}
            onClick={() => setWidth("phone")}
          >
            Phone
          </button>
          <button
            className="secondary-button"
            type="button"
            aria-pressed={width === "desktop"}
            onClick={() => setWidth("desktop")}
          >
            Desktop
          </button>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={menu.isFetching}
          onClick={() => void menu.refetch()}
        >
          {menu.isFetching ? "Refreshing…" : "Refresh menu"}
        </button>
      </div>
      <p className="field-hint" role="status">
        {unsaved
          ? "Showing your unsaved branding changes. Guests still see the saved menu."
          : "Showing the saved customer menu."}{" "}
        Menu items reflect saved changes.
      </p>
      {menu.isPending ? (
        <p role="status">Loading menu preview…</p>
      ) : menu.isError ? (
        <InlineMessage>
          The menu preview is unavailable. Check your connection and shop
          access, then refresh the menu.
        </InlineMessage>
      ) : (
        <div className="menu-preview-scroll" data-width={width}>
          <div className="menu-preview-canvas" data-width={width}>
            <PublicMenuView
              preview
              menu={{ ...menu.data, shop: { ...menu.data.shop, ...draft } }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
