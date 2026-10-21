import { Button } from "../../components/ui/button";
import { MediaImage } from "../../components/media/MediaImage";
import { Input } from "../../components/ui/input";
import { ProductCard } from "../../components/paserve/ProductCard";
import type { PublicMenuResponse } from "@paserve/contracts";
import { memo, useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { useMenuSections } from "./useMenuSections";
import { EmptyState } from "../../components/feedback/EmptyState";
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
import { Badge } from "../../components/ui/badge";
import { StatusBadge } from "../../components/paserve/StatusBadge";

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
  const [availableOnly, setAvailableOnly] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const browseBar = useRef<HTMLDivElement>(null);
  const sectionContainer = useRef<HTMLDivElement>(null);
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }
  const selected = products.find((product) => product.id === selectedId);
  const deferredSearch = useDeferredValue(search);
  const searchPending = search !== deferredSearch;
  const term = deferredSearch.trim().toLocaleLowerCase();
  const { shown, sections } = useMemo(() => {
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const matches = (product: PublicMenuResponse["products"][number]) =>
      (!availableOnly || (product.status === "AVAILABLE" && product.isOrderable)) &&
      (!term || [product.name, product.description, categoryNames.get(product.categoryId ?? "")]
        .some((value) => value?.toLocaleLowerCase().includes(term)));
    const shown = products.filter(matches);
    const featured = featuredProducts.filter(matches);
    const byCategory = new Map<string | null, PublicMenuResponse["products"]>();
    for (const product of shown) {
      const group = byCategory.get(product.categoryId);
      if (group) group.push(product);
      else byCategory.set(product.categoryId, [product]);
    }
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
          items: byCategory.get(category.id) ?? [],
        }))
        .filter((section) => section.items.length),
      ...(byCategory.has(null)
        ? [
            {
              id: "uncategorized",
              name: "Uncategorized",
              description: null,
              items: byCategory.get(null)!,
            },
          ]
        : []),
    ];
    return { shown, sections };
  }, [categories, products, featuredProducts, term, availableOnly]);
  const sectionIds = useMemo(() => sections.map((section) => `${prefix}-${section.id}`), [sections, prefix]);
  const navigation = useMenuSections(sectionIds, sectionContainer, browseBar);
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
        <ShopBanner url={shop.bannerUrl} name={shop.name} preserveSpace />
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
        <div className="menu-browse-bar" ref={browseBar}>
          <div className="menu-browse-tools">
            {!!products.length && (
              <label className="menu-search" htmlFor={`${prefix}-search`}>
                <FiSearch aria-hidden="true" />
                <span className="sr-only">Search menu</span>
                <Input
                  ref={searchInput}
                  id={`${prefix}-search`}
                  type="search"
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-controls={`${prefix}-items`}
                  placeholder="Find your next favorite…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <Button variant="ghost" size="inherit"
                    type="button"
                    aria-label="Clear search"
                    onClick={clearSearch}
                  >
                    <FiX aria-hidden="true" />
                  </Button>
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
          {!!products.length && (
            <div className="menu-browse-options">
              <Button variant="outline" type="button" aria-pressed={availableOnly} aria-controls={`${prefix}-items`}
                onClick={() => setAvailableOnly((value) => !value)}>
                Available now
              </Button>
              <span>Browse categories or search by item name.</span>
            </div>
          )}
          {!!sections.length && (
            <nav className="menu-category-nav" aria-label="Menu categories">
              {sections.map((section) => (
                <a key={section.id} href={`#${prefix}-${section.id}`}
                  aria-current={navigation.active === `${prefix}-${section.id}` ? "location" : undefined}
                  onClick={() => {
                    navigation.select(`${prefix}-${section.id}`);
                    document.getElementById(`${prefix}-${section.id}`)?.focus({ preventScroll: true });
                  }}>
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
        <EmptyState title="No items are available on this menu yet." icon={<FiCoffee />}
          description={preview ? "Add a visible product to start building this menu." : "The shop has no items to show right now. Ask the staff about availability or check again shortly."}>
          {!preview && <Button variant="outline" size="inherit" type="button" className="secondary-button" onClick={() => window.location.reload()}>Refresh menu</Button>}
        </EmptyState>
      )}
      <div className="menu-search-status-slot">
        {(term || availableOnly) && (
          <p className="menu-search-status" role="status" aria-live={searchPending ? "off" : "polite"}>
            {shown.length} {shown.length === 1 ? "item" : "items"}
            {term ? ` matching “${deferredSearch.trim()}”` : ""}
            {availableOnly ? " available now" : ""}
          </p>
        )}
      </div>
      {(term || availableOnly) && products.length > 0 && !shown.length && (
        <div className="menu-empty">
          <FiSearch aria-hidden="true" />
          <p>{availableOnly ? "No available items match these filters." : "No matches. Try another craving."}</p>
          <Button variant="outline" size="inherit"
            type="button"
            className="secondary-button"
            onClick={() => { setAvailableOnly(false); clearSearch(); }}
          >
            {availableOnly ? "Show all items" : "Clear search"}
          </Button>
        </div>
      )}
      <div className="menu-sections" id={`${prefix}-items`} ref={sectionContainer} aria-busy={searchPending}>
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

const MenuSection = memo(function MenuSection({
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
    <section className="public-menu-section" aria-label={title} data-menu-section={id}>
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
          <ProductCard
            className="menu-product-card"
            data-sold-out={product.status === "SOLD_OUT" ? "true" : undefined}
            key={product.id}
          >
            <ProductMedia product={product} />
            <div className="menu-product-body">
              {(product.isFeatured || product.status === "SOLD_OUT" || !product.isOrderable) && (
                <div className="menu-product-badges">
                  {product.isFeatured && (
                    <Badge variant="brand" className="menu-accent-badge">
                      <FiStar aria-hidden="true" />
                      Featured
                    </Badge>
                  )}
                  {(product.status === "SOLD_OUT" || !product.isOrderable) && (
                    <StatusBadge
                      state={product.status === "SOLD_OUT" ? "SOLD_OUT" : "UNAVAILABLE"}
                      className="menu-sold-out-badge"
                      id={`${statusPrefix}-${product.id}-sold-out`}
                    >
                      {product.status === "SOLD_OUT" ? "Sold out" : "Unavailable"}
                    </StatusBadge>
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
                <Button variant="ghost" size="inherit"
                  type="button"
                  className="menu-product-details-button"
                  aria-label={`View details for ${product.name}`}
                  aria-describedby={
                    product.status === "SOLD_OUT" || !product.isOrderable
                      ? `${statusPrefix}-${product.id}-sold-out`
                      : undefined
                  }
                  onClick={() => onSelect(product.id)}
                >
                  <span>View details</span>
                  <FiArrowUpRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          </ProductCard>
        ))}
      </ul>
    </section>
  );
});

function ProductMedia({
  product,
}: {
  product: PublicMenuResponse["products"][number];
}) {
  return (
    <div className="menu-product-media">
      <MediaImage
        src={product.imageUrl}
        width={400}
        height={300}
        alt=""
        fallback={
          <div className="menu-product-placeholder" aria-hidden="true">
            <FiCoffee />
            <span>{product.name.slice(0, 1)}</span>
          </div>
        }
      />
    </div>
  );
}
