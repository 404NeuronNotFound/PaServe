import { Button } from "../../components/ui/button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicMenuResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { useActiveShop } from "../../features/shops/active-shop";
import { PublicMenuView } from "../public/PublicMenuView";
import { MenuSkeleton } from "../../components/feedback/LoadingSkeleton";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { IPhone17ProMax } from "../../components/preview/IPhone17ProMax";
import { AppleProDisplayXDR } from "../../components/preview/AppleProDisplayXDR";
import { DevicePreviewViewport } from "../../components/preview/DevicePreviewViewport";
import { FiSmartphone, FiMonitor, FiRefreshCw } from "react-icons/fi";
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
          <Button variant="outline" size="inherit"
            className="secondary-button"
            type="button"
            aria-pressed={width === "phone"}
            onClick={() => setWidth("phone")}
          >
            <FiSmartphone aria-hidden="true" />
            Phone
          </Button>
          <Button variant="outline" size="inherit"
            className="secondary-button"
            type="button"
            aria-pressed={width === "desktop"}
            onClick={() => setWidth("desktop")}
          >
            <FiMonitor aria-hidden="true" />
            Desktop
          </Button>
        </div>
        <Button variant="outline" size="inherit"
          className="secondary-button"
          type="button"
          disabled={menu.isFetching}
          onClick={() => void menu.refetch()}
        >
          <FiRefreshCw aria-hidden="true" />
          {menu.isFetching ? "Refreshing…" : "Refresh menu"}
        </Button>
      </div>
      <p className="field-hint" role="status">
        {unsaved
          ? "Showing your unsaved branding changes. Guests still see the saved menu."
          : "Showing the saved customer menu."}{" "}
        Menu items reflect saved changes.
      </p>
      {menu.isError ? (
        <InlineMessage>
          The menu preview is unavailable. Check your connection and shop
          access, then refresh the menu.
        </InlineMessage>
      ) : (
        <div className="menu-preview-scroll" data-width={width}>
          <DevicePreviewViewport device={width}>
            {width === "phone" ? (
              <IPhone17ProMax>
                <div className="menu-preview-canvas" data-width="phone">
                  {menu.isPending ? (
                    <MenuSkeleton
                      preview
                      label="Loading menu preview…"
                      layout={draft?.menuLayout}
                      banner={draft && "bannerUrl" in draft ? Boolean(draft.bannerUrl) : undefined}
                    />
                  ) : (
                    <PublicMenuView
                      preview
                      menu={{
                        ...menu.data,
                        shop: { ...menu.data.shop, ...draft },
                      }}
                    />
                  )}
                </div>
              </IPhone17ProMax>
            ) : (
              <AppleProDisplayXDR
                screenContent={
                  <div className="menu-preview-canvas" data-width="desktop">
                    {menu.isPending ? (
                      <MenuSkeleton
                        preview
                        label="Loading menu preview…"
                        layout={draft?.menuLayout}
                        banner={draft && "bannerUrl" in draft ? Boolean(draft.bannerUrl) : undefined}
                      />
                    ) : (
                      <PublicMenuView
                        preview
                        menu={{
                          ...menu.data,
                          shop: { ...menu.data.shop, ...draft },
                        }}
                      />
                    )}
                  </div>
                }
              />
            )}
          </DevicePreviewViewport>
        </div>
      )}
    </section>
  );
}
