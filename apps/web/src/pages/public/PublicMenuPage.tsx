import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { PublicMenuResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { formatProductPrice } from "../../lib/money";
import { ShopLogo } from "../../components/shops/ShopLogo";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import "./public-menu.css";

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
  const { shop, categories, products, featuredProducts } = menu.data;
  return (
    <main className="public-menu">
      <header className="public-menu-header">
        <ShopLogo url={shop.logoUrl} name={shop.name} />
        <div>
          <p className="section-label">MENU</p>
          <h1>{shop.name}</h1>
          {shop.description && <p>{shop.description}</p>}
        </div>
        <AppearanceToggle />
      </header>
      {!products.length && <p>No items are available on this menu yet.</p>}
      {!!featuredProducts.length && (
        <MenuSection title="Featured" products={featuredProducts} />
      )}
      {categories.map((category) => {
        const items = products.filter(
          (product) => product.categoryId === category.id,
        );
        return items.length ? (
          <MenuSection
            key={category.id}
            title={category.name}
            description={category.description}
            products={items}
          />
        ) : null;
      })}
      {products.some((product) => product.categoryId === null) && (
        <MenuSection
          title="Uncategorized"
          products={products.filter((product) => product.categoryId === null)}
        />
      )}
    </main>
  );
}

function MenuSection({
  title,
  description,
  products,
}: {
  title: string;
  description?: string | null;
  products: PublicMenuResponse["products"];
}) {
  return (
    <section className="public-menu-section" aria-label={title}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            {product.imageUrl && (
              <img src={product.imageUrl} alt="" loading="lazy" />
            )}
            <div>
              <h3>{product.name}</h3>
              {product.description && <p>{product.description}</p>}
              {product.status === "SOLD_OUT" && (
                <span className="field-hint">Sold out</span>
              )}
            </div>
            <strong>{formatProductPrice(product.price)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
