import { PendingButton } from "../../components/feedback/PendingButton";
import { EmptyState } from "../../components/feedback/EmptyState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { ProductsSkeleton } from "../../components/feedback/LoadingSkeleton";
import { SelectField } from "../../components/forms/SelectField";
import { useNavigate } from "react-router-dom";
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
  FiSlash,
  FiEyeOff,
  FiLayers,
  FiMove,
  FiSearch,
  FiChevronLeft,
  FiChevronRight,
  FiSliders,
} from "react-icons/fi";
import {
  hasShopPermission,
  PRODUCT_REORDER_MAX,
  type CurrentUserResponse,
  type MenuProduct,
  type ProductsResponse,
  type PublicMenuResponse,
} from "@paserve/contracts";
import { useActiveShop, shopPath } from "../../features/shops/active-shop";
import { withProductOrder } from "../../features/shops/product-menu-order";
import {
  withFeaturedOrder,
  withFeaturedSelection,
} from "../../features/shops/featured-menu";
import { currentUserKey } from "../../features/auth/api/session";
import {
  productsKey,
  listProducts,
  setProductArchived,
  setProductAvailable,
  setProductSoldOut,
  setProductHidden,
  setProductFeatured,
  reorderProducts,
  reorderFeaturedProducts,
} from "../../features/shops/api/products";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ProductActionsMenu } from "./ProductActionsMenu";
import { ProductOrderEditor } from "./ProductOrderEditor";
import { ProductEditor } from "./ProductEditor";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { feedback } from "../../app/stores/feedback";
import "./categories.css";
import "./products.css";
import "./customization.css";
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
  const navigate = useNavigate();
  const [createdProduct, setCreatedProduct] = useState<MenuProduct | null>(
    null,
  );
  const membership = useActiveShop();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [initialCategoryId, setInitialCategoryId] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [featuredOrdering, setFeaturedOrdering] = useState(false);
  const [orderCategory, setOrderCategory] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MenuProduct | null>(null);
  const [archiving, setArchiving] = useState<MenuProduct | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [availableBusy, setAvailableBusy] = useState<string | null>(null);
  const verificationRequired = useRef(false);
  const [unverified, setUnverified] = useState(false);
  const [productPreview, setProductPreview] = useState<{
    id: string;
    status?: MenuProduct["status"];
    isFeatured?: boolean;
  } | null>(null);
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
      document.getElementById(
        showArchived ? "product-view-archived" : "product-view-active",
      ) ??
      document.getElementById("create-product-button");
    returnFocus.current = null;
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }, [archiving, archiveBusy, availableBusy, showArchived]);
  useEffect(() => {
    editorOpen.current = creating || Boolean(editing) || ordering;
  }, [creating, editing, ordering]);
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
  async function refreshProducts() {
    const key = productsKey(userId, membership.shopId);
    try {
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return false;
      let readFinished = false;
      let readSignal: AbortSignal | undefined;
      await client.fetchQuery({
        queryKey: key,
        queryFn: async ({ signal }) => {
          readSignal = signal;
          const saved = await listProducts(membership.shopId, signal);
          readFinished = !signal.aborted;
          return saved;
        },
        staleTime: 0,
        retry: false,
        networkMode: "always",
      });
      if (!stillHere() || !readFinished || readSignal?.aborted) return false;
      verificationRequired.current = false;
      setUnverified(false);
      setAvailableError(null);
      return true;
    } catch {
      return false;
    }
  }
  async function reconcileProduct() {
    verificationRequired.current = true;
    setUnverified(true);
    setProductPreview(null);
    void client.invalidateQueries({
      queryKey: ["public-menu", membership.shop.slug],
    });
    return refreshProducts();
  }
  async function changeAvailability(
    product: MenuProduct,
    targetStatus: "AVAILABLE" | "SOLD_OUT" | "HIDDEN" = "AVAILABLE",
  ) {
    if (
      !stillHere() || running.current || editorOpen.current ||
      verificationRequired.current
    ) return;
    running.current = true;
    setAvailableBusy(product.id);
    setAvailableError(null);
    returnFocus.current = `edit-product-${product.id}`;
    setProductPreview({ id: product.id, status: targetStatus });
    try {
      const write =
        targetStatus === "HIDDEN"
          ? setProductHidden
          : targetStatus === "SOLD_OUT"
            ? setProductSoldOut
            : setProductAvailable;
      const result = await write(membership.shopId, product.id, {
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
      void client.invalidateQueries({
        queryKey: ["public-menu", membership.shop.slug],
      });
      const category = categories.data?.categories.find(
        (item) => item.id === product.categoryId,
      );
      feedback.toast(
        targetStatus === "HIDDEN"
          ? `${result.product.name} is hidden from the menu.`
          : targetStatus === "SOLD_OUT"
            ? `“${result.product.name}” is sold out.${category && !category.isVisible ? " Its category is still hidden." : ""}`
            : category && !category.isVisible
              ? `“${result.product.name}” is available. Its category is still hidden.`
              : `“${result.product.name}” is available. Category visibility still applies.`,
      );
    } catch (error) {
      if (!stillHere()) return;
      const refreshed = await reconcileProduct();
      if (!stillHere()) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setAvailableError({
        id: product.id,
        message:
          "The status preview was reverted. " +
          (status === 409
            ? "Product status changed elsewhere."
            : [401, 403, 404].includes(status ?? 0)
              ? "The product or your access changed."
              : "We couldn’t confirm availability.") +
          (refreshed ? " Latest saved products are now loaded." : " Saved status is unverified. Refresh products to unlock changes."),
      });
    } finally {
      running.current = false;
      if (stillHere()) {
        setProductPreview(null);
        setAvailableBusy(null);
      }
    }
  }
  async function changeFeatured(product: MenuProduct) {
    if (
      !stillHere() || running.current || editorOpen.current ||
      verificationRequired.current
    ) return;
    running.current = true;
    setAvailableBusy(product.id);
    setAvailableError(null);
    returnFocus.current = `more-product-${product.id}`;
    setProductPreview({ id: product.id, isFeatured: !product.isFeatured });
    try {
      const result = await setProductFeatured(membership.shopId, product.id, {
        isFeatured: !product.isFeatured,
        expectedFeatured: product.isFeatured,
      });
      if (!stillHere()) return;
      const key = productsKey(userId, membership.shopId);
      const publicKey = ["public-menu", membership.shop.slug];
      await Promise.all([
        client.cancelQueries({ queryKey: key }),
        client.cancelQueries({ queryKey: publicKey }),
      ]);
      if (!stillHere()) return;
      returnFocus.current = `more-product-${product.id}`;
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
      client.setQueryData<PublicMenuResponse>(publicKey, (current) =>
        current ? withFeaturedSelection(current, result.product) : current,
      );
      void client.invalidateQueries({ queryKey: publicKey });
      feedback.toast(
        result.product.isFeatured
          ? `${result.product.name} is featured. Menu visibility still applies.`
          : `${result.product.name} was removed from featured.`,
      );
    } catch (error) {
      if (!stillHere()) return;
      const refreshed = await reconcileProduct();
      if (!stillHere()) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setAvailableError({
        id: product.id,
        message:
          "The featured preview was reverted. " +
          (status === 409
            ? "Featured selection changed elsewhere."
            : [401, 403, 404].includes(status ?? 0)
              ? "The product or your access changed."
              : "We couldn’t confirm the featured change.") +
          (refreshed ? " Latest saved products are now loaded." : " Saved featured selection is unverified. Refresh products to unlock changes."),
      });
    } finally {
      running.current = false;
      if (stillHere()) {
        setProductPreview(null);
        setAvailableBusy(null);
      }
    }
  }
  async function saveOrder(productIds: string[], expectedOrder: string[]) {
    if (!stillHere()) return false;
    if (verificationRequired.current)
      throw new Error("Refresh products before changing their order.");
    if (running.current)
      throw new Error("Wait for the current action to finish.");
    running.current = true;
    try {
      const result = featuredOrdering
        ? await reorderFeaturedProducts(membership.shopId, {
            productIds,
            expectedOrder,
          })
        : await reorderProducts(membership.shopId, {
            categoryId: orderCategory || null,
            productIds,
            expectedOrder,
          });
      if (!stillHere()) return false;
      const key = productsKey(userId, membership.shopId);
      const publicKey = ["public-menu", membership.shop.slug];
      await Promise.all([
        client.cancelQueries({ queryKey: key }),
        client.cancelQueries({ queryKey: publicKey }),
      ]);
      if (!stillHere()) return false;
      const changed = new Map(result.products.map((item) => [item.id, item]));
      client.setQueryData<ProductsResponse>(key, (current) =>
        current
          ? {
              products: current.products
                .map((item) => changed.get(item.id) ?? item)
                .sort(
                  (a, b) =>
                    a.sortOrder - b.sortOrder ||
                    a.createdAt.localeCompare(b.createdAt) ||
                    a.id.localeCompare(b.id),
                ),
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: key });
      client.setQueryData<PublicMenuResponse>(publicKey, (current) =>
        current
          ? featuredOrdering
            ? withFeaturedOrder(current, result.products)
            : withProductOrder(current, orderCategory || null, result.products)
          : current,
      );
      void client.invalidateQueries({ queryKey: publicKey });
      feedback.toast(
        featuredOrdering ? "Featured order saved." : "Product order saved.",
      );
      return true;
    } catch (error) {
      if (!stillHere()) return false;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      throw new Error(
        status === 409
          ? "Products or their order changed. Cancel and refresh before saving again."
          : [401, 403, 404].includes(status ?? 0)
            ? "Your access or this product group changed. Cancel and refresh products."
            : "We couldn't confirm the saved order. Cancel and refresh before trying again.",
        { cause: error },
      );
    } finally {
      running.current = false;
    }
  }
  async function changeArchive(
    product: MenuProduct,
    isArchived: boolean,
    undo = false,
  ) {
    if (!stillHere())
      throw new Error("Return to this shop’s Products page before using Undo.");
    if (verificationRequired.current)
      throw new Error("Refresh products before changing archive status.");
    if (running.current || editorOpen.current)
      throw new Error("Wait for the current product action to finish.");
    running.current = true;
    setArchiveBusy(true);
    setArchiveTarget(product.id);
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
      if (!isArchived) returnFocus.current = `archive-product-${product.id}`;
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
      void client.invalidateQueries({
        queryKey: ["public-menu", membership.shop.slug],
      });
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
    unverified ||
    (isAxiosError(query.error) &&
      [401, 403, 404].includes(query.error.response?.status ?? 0));
  // Keep previews local: rollback reveals the latest server cache, and an
  // unfinished request cannot leak into another shop or a customer menu.
  const visibleProducts =
    query.data?.products
      .map((product) =>
        product.id === productPreview?.id
          ? { ...product, ...productPreview }
          : product,
      )
      .filter((product) => product.isArchived === showArchived) ?? [];
  const knownCategories = categories.data?.categories ?? [];
  const groupDefinitions = [
    ...knownCategories.map((category) => ({
      key: category.id,
      categoryId: category.id as string | null,
      name: category.name,
      hidden: !category.isVisible,
      unavailable: false,
    })),
    ...[
      ...new Set(
        visibleProducts
          .map((product) => product.categoryId)
          .filter(
            (id): id is string =>
              Boolean(id) &&
              !knownCategories.some((category) => category.id === id),
          ),
      ),
    ].map((id) => ({
      key: id,
      categoryId: id as string | null,
      name: "Category unavailable",
      hidden: false,
      unavailable: true,
    })),
    {
      key: "uncategorized",
      categoryId: null,
      name: "Uncategorized",
      hidden: false,
      unavailable: false,
    },
  ];
  const allGroups = groupDefinitions
    .map((group) => ({
      ...group,
      products: visibleProducts.filter(
        (product) => product.categoryId === group.categoryId,
      ),
    }))
    .filter((group) => group.products.length > 0);
  const term = search.trim().toLocaleLowerCase();
  const filteredProducts = allGroups.flatMap((group) =>
    group.products.filter(
      (product) =>
        (!categoryFilter || group.key === categoryFilter) &&
        (!statusFilter ||
          product.status === statusFilter ||
          // Keep the pending row in its current result scope until confirmed.
          (product.id === productPreview?.id &&
            query.data?.products.find((item) => item.id === product.id)?.status ===
              statusFilter)) &&
        (!term ||
          [
            product.name,
            product.slug,
            product.description ?? "",
            group.name,
          ].some((value) => value.toLocaleLowerCase().includes(term))),
    ),
  );
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageProducts = filteredProducts.slice(start, start + pageSize);
  const groups = allGroups
    .map((group) => ({
      ...group,
      totalCount: group.products.length,
      activeCount:
        query.data?.products.filter(
          (product) =>
            !product.isArchived && product.categoryId === group.categoryId,
        ).length ?? 0,
      products: pageProducts.filter(
        (product) => product.categoryId === group.categoryId,
      ),
    }))
    .filter((group) => group.products.length > 0);
  const hasFilters = Boolean(search || categoryFilter || statusFilter);
  const featuredProducts = (query.data?.products ?? [])
    .filter((item) => item.isFeatured && !item.isArchived)
    .sort(
      (a, b) =>
        (a.featuredSortOrder ?? a.sortOrder) -
          (b.featuredSortOrder ?? b.sortOrder) || a.id.localeCompare(b.id),
    );
  const browsingLocked =
    unverified ||
    creating ||
    Boolean(editing) ||
    ordering ||
    Boolean(archiving) ||
    archiveBusy ||
    Boolean(availableBusy);
  function changePage(nextPage: number) {
    setPage(nextPage);
    const heading = document.getElementById("products-list-title");
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus({ preventScroll: true });
  }
  function clearFilters() {
    setSearch("");
    setCategoryFilter("");
    setStatusFilter("");
    setPage(1);
  }
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
          className="primary-button product-create-fab"
          type="button"
          disabled={
            creating ||
            Boolean(editing) ||
            ordering ||
            Boolean(archiving) ||
            archiveBusy ||
            Boolean(availableBusy) ||
            denied
          }
          onClick={() => { setInitialCategoryId(""); setCreating(true); }}
        >
          <span className="product-create-icon" aria-hidden="true">
            <FiPlus />
          </span>
          <span>Create product</span>
        </button>
      </header>
      {query.isSuccess && !denied && (
        <div
          className="product-view-switch"
          role="group"
          aria-label="Product view"
        >
          {[false, true].map((archived) => (
            <button
              key={String(archived)}
              id={archived ? "product-view-archived" : "product-view-active"}
              type="button"
              className="product-view-button"
              aria-pressed={showArchived === archived}
              disabled={browsingLocked}
              onClick={() => {
                setShowArchived(archived);
                clearFilters();
              }}
            >
              {archived ? (
                <FiArchive aria-hidden="true" />
              ) : (
                <FiCoffee aria-hidden="true" />
              )}
              {archived ? "Archived products" : "Active products"}
              <span>
                {
                  query.data.products.filter(
                    (item) => item.isArchived === archived,
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
      )}
      <section className="products-panel" aria-labelledby="products-list-title">
        <div className="categories-toolbar">
          <div className="categories-panel-heading">
            <h2 id="products-list-title" tabIndex={-1}>
              {showArchived ? "Saved for later" : "Your menu"}
            </h2>
            {showArchived && (
              <p className="product-archive-hint">
                Off the menu. Details kept. Restore whenever you're ready.
              </p>
            )}
          </div>
          <PendingButton
            pending={query.isFetching}
            pendingLabel="Refreshing products"
            iconOnly
            className="secondary-button product-refresh-button"
            title="Refresh products"
            type="button"
            disabled={
              query.isFetching ||
              (denied && !unverified) ||
              creating ||
              Boolean(editing) ||
              ordering ||
              Boolean(archiving) ||
              archiveBusy ||
              Boolean(availableBusy)
            }
            onClick={() => void refreshProducts()}
          >
            <FiRefreshCw aria-hidden="true" />
            <span className="sr-only">
              {query.isFetching ? "Refreshing products" : "Refresh products"}
            </span>
          </PendingButton>
        </div>
        {query.isSuccess &&
          !denied &&
          !showArchived &&
          featuredProducts.length > 0 && (
            <div className="featured-order-toolbar">
              <div>
                <strong>
                  <FiStar aria-hidden="true" /> Featured items ·{" "}
                  {featuredProducts.length}
                </strong>
                <p>Arrange your menu highlights. Hidden items stay hidden.</p>
              </div>
              <button
                id="reorder-featured-items"
                className="secondary-button"
                type="button"
                disabled={
                  browsingLocked ||
                  query.isFetching ||
                  featuredProducts.length < 2 ||
                  featuredProducts.length > PRODUCT_REORDER_MAX
                }
                title={
                  featuredProducts.length > PRODUCT_REORDER_MAX
                    ? `Reordering supports up to ${PRODUCT_REORDER_MAX} featured items.`
                    : undefined
                }
                onClick={() => {
                  setFeaturedOrdering(true);
                  setOrdering(true);
                }}
              >
                <FiMove aria-hidden="true" /> Reorder featured items
              </button>
            </div>
          )}
        {query.isSuccess && !unverified && query.data.products.length > 0 && (
          <div className="product-browse-controls">
            <div className="product-filter-fields">
              <div className="field product-search-field">
                <label htmlFor="product-search">Find a product</label>
                <div className="product-search-input">
                  <FiSearch aria-hidden="true" />
                  <input
                    id="product-search"
                    type="search"
                    placeholder="Search name, category or description"
                    value={search}
                    disabled={browsingLocked}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="product-category-filter">Category</label>
                <SelectField
                  id="product-category-filter"
                  label="Category"
                  value={categoryFilter}
                  disabled={browsingLocked}
                  onChange={(value) => {
                    setCategoryFilter(value);
                    setPage(1);
                  }}
                  options={[
                    { value: "", label: "All categories" },
                    ...allGroups.map((group) => ({
                      value: group.key,
                      label: group.name,
                    })),
                  ]}
                />
              </div>
              <div className="field">
                <label htmlFor="product-status-filter">Status</label>
                <SelectField
                  id="product-status-filter"
                  label="Status"
                  value={statusFilter}
                  disabled={browsingLocked}
                  onChange={(value) => {
                    setStatusFilter(value);
                    setPage(1);
                  }}
                  options={[
                    { value: "", label: "All statuses" },
                    { value: "AVAILABLE", label: "Available" },
                    { value: "SOLD_OUT", label: "Sold out" },
                    { value: "HIDDEN", label: "Hidden" },
                  ]}
                />
              </div>
            </div>
            <div className="product-results-toolbar">
              <p role="status">
                {filteredProducts.length
                  ? `Showing ${start + 1}–${Math.min(start + pageSize, filteredProducts.length)} of ${filteredProducts.length} products`
                  : "No matching products"}
              </p>
              {hasFilters && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={browsingLocked}
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
        {archiveError && <InlineMessage>{archiveError}</InlineMessage>}
        {availableError && (unverified || !pageProducts.some((product) => product.id === availableError.id)) && (
          <InlineMessage>{availableError.message}</InlineMessage>
        )}
        {unverified ? (
          <InlineMessage tone={query.isFetching ? "info" : "error"}>
            {query.isFetching
              ? "Checking saved products. Changes are locked until verification finishes."
              : "Saved product status is unverified. Refresh products to unlock changes."}
          </InlineMessage>
        ) : query.isPending ? (
          <ProductsSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} resource="your products" action="load"
            permissionMessage="Your product access is unavailable. Choose another shop or sign in again."
            unavailableMessage="Your product access is unavailable. Choose another shop or sign in again."
            pending={query.isFetching} onRetry={refreshProducts} />
        ) : query.data.products.length ? (
          <div className="product-groups">
            {groups.map((group) => (
              <section
                key={group.key}
                className="product-group"
                aria-labelledby={`product-group-${group.key}`}
              >
                <header className="product-group-heading">
                  <div>
                    <span className="product-group-icon" aria-hidden="true">
                      <FiLayers />
                    </span>
                    <h3 id={`product-group-${group.key}`}>{group.name}</h3>
                    <span>
                      {group.products.length < group.totalCount
                        ? `${group.products.length} of ${group.totalCount}`
                        : group.products.length}{" "}
                      {group.totalCount === 1 ? "product" : "products"}
                    </span>
                    {group.hidden && (
                      <span className="category-visibility">
                        Category hidden
                      </span>
                    )}
                  </div>
                  {!showArchived && group.activeCount >= 2 && (
                    <button
                      id={`reorder-products-${group.key}`}
                      type="button"
                      className="secondary-button"
                      aria-label={`Reorder ${group.name} products`}
                      disabled={
                        creating ||
                        Boolean(editing) ||
                        ordering ||
                        Boolean(archiving) ||
                        archiveBusy ||
                        Boolean(availableBusy) ||
                        denied ||
                        group.unavailable ||
                        group.activeCount > PRODUCT_REORDER_MAX
                      }
                      onClick={() => {
                        setFeaturedOrdering(false);
                        setOrderCategory(group.categoryId || "");
                        setOrdering(true);
                      }}
                      title="Reorder the complete category, including products outside these results"
                    >
                      <FiMove aria-hidden="true" />
                      Reorder
                    </button>
                  )}
                </header>
                <ul className="products-list">
                  {group.products.map((product) => (
                    <li
                      key={product.id}
                      data-status={
                        product.isArchived ? "ARCHIVED" : product.status
                      }
                    >
                      <span className="product-emblem">
                        <FiCoffee aria-hidden="true" />
                        {product.imageUrl && (
                          <img
                            src={product.imageUrl}
                            width={160}
                            height={160}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            fetchPriority="low"
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
                        {!product.isArchived &&
                          product.status === "AVAILABLE" && (
                            <p className="field-hint">
                              {!product.categoryId
                                ? "Shown on the menu · Available to order"
                                : categories.data?.categories.find(
                                      (item) => item.id === product.categoryId,
                                    )?.isVisible === true
                                  ? "Shown on the menu · Available to order"
                                  : categories.data?.categories.find(
                                        (item) =>
                                          item.id === product.categoryId,
                                      )?.isVisible === false
                                    ? "Category hidden · Not shown on the menu"
                                    : "Availability follows category visibility"}
                            </p>
                          )}
                        {availableError?.id === product.id && (
                          <InlineMessage>
                            {availableError.message}
                          </InlineMessage>
                        )}
                        {!product.isArchived && product.status === "HIDDEN" && (
                          <p className="field-hint">
                            Hidden from the customer menu · Details kept
                          </p>
                        )}
                        {!product.isArchived &&
                          product.status === "SOLD_OUT" && (
                            <p className="field-hint">
                              {!product.categoryId ||
                              categories.data?.categories.find(
                                (item) => item.id === product.categoryId,
                              )?.isVisible === true
                                ? "Shown on the menu · Sold out"
                                : categories.data?.categories.find(
                                      (item) => item.id === product.categoryId,
                                    )?.isVisible === false
                                  ? "Category hidden · Not shown on the menu"
                                  : "Menu visibility follows category visibility"}
                            </p>
                          )}
                        <small>
                          {productPreview?.id === product.id ? (
                            <span role="status">
                              {productPreview.status
                                ? "Saving product status…"
                                : "Saving featured selection…"}
                            </span>
                          ) : `/${product.slug}`}
                        </small>
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
                              Photo added
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="product-card-actions">
                        <strong className="product-price">
                          {formatProductPrice(product.price)}
                        </strong>
                        {!product.isArchived && (
                          <button
                            id={`edit-product-${product.id}`}
                            className="secondary-button"
                            type="button"
                            aria-label={`Edit ${product.name}`}
                            disabled={
                              creating ||
                              Boolean(editing) ||
                              ordering ||
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
                        {!product.isArchived ? (
                          <ProductActionsMenu
                            id={`more-product-${product.id}`}
                            name={product.name}
                            disabled={
                              creating ||
                              Boolean(editing) ||
                              ordering ||
                              Boolean(archiving) ||
                              archiveBusy ||
                              Boolean(availableBusy) ||
                              denied
                            }
                          >
                            <button
                              className="secondary-button"
                              type="button"
                              aria-label={`Customize ${product.name}`}
                              disabled={
                                creating ||
                                Boolean(editing) ||
                                ordering ||
                                Boolean(archiving) ||
                                archiveBusy ||
                                Boolean(availableBusy) ||
                                denied
                              }
                              onClick={() =>
                                void navigate(
                                  `${shopPath(membership.shopId)}/products/${encodeURIComponent(product.id)}/customize`,
                                )
                              }
                            >
                              <FiSliders aria-hidden="true" />
                              Customize
                            </button>
                            {!product.isArchived && (
                              <button
                                id={`feature-product-${product.id}`}
                                className="secondary-button"
                                type="button"
                                aria-pressed={product.isFeatured}
                                aria-label={`${product.isFeatured ? "Unfeature" : "Feature"} ${product.name}`}
                                disabled={
                                  creating ||
                                  Boolean(editing) ||
                                  ordering ||
                                  Boolean(archiving) ||
                                  archiveBusy ||
                                  Boolean(availableBusy) ||
                                  denied
                                }
                                onClick={() => void changeFeatured(product)}
                              >
                                <FiStar aria-hidden="true" />
                                {availableBusy === product.id
                                  ? "Updating…"
                                  : product.isFeatured
                                    ? "Unfeature"
                                    : "Feature"}
                              </button>
                            )}
                            {!product.isArchived &&
                              product.status !== "HIDDEN" && (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  aria-label={`Hide ${product.name}`}
                                  disabled={
                                    creating ||
                                    Boolean(editing) ||
                                    ordering ||
                                    Boolean(archiving) ||
                                    archiveBusy ||
                                    Boolean(availableBusy) ||
                                    denied
                                  }
                                  onClick={() =>
                                    void changeAvailability(product, "HIDDEN")
                                  }
                                >
                                  <FiEyeOff aria-hidden="true" />
                                  {availableBusy === product.id
                                    ? "Updating…"
                                    : "Hide"}
                                </button>
                              )}
                            {!product.isArchived &&
                              product.status !== "AVAILABLE" && (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  aria-label={`Make ${product.name} available`}
                                  disabled={
                                    creating ||
                                    Boolean(editing) ||
                                    ordering ||
                                    Boolean(archiving) ||
                                    archiveBusy ||
                                    Boolean(availableBusy) ||
                                    denied
                                  }
                                  onClick={() =>
                                    void changeAvailability(product)
                                  }
                                >
                                  <FiCheckCircle aria-hidden="true" />
                                  {availableBusy === product.id
                                    ? "Updating…"
                                    : "Make available"}
                                </button>
                              )}
                            {!product.isArchived &&
                              product.status === "AVAILABLE" && (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  aria-label={`Mark ${product.name} sold out`}
                                  disabled={
                                    creating ||
                                    Boolean(editing) ||
                                    ordering ||
                                    Boolean(archiving) ||
                                    archiveBusy ||
                                    Boolean(availableBusy) ||
                                    denied
                                  }
                                  onClick={() =>
                                    void changeAvailability(product, "SOLD_OUT")
                                  }
                                >
                                  <FiSlash aria-hidden="true" />
                                  {availableBusy === product.id
                                    ? "Updating…"
                                    : "Mark sold out"}
                                </button>
                              )}
                            {!product.isArchived &&
                              product.status === "SOLD_OUT" && (
                                <span className="field-hint">
                                  Temporarily unavailable
                                </span>
                              )}
                            <button
                              id={`archive-product-${product.id}`}
                              className="secondary-button"
                              type="button"
                              aria-label={`${product.isArchived ? "Restore" : "Archive"} ${product.name}`}
                              disabled={
                                creating ||
                                Boolean(editing) ||
                                ordering ||
                                Boolean(archiving) ||
                                archiveBusy ||
                                Boolean(availableBusy) ||
                                denied
                              }
                              onClick={() =>
                                product.isArchived
                                  ? void changeArchive(product, false).catch(
                                      (error) => {
                                        if (stillHere())
                                          setArchiveError(error.message);
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
                          </ProductActionsMenu>
                        ) : (
                          <button
                            id={`archive-product-${product.id}`}
                            className="secondary-button"
                            type="button"
                            aria-label={`Restore ${product.name}`}
                            disabled={
                              creating ||
                              Boolean(editing) ||
                              ordering ||
                              Boolean(archiving) ||
                              archiveBusy ||
                              Boolean(availableBusy) ||
                              denied
                            }
                            onClick={() =>
                              void changeArchive(product, false).catch(
                                (error) => {
                                  if (stillHere())
                                    setArchiveError(error.message);
                                },
                              )
                            }
                          >
                            <FiRotateCcw aria-hidden="true" /> {archiveBusy && archiveTarget === product.id ? "Restoring…" : "Restore"}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : showArchived ? (
          <EmptyState title="Nothing archived." icon={<FiArchive />}
            description="Archived products stay here until you restore them. Your active menu is in the other view.">
            <button type="button" className="secondary-button" disabled={browsingLocked}
              onClick={() => { setShowArchived(false); clearFilters(); }}>Back to active products</button>
          </EmptyState>
        ) : (
          <EmptyState title="Start with a favorite." icon={<FiCoffee />}
            description="Create your first product to bring this menu to life.">
            <button type="button" className="primary-button" disabled={browsingLocked || denied}
              onClick={() => { setInitialCategoryId(""); setCreating(true); }}>
              Add your first product
            </button>
          </EmptyState>
        )}
      </section>
      {query.isSuccess && !denied && (
        <footer className="product-page-footer">
          {pageCount > 1 && (
            <nav className="product-pagination" aria-label="Product pages">
              <button
                type="button"
                className="secondary-button"
                aria-label="Previous product page"
                disabled={browsingLocked || currentPage === 1}
                onClick={() => changePage(currentPage - 1)}
              >
                <FiChevronLeft aria-hidden="true" /> Previous
              </button>
              <div className="product-page-numbers">
                {Array.from(
                  { length: Math.min(5, pageCount) },
                  (_, index) =>
                    Math.max(1, Math.min(currentPage - 2, pageCount - 4)) +
                    index,
                ).map((number) => (
                  <button
                    key={number}
                    type="button"
                    className="secondary-button"
                    aria-label={`Go to product page ${number}`}
                    aria-current={number === currentPage ? "page" : undefined}
                    disabled={browsingLocked}
                    onClick={() => changePage(number)}
                  >
                    {number}
                  </button>
                ))}
              </div>
              <span>
                Page {currentPage} of {pageCount}
              </span>
              <button
                type="button"
                className="secondary-button"
                aria-label="Next product page"
                disabled={browsingLocked || currentPage === pageCount}
                onClick={() => changePage(currentPage + 1)}
              >
                Next <FiChevronRight aria-hidden="true" />
              </button>
            </nav>
          )}
        </footer>
      )}
      {query.isSuccess && !denied && query.data.products.length > 0 && hasFilters && filteredProducts.length === 0 && (
        <EmptyState title="No products found." icon={<FiSearch />}
          description="Try another name or clear the filters to browse your menu.">
          <button type="button" className="secondary-button" disabled={browsingLocked}
            onClick={() => {
              clearFilters();
              requestAnimationFrame(() => document.getElementById("product-search")?.focus());
            }}>Reset product filters</button>
        </EmptyState>
      )}
      {query.isSuccess && !denied && !showArchived && !hasFilters && categories.isSuccess &&
        knownCategories.filter((category) => !visibleProducts.some((product) => product.categoryId === category.id))
          .map((category) => (
            <EmptyState key={category.id} title={`${category.name} has no products yet.`} icon={<FiLayers />}
              description={category.isVisible
                ? "Add a product to start filling this category. Empty categories stay out of the customer menu."
                : "Add a product to this category. The category will stay hidden until you choose to show it."}>
              <button type="button" className="secondary-button" disabled={browsingLocked}
                onClick={() => { setInitialCategoryId(category.id); setCreating(true); }}>
                Add product to {category.name}
              </button>
            </EmptyState>
          ))}
      {query.isSuccess &&
        !unverified &&
        !hasFilters &&
        visibleProducts.length === 0 &&
        query.data.products.length > 0 && (
          <div className="categories-empty product-no-results">
            {showArchived ? (
              <FiArchive aria-hidden="true" />
            ) : (
              <FiCoffee aria-hidden="true" />
            )}
            <h3>
              {showArchived
                ? "Nothing archived."
                : "Your active menu is empty."}
            </h3>
            <p>
              {showArchived
                ? "Archived products stay here until you restore them."
                : "Create a product or restore one from Archived products."}
            </p>
            {
              <button
                type="button"
                className="secondary-button"
                disabled={browsingLocked}
                onClick={() => {
                  setShowArchived(!showArchived);
                  clearFilters();
                }}
              >
                {showArchived
                  ? "Back to active products"
                  : "View archived products"}
              </button>
            }
          </div>
        )}
      {createdProduct &&
        !creating &&
        !editing &&
        !createdProduct.isArchived && (
          <div className="customization-notice">
            <p>
              <strong>{createdProduct.name}</strong> is saved. Add options or
              extras now, or do it later from More.
            </p>
            <div className="customization-actions">
              <button
                className="primary-button"
                disabled={
                  ordering || archiveBusy || Boolean(availableBusy) || denied
                }
                onClick={() =>
                  void navigate(
                    `${shopPath(membership.shopId)}/products/${encodeURIComponent(createdProduct.id)}/customize`,
                  )
                }
              >
                Customize product
              </button>
              <button
                className="secondary-button"
                onClick={() => setCreatedProduct(null)}
              >
                Done
              </button>
            </div>
          </div>
        )}
      <DecisionDialog
        open={Boolean(archiving)}
        title={`Archive ${archiving?.name ?? "product"}?`}
        description="This product leaves your menu and moves to Archived products. Its details stay saved. Restore it there anytime."
        confirmLabel="Archive product"
        cancelLabel="Keep product"
        animateClose
        onConfirm={async () => {
          if (archiving) await changeArchive(archiving, true);
        }}
        onClose={() => {
          returnFocus.current = `more-product-${archiving?.id}`;
          setArchiving(null);
        }}
        errorMessage={(error) =>
          error instanceof Error ? error.message : archiveMessage(error)
        }
      />
      {ordering && query.isSuccess && (
        <ProductOrderEditor
          featured={featuredOrdering}
          triggerId={
            featuredOrdering
              ? "reorder-featured-items"
              : `reorder-products-${orderCategory || "uncategorized"}`
          }
          products={
            featuredOrdering
              ? featuredProducts
              : query.data.products.filter(
                  (item) =>
                    !item.isArchived &&
                    item.categoryId === (orderCategory || null),
                )
          }
          onSave={saveOrder}
          onClose={() => setOrdering(false)}
        />
      )}
      {(creating || editing) && (
        <ProductEditor
          userId={userId}
          shopId={membership.shopId}
          shopSlug={membership.shop.slug}
          product={editing ?? undefined}
          initialCategoryId={initialCategoryId}
          onCreated={setCreatedProduct}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
