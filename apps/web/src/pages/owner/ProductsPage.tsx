import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  FiCoffee,
  FiPlus,
  FiStar,
  FiImage,
  FiRefreshCw,
  FiEdit2,
  FiArchive,
  FiRotateCcw,
  FiCheckCircle,
} from "react-icons/fi";
import {
  hasShopPermission,
  type CurrentUserResponse,
  type MenuProduct,
  type ProductsResponse,
} from "@paserve/contracts";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  productsKey,
  listProducts,
  setProductArchived,
  setProductAvailable,
} from "../../features/shops/api/products";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ProductEditor } from "./ProductEditor";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { feedback } from "../../app/stores/feedback";
import "./categories.css";
import "./products.css";
import { formatProductPrice } from "../../lib/money";
import {
  categoriesKey,
  listCategories,
} from "../../features/shops/api/categories";

export function ProductsPage() {
  const membership = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return (
    <ProductWorkspace key={`${userId}:${membership.shopId}`} userId={userId} />
  );
}
function ProductWorkspace({ userId }: { userId: string }) {
  const membership = useActiveShop();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MenuProduct | null>(null);
  const [archiving, setArchiving] = useState<MenuProduct | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [availableBusy, setAvailableBusy] = useState<string | null>(null);
  const [availableError, setAvailableError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const mounted = useRef(false),
    running = useRef(false),
    editorOpen = useRef(false),
    returnFocus = useRef<string | null>(null);
  useEffect(() => {
    if (archiving || archiveBusy || availableBusy || !returnFocus.current)
      return;
    const trigger =
      document.getElementById(returnFocus.current) ??
      document.getElementById("create-product-button");
    returnFocus.current = null;
    trigger?.focus();
  }, [archiving, archiveBusy, availableBusy]);
  useEffect(() => {
    editorOpen.current = creating || Boolean(editing);
  }, [creating, editing]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function stillHere() {
    return (
      mounted.current &&
      client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
        userId
    );
  }
  function archiveMessage(error: unknown) {
    if (isAxiosError(error)) {
      if (error.response?.status === 409)
        return "Archive status changed elsewhere. Refresh products before trying again.";
      if ([401, 403, 404].includes(error.response?.status ?? 0))
        return "The product or your access changed. Refresh products to continue.";
      if (!error.response)
        return "We couldn’t confirm the change. Refresh products before trying again.";
    }
    return "We couldn’t change the archive status. Please try again.";
  }
  async function makeAvailable(product: MenuProduct) {
    if (!stillHere() || running.current || editorOpen.current) return;
    running.current = true;
    setAvailableBusy(product.id);
    setAvailableError(null);
    try {
      const result = await setProductAvailable(membership.shopId, product.id, {
        expectedStatus: product.status,
      });
      if (!stillHere()) return;
      const key = productsKey(userId, membership.shopId);
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return;
      returnFocus.current = `edit-product-${product.id}`;
      client.setQueryData<ProductsResponse>(key, (current) =>
        current
          ? {
              products: current.products.map((item) =>
                item.id === product.id ? result.product : item,
              ),
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: key });
      const category = categories.data?.categories.find(
        (item) => item.id === product.categoryId,
      );
      feedback.toast(
        category && !category.isVisible
          ? `“${result.product.name}” is available. Its category is still hidden.`
          : `“${result.product.name}” is available. Category visibility still applies.`,
      );
    } catch (error) {
      if (!stillHere()) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setAvailableError({
        id: product.id,
        message:
          status === 409
            ? "Product status changed elsewhere. Refresh products before trying again."
            : [401, 403, 404].includes(status ?? 0)
              ? "The product or your access changed. Refresh products to continue."
              : "We couldn’t confirm availability. Refresh products before trying again.",
      });
    } finally {
      running.current = false;
      if (stillHere()) setAvailableBusy(null);
    }
  }
  async function changeArchive(
    product: MenuProduct,
    isArchived: boolean,
    undo = false,
  ) {
    if (!stillHere())
      throw new Error("Return to this shop’s Products page before using Undo.");
    if (running.current || editorOpen.current)
      throw new Error("Wait for the current product action to finish.");
    running.current = true;
    setArchiveBusy(true);
    setArchiveError("");
    const key = productsKey(userId, membership.shopId);
    try {
      const result = await setProductArchived(membership.shopId, product.id, {
        isArchived,
        expectedArchived: product.isArchived,
      });
      if (!stillHere()) return;
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return;
      client.setQueryData<ProductsResponse>(key, (current) =>
        current
          ? {
              products: current.products.map((item) =>
                item.id === result.product.id ? result.product : item,
              ),
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: key });
      if (undo || !isArchived)
        feedback.toast(`“${result.product.name}” was restored.`);
      else
        feedback.snackbar(
          `“${result.product.name}” was archived.`,
          {
            label: "Undo",
            onClick: () => changeArchive(result.product, false, true),
            errorMessage: (error) =>
              error instanceof Error ? error.message : archiveMessage(error),
          },
          {
            key: `product-archive:${userId}:${membership.shopId}:${product.id}`,
          },
        );
    } catch (error) {
      if (!stillHere()) return;
      throw new Error(archiveMessage(error), { cause: error });
    } finally {
      running.current = false;
      if (stillHere()) setArchiveBusy(false);
    }
  }
  const allowed = hasShopPermission(membership.role, "shop.menu.manage");
  const categories = useQuery({
    queryKey: categoriesKey(userId, membership.shopId),
    queryFn: ({ signal }) => listCategories(membership.shopId, signal),
    enabled: allowed,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const query = useQuery({
    queryKey: productsKey(userId, membership.shopId),
    queryFn: ({ signal }) => listProducts(membership.shopId, signal),
    enabled: allowed,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    document.title = `Products · ${membership.shop.name} · PaServe`;
  }, [membership.shop.name]);
  if (!allowed)
    return (
      <section className="dashboard-status">
        <h1>Products</h1>
        <InlineMessage>
          You don’t have permission to manage products in this shop.
        </InlineMessage>
      </section>
    );
  const denied =
    isAxiosError(query.error) &&
    [401, 403, 404].includes(query.error.response?.status ?? 0);
  return (
    <section className="products-page" aria-labelledby="products-title">
      <header className="products-heading">
        <div>
          <p className="section-label">THE HEART OF YOUR MENU</p>
          <h1 id="products-title">Products</h1>
          <p>Favorites worth coming back for, at {membership.shop.name}.</p>
        </div>
        <button
          id="create-product-button"
          className="primary-button"
          type="button"
          disabled={
            creating ||
            Boolean(editing) ||
            Boolean(archiving) ||
            archiveBusy ||
            Boolean(availableBusy) ||
            denied
          }
          onClick={() => setCreating(true)}
        >
          <FiPlus aria-hidden="true" />
          Create product
        </button>
      </header>
      <section className="products-panel" aria-labelledby="products-list-title">
        <div className="categories-toolbar">
          <div className="categories-panel-heading">
            <h2 id="products-list-title">Your products</h2>
            {query.isSuccess && <span>{query.data.products.length}</span>}
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={
              query.isFetching ||
              denied ||
              creating ||
              Boolean(editing) ||
              Boolean(archiving) ||
              archiveBusy ||
              Boolean(availableBusy)
            }
            onClick={() => void query.refetch()}
          >
            <FiRefreshCw aria-hidden="true" />
            {query.isFetching ? "Refreshing…" : "Refresh products"}
          </button>
        </div>
        {query.isSuccess &&
          query.data.products.some((product) => product.isArchived) && (
            <label className="product-featured-field">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show archived products (
              {
                query.data.products.filter((product) => product.isArchived)
                  .length
              }
              )
            </label>
          )}
        {archiveError && <InlineMessage>{archiveError}</InlineMessage>}
        {query.isPending ? (
          <InlineMessage tone="info">Loading products…</InlineMessage>
        ) : query.isError ? (
          <InlineMessage>
            {denied
              ? "Your product access is unavailable. Choose another shop or sign in again."
              : "We couldn’t load products. Check your connection and try refreshing."}
          </InlineMessage>
        ) : query.data.products.length ? (
          <ul className="products-list">
            {query.data.products
              .filter((product) => showArchived || !product.isArchived)
              .map((product) => (
                <li key={product.id}>
                  <span className="product-emblem">
                    <FiCoffee aria-hidden="true" />
                    {product.imageUrl && (
                      <img
                        src={product.imageUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    )}
                  </span>
                  <div className="product-card-details">
                    <div className="product-card-title">
                      <h3>{product.name}</h3>
                      {product.isFeatured && (
                        <span className="product-featured-badge">
                          <FiStar aria-hidden="true" />
                          Featured
                        </span>
                      )}
                    </div>
                    {!product.isArchived && product.status === "AVAILABLE" && (
                      <p className="field-hint">
                        {!product.categoryId
                          ? "Shown on the menu · Available to order"
                          : categories.data?.categories.find(
                                (item) => item.id === product.categoryId,
                              )?.isVisible === true
                            ? "Shown on the menu · Available to order"
                            : categories.data?.categories.find(
                                  (item) => item.id === product.categoryId,
                                )?.isVisible === false
                              ? "Category hidden · Not shown on the menu"
                              : "Availability follows category visibility"}
                      </p>
                    )}
                    {availableError?.id === product.id && (
                      <InlineMessage>{availableError.message}</InlineMessage>
                    )}
                    <small>/{product.slug}</small>
                    {product.description && <p>{product.description}</p>}
                    <div className="product-card-meta">
                      <span className="category-visibility">
                        {product.isArchived
                          ? "Archived"
                          : product.status === "AVAILABLE"
                            ? "Available"
                            : product.status === "SOLD_OUT"
                              ? "Sold out"
                              : "Hidden"}
                      </span>
                      {product.isArchived && (
                        <span>
                          Previous status:{" "}
                          {product.status === "AVAILABLE"
                            ? "Available"
                            : product.status === "SOLD_OUT"
                              ? "Sold out"
                              : "Hidden"}
                        </span>
                      )}
                      {!product.categoryId && <span>Uncategorized</span>}
                      {product.imageUrl && (
                        <span>
                          <FiImage aria-hidden="true" />
                          Image linked
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="product-card-actions">
                    <strong className="product-price">
                      {formatProductPrice(product.price)}
                    </strong>
                    {!product.isArchived && product.status !== "AVAILABLE" && (
                      <button
                        className="secondary-button"
                        type="button"
                        aria-label={`Make ${product.name} available`}
                        disabled={
                          creating ||
                          Boolean(editing) ||
                          Boolean(archiving) ||
                          archiveBusy ||
                          Boolean(availableBusy) ||
                          denied
                        }
                        onClick={() => void makeAvailable(product)}
                      >
                        <FiCheckCircle aria-hidden="true" />
                        {availableBusy === product.id
                          ? "Updating…"
                          : "Make available"}
                      </button>
                    )}
                    {!product.isArchived && (
                      <button
                        id={`edit-product-${product.id}`}
                        className="secondary-button"
                        type="button"
                        aria-label={`Edit ${product.name}`}
                        disabled={
                          creating ||
                          Boolean(editing) ||
                          Boolean(archiving) ||
                          archiveBusy ||
                          Boolean(availableBusy) ||
                          denied
                        }
                        onClick={() => setEditing(product)}
                      >
                        <FiEdit2 aria-hidden="true" />
                        Edit
                      </button>
                    )}
                    <button
                      id={`archive-product-${product.id}`}
                      className="secondary-button"
                      type="button"
                      aria-label={`${product.isArchived ? "Restore" : "Archive"} ${product.name}`}
                      disabled={
                        creating ||
                        Boolean(editing) ||
                        Boolean(archiving) ||
                        archiveBusy ||
                        Boolean(availableBusy) ||
                        denied
                      }
                      onClick={() =>
                        product.isArchived
                          ? void changeArchive(product, false).catch(
                              (error) => {
                                if (stillHere()) setArchiveError(error.message);
                              },
                            )
                          : setArchiving(product)
                      }
                    >
                      {product.isArchived ? (
                        <FiRotateCcw aria-hidden="true" />
                      ) : (
                        <FiArchive aria-hidden="true" />
                      )}
                      {product.isArchived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        ) : (
          <div className="categories-empty">
            <FiCoffee aria-hidden="true" />
            <h3>Start with a favorite.</h3>
            <p>Create your first product to bring this menu to life.</p>
          </div>
        )}
      </section>
      {query.isSuccess &&
        query.data.products.length > 0 &&
        !showArchived &&
        query.data.products.every((product) => product.isArchived) && (
          <InlineMessage tone="info">
            All products are archived. Show archived products to restore one.
          </InlineMessage>
        )}
      <DecisionDialog
        open={Boolean(archiving)}
        title={`Archive ${archiving?.name ?? "product"}?`}
        description="Removed from your public menu. Product details stay saved, and you can restore it later."
        confirmLabel="Archive product"
        cancelLabel="Keep product"
        animateClose
        onConfirm={async () => {
          if (archiving) await changeArchive(archiving, true);
        }}
        onClose={() => {
          returnFocus.current = `archive-product-${archiving?.id}`;
          setArchiving(null);
        }}
        errorMessage={(error) =>
          error instanceof Error ? error.message : archiveMessage(error)
        }
      />
      {(creating || editing) && (
        <ProductEditor
          userId={userId}
          shopId={membership.shopId}
          product={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
