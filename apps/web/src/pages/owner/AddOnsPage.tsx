import { RefreshButton } from "../../components/feedback/RefreshButton";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { ListSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { shopPath } from "../../features/shops/active-shop";
import { FiPlus, FiEdit2, FiArrowRight } from "react-icons/fi";
import type { AddOn } from "@paserve/contracts";
import {
  customizationKey,
  listAddOns,
  saveAddOn,
  deleteAddOn,
} from "../../features/shops/api/customization";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { CustomizationEditor } from "./CustomizationEditor";
import { useCustomizationAccess } from "./useCustomizationAccess";
import { formatProductPrice } from "../../lib/money";
import "./customization.css";

export function AddOnsPage() {
  const access = useCustomizationAccess();
  return <AddOnLibrary key={`${access.userId}:${access.membership.shopId}`} />;
}
function AddOnLibrary() {
  const access = useCustomizationAccess();
  const { membership, userId, allowed, busy, blocked, error } = access;
  const [editor, setEditor] = useState<AddOn | "new" | null>(null),
    [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const createAddOn = useRef<HTMLButtonElement>(null);
  const deleted = useRef(false);
  useEffect(() => {
    if (deleted.current && !editor && !busy) {
      deleted.current = false;
      createAddOn.current?.focus();
    }
  }, [editor, busy]);
  const query = useQuery({
    queryKey: customizationKey(userId, membership.shopId),
    queryFn: ({ signal }) => listAddOns(membership.shopId, signal),
    enabled: allowed,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const locked =
    busy || refreshing || blocked || query.isFetching || query.isError;
  async function refresh() {
    if (busy || refreshing) return;
    setRefreshing(true);
    const result = await query.refetch();
    if (result.isSuccess) {
      access.recovered();
      setEditor(null);
    }
    setRefreshing(false);
  }
  if (!allowed)
    return (
      <section>
        <h1>Add-ons</h1>
        <InlineMessage>
          You don't have permission to manage customization in this shop.
        </InlineMessage>
      </section>
    );
  const rows =
    query.data?.addOns.filter((item) =>
      item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  return (
    <section
      className="customization-page addon-library"
      aria-labelledby="addons-title"
    >
      <header className="customization-heading refresh-heading">
        <div>
          <p className="section-label">YOUR MENU, YOUR EXTRAS</p>
          <h1 id="addons-title">Shop add-ons</h1>
        </div>
        <div className="customization-actions refresh-heading-actions">
          <RefreshButton label="Refresh add-ons"
            pending={refreshing || query.isFetching}
            pendingLabel="Refreshing add-ons..."
            title="Refresh add-ons"
            disabled={busy || refreshing || query.isFetching || Boolean(editor)}
            onClick={() => void refresh()}
          />
          <Button variant="default" size="inherit" type="submit"
            className="primary-button addon-create-fab"
            ref={createAddOn}
            disabled={locked || query.isPending || Boolean(editor)}
            onClick={() => {
              access.clearError();
              setEditor("new");
            }}
          >
            <span className="addon-create-icon" aria-hidden="true">
              <FiPlus />
            </span>
            <span>Create add-on</span>
          </Button>
        </div>
        <p className="refresh-heading-description">Create once. Offer on any product.</p>
      </header>
      {error && !editor && <InlineMessage>{error}</InlineMessage>}
      {query.isError && (
        <InlineMessage>
          Unable to load this shop's add-ons. Refresh to verify access and
          current data.
        </InlineMessage>
      )}
      {query.isPending && <ListSkeleton label="Loading add-ons..." />}
      {query.isSuccess && (
        <section
          className="customization-panel addon-library-panel"
          aria-label="Add-on library"
        >
          <div className="addon-library-toolbar">
            <div className="field">
              <label htmlFor="addon-search">Search add-ons</label>
              <Input
                id="addon-search"
                type="search"
                placeholder="Find an extra…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <p role="status" className="field-hint">
              {rows.length} {rows.length === 1 ? "add-on" : "add-ons"}
              {search && ` of ${query.data.addOns.length}`}
            </p>
          </div>
          <ul className="customization-list">
            {rows.map((item) => (
              <li className="addon-library-row" key={item.id}>
                <div className="addon-library-info">
                  <div className="addon-library-name">
                    <strong>{item.name}</strong>
                    {!item.isAvailable && (
                      <span className="customization-badge">Hidden</span>
                    )}
                  </div>
                  {item.assignedProducts && (
                    <div className="addon-library-products">
                      {item.assignedProducts.length ? (
                        <>
                          <span className="addon-library-used">Used on</span>
                          {item.assignedProducts.slice(0, 3).map((product) =>
                            product.isArchived ? (
                              <span
                                className="addon-product-archived"
                                key={product.id}
                              >
                                {product.name} · archived
                              </span>
                            ) : (
                              <Link
                                key={product.id}
                                to={`${shopPath(membership.shopId)}/products/${encodeURIComponent(product.id)}/customize?section=addons`}
                                aria-label={`Manage ${item.name} on ${product.name}`}
                              >
                                {product.name}
                                <FiArrowRight aria-hidden="true" />
                              </Link>
                            ),
                          )}
                          {item.assignedProducts.length > 3 && (
                            <details className="addon-more-products">
                              <summary>
                                +{item.assignedProducts.length - 3} more
                              </summary>
                              <div>
                                {item.assignedProducts
                                  .slice(3)
                                  .map((product) =>
                                    product.isArchived ? (
                                      <span
                                        className="addon-product-archived"
                                        key={product.id}
                                      >
                                        {product.name} · archived
                                      </span>
                                    ) : (
                                      <Link
                                        key={product.id}
                                        to={`${shopPath(membership.shopId)}/products/${encodeURIComponent(product.id)}/customize?section=addons`}
                                        aria-label={`Manage ${item.name} on ${product.name}`}
                                      >
                                        {product.name}
                                        <FiArrowRight aria-hidden="true" />
                                      </Link>
                                    ),
                                  )}
                              </div>
                            </details>
                          )}
                        </>
                      ) : (
                        <span className="field-hint">Not on your menu yet</span>
                      )}
                    </div>
                  )}
                </div>
                <span className="addon-library-price">
                  {Number(item.priceAdjustment) === 0
                    ? "Free"
                    : `+${formatProductPrice(item.priceAdjustment)}`}
                </span>
                <Button variant="ghost" size="inherit" type="submit"
                  className="customization-icon-button"
                  disabled={locked || Boolean(editor)}
                  aria-label={`Edit ${item.name}`}
                  title={`Edit ${item.name}`}
                  onClick={() => {
                    access.clearError();
                    setEditor(item);
                  }}
                >
                  <FiEdit2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          {!rows.length && (
            <div className="addon-library-empty">
              <h2>
                {search ? "No matching extras" : "Your extras start here."}
              </h2>
              <p>
                {search
                  ? "Try another name or clear your search."
                  : "Create an extra, then choose the products that offer it."}
              </p>
              {search && (
                <Button variant="ghost" size="inherit" type="submit"
                  className="customization-text-button"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      <div className="addon-library-footer">
        <Link
          className="customization-back"
          to={`${shopPath(membership.shopId)}/products`}
        >
          Choose products <FiArrowRight aria-hidden="true" />
        </Link>
        <details className="customization-more addon-library-help">
          <summary>How add-ons work</summary>
          <p>
            Create an extra here, then enable it on a product's Customize page.
            Enter 0 for a free request such as No Onions. Editing or deleting a
            shared add-on affects every product using it.
          </p>
        </details>
      </div>
      {editor && (
        <CustomizationEditor
          kind="addon"
          record={editor === "new" ? undefined : editor}
          busy={busy}
          blocked={blocked}
          error={error}
          onClose={() => setEditor(null)}
          onDelete={
            editor !== "new"
              ? async () => {
                  await access.run(
                    () => deleteAddOn(membership.shopId, editor.id),
                    `${editor.name} deleted from the shop and all products.`,
                    () => {
                      deleted.current = true;
                      setEditor(null);
                    },
                  );
                }
              : undefined
          }
          onSave={(values) =>
            access.run(
              () =>
                saveAddOn(
                  membership.shopId,
                  {
                    name: values.name,
                    priceAdjustment: values.priceAdjustment,
                    isAvailable: values.isAvailable,
                    sortOrder: values.sortOrder,
                  },
                  editor === "new" ? undefined : editor.id,
                ),
              editor === "new"
                ? "Add-on created. Choose a product to offer it on your menu."
                : "Add-on changes saved for all products using it.",
              () => setEditor(null),
            )
          }
        />
      )}
      {blocked && editor && (
        <p role="status">Close the editor and refresh before continuing.</p>
      )}
    </section>
  );
}
