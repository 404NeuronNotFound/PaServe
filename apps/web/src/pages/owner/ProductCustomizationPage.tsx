import { PendingButton } from "../../components/feedback/PendingButton";
import { ListSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiArrowRight,
  FiPlus,
  FiEdit2,
  FiRefreshCw,
} from "react-icons/fi";
import type {
  AddOn,
  ProductVariant,
  ProductOptionGroup,
} from "@paserve/contracts";
import { productsKey, listProducts } from "../../features/shops/api/products";
import {
  customizationKey,
  listAddOns,
  listProductAddOns,
  listVariants,
  saveVariant,
  deleteVariant,
  deleteAddOn,
  saveOptionGroup,
  saveAddOn,
  assignAddOn,
  unassignAddOn,
} from "../../features/shops/api/customization";
import { shopPath } from "../../features/shops/active-shop";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { CustomizationEditor } from "./CustomizationEditor";
import { useCustomizationAccess } from "./useCustomizationAccess";
import { formatProductPrice } from "../../lib/money";
import "./customization.css";

type Edit =
  | { kind: "variant"; record?: ProductVariant; groupId?: string | null }
  | { kind: "group"; record?: ProductOptionGroup }
  | { kind: "addon"; record?: AddOn };
export function ProductCustomizationPage() {
  const { productId = "" } = useParams();
  const access = useCustomizationAccess();
  return (
    <ProductCustomization
      key={`${access.userId}:${access.membership.shopId}:${productId}`}
      productId={productId}
    />
  );
}
function ProductCustomization({ productId }: { productId: string }) {
  const access = useCustomizationAccess();
  const { membership, userId, allowed, busy, blocked, error } = access;
  const [editor, setEditor] = useState<Edit | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const tab = params.get("section") === "addons" ? "addons" : "choices";
  function selectTab(value: "choices" | "addons") {
    const next = new URLSearchParams(params);
    next.set("section", value);
    setParams(next, { replace: true });
  }
  const createOption = useRef<HTMLButtonElement>(null);
  const createAddOn = useRef<HTMLButtonElement>(null);
  const deleted = useRef<"variant" | "addon" | null>(null);
  useEffect(() => {
    if (deleted.current && !editor && !busy) {
      const trigger =
        deleted.current === "variant" ? createOption : createAddOn;
      deleted.current = null;
      trigger.current?.focus();
    }
  }, [editor, busy]);
  const products = useQuery({
    queryKey: productsKey(userId, membership.shopId),
    queryFn: ({ signal }) => listProducts(membership.shopId, signal),
    enabled: allowed,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });
  const product = products.data?.products.find(
    (item) =>
      item.id === productId &&
      item.shopId === membership.shopId &&
      !item.isArchived,
  );
  const data = useQuery({
    queryKey: customizationKey(userId, membership.shopId, productId),
    queryFn: async ({ signal }) => {
      const [options, catalog, assigned] = await Promise.all([
        listVariants(membership.shopId, productId, signal),
        listAddOns(membership.shopId, signal),
        listProductAddOns(membership.shopId, productId, signal),
      ]);
      return { ...options, catalog: catalog.addOns, assigned: assigned.addOns };
    },
    enabled: allowed && Boolean(product),
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const locked =
    busy ||
    refreshing ||
    blocked ||
    data.isError ||
    products.isError ||
    data.isFetching ||
    products.isFetching ||
    !product;
  async function refresh() {
    if (busy || refreshing) return;
    setRefreshing(true);
    const currentProduct = await products.refetch();
    if (
      currentProduct.isSuccess &&
      currentProduct.data.products.some(
        (item) =>
          item.id === productId &&
          item.shopId === membership.shopId &&
          !item.isArchived,
      )
    ) {
      const result = await data.refetch();
      if (result.isSuccess) {
        access.recovered();
        setEditor(null);
      }
    }
    setRefreshing(false);
  }
  function edit(value: Edit) {
    access.clearError();
    setEditor(value);
  }
  const root = shopPath(membership.shopId);
  if (!allowed)
    return (
      <section>
        <h1>Product customization</h1>
        <InlineMessage>
          You don't have permission to manage customization in this shop.
        </InlineMessage>
      </section>
    );
  const assigned = new Set(data.data?.assigned.map((item) => item.id));
  const catalog =
    data.data?.catalog.filter((item) =>
      item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  const scopeGroups = [
    {
      id: null,
      name: "Standalone options",
      isRequired: false,
      isAvailable: true,
    },
    ...(data.data?.optionGroups ?? []),
  ];
  return (
    <section className="customization-page" aria-labelledby="customize-title">
      <Link className="customization-back" to={`${root}/products`}>
        <FiArrowLeft aria-hidden="true" />
        Back to products
      </Link>
      <header className="customization-heading">
        <div>
          <p className="section-label">PRODUCT CUSTOMIZATION</p>
          <h1 id="customize-title">
            {product ? `Customize ${product.name}` : "Product customization"}
          </h1>
          {product && (
            <p>
              Starting price{" "}
              <strong>{formatProductPrice(product.price)}</strong>
            </p>
          )}
        </div>
        <PendingButton
            pending={refreshing || data.isFetching || products.isFetching}
            pendingLabel="Refreshing customization..."
            iconOnly
          className="secondary-button customization-refresh"
          aria-label="Refresh customization"
          title="Refresh customization"
          disabled={
            busy ||
            refreshing ||
            data.isFetching ||
            products.isFetching ||
            Boolean(editor)
          }
          onClick={() => void refresh()}
        >
          <FiRefreshCw aria-hidden="true" />
        </PendingButton>
      </header>
      {(products.isPending || (product && data.isPending)) && (
        <ListSkeleton label="Loading customization..." />
      )}
      {products.isSuccess && !product && (
        <InlineMessage>
          This product is unavailable or archived in this shop.
        </InlineMessage>
      )}
      {(products.isError || data.isError) && (
        <InlineMessage>
          Unable to load customization. Refresh to verify access and current
          choices.
        </InlineMessage>
      )}
      {error && !editor && <InlineMessage>{error}</InlineMessage>}
      {product && data.isSuccess && (
        <>
          <div
            className="customization-tabs"
            role="tablist"
            aria-label="Customization sections"
          >
            {(["choices", "addons"] as const).map((value) => (
              <button
                key={value}
                id={`customization-${value}-tab`}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`customization-${value}-panel`}
                tabIndex={tab === value ? 0 : -1}
                disabled={busy || Boolean(editor)}
                onClick={() => selectTab(value)}
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "choices"
                      : event.key === "End"
                        ? "addons"
                        : value === "choices"
                          ? "addons"
                          : "choices";
                  selectTab(next);
                  document.getElementById(`customization-${next}-tab`)?.focus();
                }}
              >
                {value === "choices" ? "Sizes & choices" : "Add-ons"}
                <span className="customization-count">
                  {value === "choices"
                    ? scopeGroups.filter(
                        (group) =>
                          group.id ||
                          data.data.variants.some(
                            (item) => item.optionGroupId === null,
                          ),
                      ).length
                    : assigned.size}
                </span>
              </button>
            ))}
          </div>
          <section
            id="customization-choices-panel"
            role="tabpanel"
            aria-labelledby="customization-choices-tab"
            hidden={tab !== "choices"}
            className="customization-choices"
          >
            <div className="customization-section-heading customization-toolbar">
              <div>
                <h2>Let customers choose.</h2>
                <p>
                  Group choices like Size or Temperature, then add the options.
                </p>
              </div>
              <button
                className="primary-button"
                disabled={locked || Boolean(editor)}
                onClick={() => edit({ kind: "group" })}
              >
                <FiPlus aria-hidden="true" /> Create group
              </button>
            </div>
            <div className="customization-groups">
              {scopeGroups
                .filter(
                  (group) =>
                    group.id ||
                    data.data.variants.some(
                      (item) => item.optionGroupId === null,
                    ),
                )
                .map((group) => {
                  const variants = data.data.variants.filter(
                    (item) => item.optionGroupId === group.id,
                  );
                  return (
                    <section
                      className="customization-group"
                      key={group.id ?? "standalone"}
                      aria-label={`${group.name} options`}
                    >
                      <header className="customization-group-header">
                        <div>
                          <h3>{group.name}</h3>
                          <div className="customization-group-meta">
                            <span>
                              {variants.length}{" "}
                              {variants.length === 1 ? "option" : "options"}
                            </span>
                            <span className="customization-badge">
                              {group.isRequired ? "Required" : "Optional"}
                            </span>
                            {!group.isAvailable && (
                              <span className="customization-badge">
                                Hidden
                              </span>
                            )}
                          </div>
                        </div>
                        {group.id && (
                          <button
                            className="customization-icon-button"
                            disabled={locked || Boolean(editor)}
                            aria-label={`Edit ${group.name} group`}
                            title="Group settings"
                            onClick={() =>
                              edit({
                                kind: "group",
                                record: data.data.optionGroups.find(
                                  (item) => item.id === group.id,
                                ),
                              })
                            }
                          >
                            <FiEdit2 aria-hidden="true" />
                          </button>
                        )}
                      </header>
                      <ul className="customization-list">
                        {variants.map((item) => (
                          <li className="customization-row" key={item.id}>
                            <div className="customization-option-name">
                              <strong>{item.name}</strong>
                              <div className="customization-group-meta">
                                {item.isDefault && (
                                  <span className="customization-badge">
                                    Default
                                  </span>
                                )}
                                {!item.isAvailable && (
                                  <span className="customization-badge">
                                    Hidden
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="customization-price">
                              {Number(item.priceAdjustment) === 0
                                ? "No extra charge"
                                : `+${formatProductPrice(item.priceAdjustment)}`}
                            </span>
                            <button
                              className="customization-icon-button"
                              disabled={locked || Boolean(editor)}
                              aria-label={`Edit ${item.name} option`}
                              title={`Edit ${item.name}`}
                              onClick={() =>
                                edit({ kind: "variant", record: item })
                              }
                            >
                              <FiEdit2 aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                      {!variants.length && (
                        <p className="customization-empty">
                          Add your first option to {group.name}, such as Regular
                          or Large.
                        </p>
                      )}
                      <button
                        className="customization-add-option"
                        disabled={locked || Boolean(editor)}
                        aria-label={`Add option to ${group.name}`}
                        onClick={() =>
                          edit({ kind: "variant", groupId: group.id })
                        }
                      >
                        <FiPlus aria-hidden="true" /> Add option
                      </button>
                    </section>
                  );
                })}
            </div>
            {!data.data.variants.length && !data.data.optionGroups.length && (
              <div className="customization-onboarding">
                <span className="customization-badge">A simple example</span>
                <h3>
                  Size <span aria-hidden="true">→</span> Regular · Large
                </h3>
                <p>
                  Start with a group. Its options appear together on your menu.
                </p>
              </div>
            )}
            <button
              className="customization-text-button"
              ref={createOption}
              disabled={locked || Boolean(editor)}
              onClick={() => edit({ kind: "variant", groupId: null })}
            >
              <FiPlus aria-hidden="true" /> Add standalone option
            </button>
          </section>
          <section
            className="customization-product-addons"
            id="customization-addons-panel"
            role="tabpanel"
            aria-labelledby="customization-addons-tab"
            hidden={tab !== "addons"}
          >
            <div className="customization-section-heading customization-toolbar">
              <div>
                <h2 id="product-addons-title" tabIndex={-1}>
                  A little extra.
                </h2>
                <p>
                  Choose extras for this product. Changes save automatically.
                </p>
              </div>
              <button
                className="primary-button"
                disabled={locked || Boolean(editor)}
                onClick={() => edit({ kind: "addon" })}
                ref={createAddOn}
              >
                <FiPlus aria-hidden="true" />
                Create add-on
              </button>
            </div>
            <div className="customization-panel product-addon-list">
              <div className="addon-library-toolbar">
                <div className="field">
                  <label htmlFor="product-addon-search">Find an add-on</label>
                  <input
                    id="product-addon-search"
                    type="search"
                    placeholder="Find an extra…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <p className="field-hint" role="status">
                  {assigned.size} selected
                </p>
              </div>
              <ul className="customization-list">
                {catalog.map((item) => (
                  <li
                    className="addon-library-row product-addon-row"
                    data-selected={assigned.has(item.id)}
                    key={item.id}
                  >
                    <div>
                      <label className="customization-check">
                        <input
                          type="checkbox"
                          checked={assigned.has(item.id)}
                          disabled={locked || Boolean(editor)}
                          aria-label={`Offer ${item.name} on this product`}
                          onChange={() =>
                            void access.run(
                              () =>
                                assigned.has(item.id)
                                  ? unassignAddOn(
                                      membership.shopId,
                                      productId,
                                      item.id,
                                    )
                                  : assignAddOn(
                                      membership.shopId,
                                      productId,
                                      item.id,
                                    ),
                              assigned.has(item.id)
                                ? `${item.name} removed from this product.`
                                : `${item.name} enabled for this product.`,
                            )
                          }
                        />
                        <strong>{item.name}</strong>
                        {assigned.has(item.id) && (
                          <span className="customization-badge">Selected</span>
                        )}
                      </label>
                      {!item.isAvailable && (
                        <span className="product-addon-hidden">
                          Hidden across the shop
                        </span>
                      )}
                    </div>
                    <span className="addon-library-price">
                      {Number(item.priceAdjustment) === 0
                        ? "Free"
                        : `+${formatProductPrice(item.priceAdjustment)}`}
                    </span>
                    <button
                      className="customization-icon-button"
                      disabled={locked || Boolean(editor)}
                      aria-label={`Edit shared ${item.name}`}
                      title="Edit for all products"
                      onClick={() => edit({ kind: "addon", record: item })}
                    >
                      <FiEdit2 aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {!catalog.length && (
                <div className="addon-library-empty">
                  <h2>
                    {search ? "No matching extras" : "Make it their own."}
                  </h2>
                  <p>
                    {search
                      ? "Try another name or clear your search."
                      : "Create an extra, then select it here to offer it on this product."}
                  </p>
                  {search && (
                    <button
                      className="customization-text-button"
                      onClick={() => setSearch("")}
                    >
                      Clear search
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="addon-library-footer">
              <Link className="customization-back" to={`${root}/add-ons`}>
                Shop add-on library <FiArrowRight aria-hidden="true" />
              </Link>
              <span className="field-hint product-addon-scope">
                Selection applies to this product. Edits apply across your shop.
              </span>
            </div>
          </section>
        </>
      )}
      {editor && data.isSuccess && (
        <CustomizationEditor
          key={`${editor.kind}:${editor.record?.id ?? "new"}:${editor.kind === "variant" ? (editor.groupId ?? "standalone") : ""}`}
          kind={editor.kind}
          record={editor.record}
          groups={data.data.optionGroups}
          initialGroupId={
            editor.kind === "variant" ? editor.groupId : undefined
          }
          busy={busy}
          blocked={blocked}
          error={error}
          onClose={() => setEditor(null)}
          onDelete={
            editor.kind !== "group" && editor.record
              ? async () => {
                  const option = editor.record;
                  if (!option) return;
                  access.clearError();
                  await access.run(
                    () =>
                      editor.kind === "addon"
                        ? deleteAddOn(membership.shopId, option.id)
                        : deleteVariant(
                            membership.shopId,
                            productId,
                            option.id,
                          ),
                    editor.kind === "addon"
                      ? `${option.name} deleted from the shop and all products.`
                      : `${option.name} deleted.`,
                    () => {
                      deleted.current =
                        editor.kind === "addon" ? "addon" : "variant";
                      setEditor(null);
                    },
                  );
                }
              : undefined
          }
          onSave={(values) => {
            let createdGroup: ProductOptionGroup | undefined;
            return access.run(
              async () => {
                if (editor.kind === "group") {
                  const result = await saveOptionGroup(
                    membership.shopId,
                    productId,
                    {
                      name: values.name,
                      isRequired: values.isRequired,
                      isAvailable: values.isAvailable,
                      sortOrder: values.sortOrder,
                    },
                    editor.record?.id,
                  );
                  if (!editor.record) createdGroup = result.optionGroup;
                  return result;
                }
                if (editor.kind === "variant")
                  return saveVariant(
                    membership.shopId,
                    productId,
                    {
                      name: values.name,
                      priceAdjustment: values.priceAdjustment,
                      isDefault: values.isDefault,
                      optionGroupId: values.optionGroupId,
                      isAvailable: values.isAvailable,
                      sortOrder: values.sortOrder,
                    },
                    editor.record?.id,
                  );
                return saveAddOn(
                  membership.shopId,
                  {
                    name: values.name,
                    priceAdjustment: values.priceAdjustment,
                    isAvailable: values.isAvailable,
                    sortOrder: values.sortOrder,
                  },
                  editor.record?.id,
                );
              },
              editor.kind === "addon" && !editor.record
                ? "Add-on created. Check it in Add-ons for this product to offer it here."
                : "Customization saved.",
              () =>
                setEditor(
                  createdGroup
                    ? { kind: "variant", groupId: createdGroup.id }
                    : null,
                ),
            );
          }}
        />
      )}
      {blocked && editor && (
        <p role="status">Close the editor and refresh before continuing.</p>
      )}
    </section>
  );
}
