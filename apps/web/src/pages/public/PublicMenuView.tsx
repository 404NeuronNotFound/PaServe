import type { PublicMenuResponse } from "@paserve/contracts";
import { useId, useState } from "react";
import type { CustomerOrderResponse } from "@paserve/contracts";
import {
  FiArrowUpRight,
  FiCoffee,
  FiSearch,
  FiStar,
  FiX,
} from "react-icons/fi";
import { ProductDetailsDialog } from "./ProductDetailsDialog";
import { CustomerCart } from "./CustomerCart";
import { isMenuLayout, DEFAULT_MENU_LAYOUT } from "@paserve/contracts";
import { formatProductPrice } from "../../lib/money";
import { menuTheme } from "../../lib/menu-theme";
import { ShopLogo } from "../../components/shops/ShopLogo";
import { ShopBanner } from "../../components/shops/ShopBanner";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import "./public-menu.css";
import { CurrentTable } from "./CurrentTable";
import { YourActiveOrders } from "./YourActiveOrders";

export function PublicMenuView({
  menu,
  preview = false,
  onOrderPlaced,
}: {
  menu: PublicMenuResponse;
  preview?: boolean;
  onOrderPlaced?: (order: CustomerOrderResponse["order"]) => void;
}) {
  const Root = preview ? "div" : "main";
  const { shop, categories, products, featuredProducts } = menu;
  const prefix = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const selected = products.find((product) => product.id === selectedId);
  const term = search.trim().toLocaleLowerCase();
  const matches = (product: PublicMenuResponse["products"][number]) =>
    !term ||
    [
      product.name,
      product.description,
      categories.find((category) => category.id === product.categoryId)?.name,
    ].some((value) => value?.toLocaleLowerCase().includes(term));
  const shown = products.filter(matches);
  const featured = featuredProducts.filter(matches);
  const sections = [
    ...(featured.length
      ? [
          {
            id: "featured",
            name: "Featured",
            description: "A few highlights from our menu.",
            items: featured,
          },
        ]
      : []),
    ...categories
      .map((category) => ({
        id: `category-${category.id}`,
        name: category.name,
        description: category.description,
        items: shown.filter((product) => product.categoryId === category.id),
      }))
      .filter((section) => section.items.length),
    ...(shown.some((product) => product.categoryId === null)
      ? [
          {
            id: "uncategorized",
            name: "Uncategorized",
            description: null,
            items: shown.filter((product) => product.categoryId === null),
          },
        ]
      : []),
  ];
  return (
    <Root
      className="public-menu"
      data-preview={preview ? "true" : undefined}
      data-layout={
        isMenuLayout(shop.menuLayout) ? shop.menuLayout : DEFAULT_MENU_LAYOUT
      }
      style={menuTheme(shop.primaryColor, shop.accentColor)}
    >
      <div className="menu-topline">
        <span>
          <FiCoffee aria-hidden="true" /> A little something good.
        </span>
        {!preview && <AppearanceToggle />}
      </div>
      {!preview && <YourActiveOrders key={shop.slug} shopSlug={shop.slug} />}
      <div className="menu-shop-hero">
        <ShopBanner url={shop.bannerUrl} name={shop.name} />
        <header className="public-menu-header">
          <ShopLogo url={shop.logoUrl} name={shop.name} />
          <div className="menu-shop-copy">
            <p className="section-label">THE MENU</p>
            <h1>{shop.name}</h1>
            {!preview && menu.table && (
              <CurrentTable table={menu.table} shopName={shop.name} />
            )}
            {shop.description && (
              <p className="menu-shop-description">{shop.description}</p>
            )}
          </div>
          <span className="menu-item-count">
            {products.length} {products.length === 1 ? "item" : "items"}
            <span>to explore</span>
          </span>
        </header>
      </div>
      {(!preview || !!products.length) && (
        <div className="menu-browse-bar">
          <div className="menu-browse-tools">
            {!!products.length && (
              <label className="menu-search" htmlFor={`${prefix}-search`}>
                <FiSearch aria-hidden="true" />
                <span className="sr-only">Search menu</span>
                <input
                  id={`${prefix}-search`}
                  type="search"
                  placeholder="Find your next favorite…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                  >
                    <FiX aria-hidden="true" />
                  </button>
                )}
              </label>
            )}
            {!preview && (
              <CustomerCart
                onOrderPlaced={onOrderPlaced}
                key={`${shop.slug}:${menu.table?.code ?? "browse"}`}
                shop={shop}
                table={menu.table}
              />
            )}
          </div>
          {!!sections.length && (
            <nav className="menu-category-nav" aria-label="Menu categories">
              {sections.map((section) => (
                <a key={section.id} href={`#${prefix}-${section.id}`}>
                  {section.id === "featured" && <FiStar aria-hidden="true" />}
                  {section.name}
                  <span>{section.items.length}</span>
                </a>
              ))}
            </nav>
          )}
        </div>
      )}
      {!products.length && (
        <div className="menu-empty">
          <FiCoffee aria-hidden="true" />
          <p>No items are available on this menu yet.</p>
        </div>
      )}
      {term && (
        <p className="menu-search-status" role="status">
          {shown.length} {shown.length === 1 ? "item" : "items"} matching “
          {search.trim()}”
        </p>
      )}
      {term && !shown.length && (
        <div className="menu-empty">
          <FiSearch aria-hidden="true" />
          <p>No matches. Try another craving.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSearch("")}
          >
            Clear search
          </button>
        </div>
      )}
      <div className="menu-sections">
        {sections.map((section, index) => (
          <MenuSection
            key={section.id}
            id={`${prefix}-${section.id}`}
            number={index + 1}
            title={section.name}
            description={section.description}
            products={section.items}
            onSelect={setSelectedId}
          />
        ))}
      </div>
      <footer className="menu-page-footer">
        <FiCoffee aria-hidden="true" />
        <span>{shop.name}</span>
        <span>Menu by PaServe</span>
      </footer>
      {selected && (
        <ProductDetailsDialog
          key={`${shop.slug}-${selected.id}`}
          shop={shop}
          product={selected}
          preview={preview}
          table={preview ? undefined : menu.table}
          onClose={() => setSelectedId(null)}
        />
      )}
    </Root>
  );
}

