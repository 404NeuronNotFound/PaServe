import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  FiCoffee,
  FiPlus,
  FiStar,
  FiImage,
  FiRefreshCw,
  FiEdit2,
} from "react-icons/fi";
import {
  hasShopPermission,
  type CurrentUserResponse,
  type MenuProduct,
} from "@paserve/contracts";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { productsKey, listProducts } from "../../features/shops/api/products";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { ProductEditor } from "./ProductEditor";
import "./categories.css";
import "./products.css";

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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MenuProduct | null>(null);
  const allowed = hasShopPermission(membership.role, "shop.menu.manage");
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
          disabled={creating || Boolean(editing) || denied}
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
              query.isFetching || denied || creating || Boolean(editing)
            }
            onClick={() => void query.refetch()}
          >
            <FiRefreshCw aria-hidden="true" />
            {query.isFetching ? "Refreshing…" : "Refresh products"}
          </button>
        </div>
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
            {query.data.products.map((product) => (
              <li key={product.id}>
                <span className="product-emblem">
                  <FiCoffee aria-hidden="true" />
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
                  <small>/{product.slug}</small>
                  {product.description && <p>{product.description}</p>}
                  <div className="product-card-meta">
                    <span className="category-visibility">
                      {product.status === "AVAILABLE"
                        ? "Available"
                        : product.status === "SOLD_OUT"
                          ? "Sold out"
                          : "Hidden"}
                    </span>
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
                  <strong className="product-price">{product.price}</strong>
                  <button
                    id={`edit-product-${product.id}`}
                    className="secondary-button"
                    type="button"
                    aria-label={`Edit ${product.name}`}
                    disabled={creating || Boolean(editing) || denied}
                    onClick={() => setEditing(product)}
                  >
                    <FiEdit2 aria-hidden="true" />
                    Edit
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
