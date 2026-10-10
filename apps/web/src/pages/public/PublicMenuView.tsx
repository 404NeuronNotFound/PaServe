import type { PublicMenuResponse } from "@paserve/contracts";
import { isMenuLayout, DEFAULT_MENU_LAYOUT } from "@paserve/contracts";
import { formatProductPrice } from "../../lib/money";
import { menuTheme } from "../../lib/menu-theme";
import { ShopLogo } from "../../components/shops/ShopLogo";
import { ShopBanner } from "../../components/shops/ShopBanner";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import "./public-menu.css";

export function PublicMenuView({
  menu,
  preview = false,
}: {
  menu: PublicMenuResponse;
  preview?: boolean;
}) {
  const Root = preview ? "div" : "main";
  const { shop, categories, products, featuredProducts } = menu;
  return (
    <Root
      className="public-menu"
      data-preview={preview ? "true" : undefined}
      data-layout={
        isMenuLayout(shop.menuLayout) ? shop.menuLayout : DEFAULT_MENU_LAYOUT
      }
      style={menuTheme(shop.primaryColor, shop.accentColor)}
    >
      <ShopBanner url={shop.bannerUrl} name={shop.name} />
      <header className="public-menu-header">
        <ShopLogo url={shop.logoUrl} name={shop.name} />
        <div>
          <p className="section-label">MENU</p>
          <h1>{shop.name}</h1>
          {shop.description && <p>{shop.description}</p>}
        </div>
        {!preview && <AppearanceToggle />}
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
    </Root>
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
              {product.isFeatured && (
                <span className="menu-accent-badge">Featured</span>
              )}
              {product.status === "SOLD_OUT" && (
                <span className="menu-accent-badge">Sold out</span>
              )}
            </div>
            <strong>{formatProductPrice(product.price)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