function MenuSection({
  id,
  number,
  title,
  description,
  products,
  onSelect,
}: {
  id: string;
  number: number;
  title: string;
  description?: string | null;
  products: PublicMenuResponse["products"];
  onSelect: (id: string) => void;
}) {
  const statusPrefix = useId();
  return (
    <section className="public-menu-section" aria-label={title}>
      <div className="menu-section-heading">
        <div>
          <span className="menu-section-number" aria-hidden="true">
            {String(number).padStart(2, "0")}
          </span>
          <h2 id={id} tabIndex={-1}>
            {title}
          </h2>
        </div>
        <span className="menu-section-count">
          {products.length} {products.length === 1 ? "item" : "items"}
        </span>
      </div>
      {description && <p className="menu-section-description">{description}</p>}
      <ul className="menu-products">
        {products.map((product) => (
          <li
            className="menu-product-card"
            data-sold-out={product.status === "SOLD_OUT" ? "true" : undefined}
            key={product.id}
          >
            <ProductMedia product={product} />
            <div className="menu-product-body">
              {(product.isFeatured || product.status === "SOLD_OUT") && (
                <div className="menu-product-badges">
                  {product.isFeatured && (
                    <span className="menu-accent-badge">
                      <FiStar aria-hidden="true" />
                      Featured
                    </span>
                  )}
                  {product.status === "SOLD_OUT" && (
                    <span
                      className="menu-sold-out-badge"
                      id={`${statusPrefix}-${product.id}-sold-out`}
                    >
                      Sold out
                    </span>
                  )}
                </div>
              )}
              <h3>{product.name}</h3>
              {product.description && (
                <p className="menu-product-description">
                  {product.description}
                </p>
              )}
              <div className="menu-product-footer">
                <strong className="menu-product-price">
                  {formatProductPrice(product.price)}
                </strong>
                <button
                  type="button"
                  className="menu-product-details-button"
                  aria-label={`View details for ${product.name}`}
                  aria-describedby={
                    product.status === "SOLD_OUT"
                      ? `${statusPrefix}-${product.id}-sold-out`
                      : undefined
                  }
                  onClick={() => onSelect(product.id)}
                >
                  <span>View details</span>
                  <FiArrowUpRight aria-hidden="true" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProductMedia({
  product,
}: {
  product: PublicMenuResponse["products"][number];
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="menu-product-media">
      {product.imageUrl && failed !== product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(product.imageUrl)}
        />
      ) : (
        <div className="menu-product-placeholder" aria-hidden="true">
          <FiCoffee />
          <span>{product.name.slice(0, 1)}</span>
        </div>
      )}
    </div>
  );
}
