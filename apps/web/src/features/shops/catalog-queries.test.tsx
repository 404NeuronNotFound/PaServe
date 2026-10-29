import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listProducts } from "./api/products";
import { listCategories } from "./api/categories";
import {
  listVariants,
  listAddOns,
  listProductAddOns,
} from "./api/customization";
import {
  categoriesQuery,
  productsQuery,
  customizationQuery,
} from "./catalog-queries";
import { useCustomizationPrefetch } from "./useCustomizationPrefetch";
import { currentUserKey } from "../auth/api/session";

vi.mock("./api/products", async (original) => ({
  ...(await original<typeof import("./api/products")>()),
  listProducts: vi.fn(),
}));
vi.mock("./api/categories", async (original) => ({
  ...(await original<typeof import("./api/categories")>()),
  listCategories: vi.fn(),
}));
vi.mock("./api/customization", async (original) => ({
  ...(await original<typeof import("./api/customization")>()),
  listVariants: vi.fn(),
  listAddOns: vi.fn(),
  listProductAddOns: vi.fn(),
}));
const clients: QueryClient[] = [];
const originalConnection = Object.getOwnPropertyDescriptor(
  navigator,
  "connection",
);
function setup() {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(currentUserKey, { user: { id: "u" } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProducts).mockResolvedValue({ products: [] });
  vi.mocked(listCategories).mockResolvedValue({ categories: [] });
  vi.mocked(listVariants).mockResolvedValue({ variants: [], optionGroups: [] });
  vi.mocked(listAddOns).mockResolvedValue({ addOns: [] });
  vi.mocked(listProductAddOns).mockResolvedValue({ addOns: [] });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  if (originalConnection)
    Object.defineProperty(navigator, "connection", originalConnection);
  else Reflect.deleteProperty(navigator, "connection");
});
const intentDelay = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });

it.each(["products", "categories"] as const)(
  "shares %s reads across observers and remounts, then refetches after expiry",
  async (kind) => {
    const { wrapper } = setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const useCatalog = () => {
      const products = useQuery({
        ...productsQuery("u", "a"),
        enabled: kind === "products",
      });
      const categories = useQuery({
        ...categoriesQuery("u", "a"),
        enabled: kind === "categories",
      });
      return kind === "products" ? products : categories;
    };
    const read =
      kind === "products" ? vi.mocked(listProducts) : vi.mocked(listCategories);
    // fetchQuery shares the same promise even while two screens request it.
    const first = renderHook(useCatalog, { wrapper });
    const second = renderHook(useCatalog, { wrapper });
    await waitFor(() =>
      expect(
        first.result.current.isSuccess && second.result.current.isSuccess,
      ).toBe(true),
    );
    expect(read).toHaveBeenCalledOnce();
    first.unmount();
    second.unmount();
    now += 14_999;
    const warm = renderHook(useCatalog, { wrapper });
    expect(warm.result.current.isSuccess).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    warm.unmount();
    now += 2;
    renderHook(useCatalog, { wrapper });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  },
);

it("keeps invalidation and forced verification effective inside the reuse window", async () => {
  const { client, wrapper } = setup();
  const query = productsQuery("u", "a");
  const view = renderHook(() => useQuery(query), { wrapper });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  await act(async () => {
    await client.invalidateQueries({ queryKey: query.queryKey });
  });
  expect(listProducts).toHaveBeenCalledTimes(2);
  await client.fetchQuery({ ...query, staleTime: 0 });
  expect(listProducts).toHaveBeenCalledTimes(3);
});

it("never shares catalog entries across accounts or shops", async () => {
  const { client } = setup();
  await Promise.all([
    client.fetchQuery(productsQuery("u", "a")),
    client.fetchQuery(productsQuery("v", "a")),
    client.fetchQuery(productsQuery("u", "b")),
  ]);
  expect(listProducts).toHaveBeenCalledTimes(3);
  expect(
    client.getQueryCache().findAll({ queryKey: ["products"] }),
  ).toHaveLength(3);
});

it("prefetches customization on intent and reuses it on mount and repeated intent", async () => {
  const { client, wrapper } = setup();
  const prefetch = renderHook(() => useCustomizationPrefetch("u", "a", true), {
    wrapper,
  });
  act(() => prefetch.result.current.schedule("p"));
  await waitFor(() =>
    expect(
      client.getQueryData(customizationQuery("u", "a", "p").queryKey),
    ).toBeDefined(),
  );
  const screen = renderHook(() => useQuery(customizationQuery("u", "a", "p")), {
    wrapper,
  });
  expect(screen.result.current.isSuccess).toBe(true);
  act(() => prefetch.result.current.schedule("p"));
  await intentDelay();
  expect(listVariants).toHaveBeenCalledOnce();
  expect(listAddOns).toHaveBeenCalledOnce();
  expect(listProductAddOns).toHaveBeenCalledOnce();
});

it("drops transient intent on leave, navigation or loss of permission", async () => {
  const { wrapper } = setup();
  const view = renderHook(
    ({ enabled }) => useCustomizationPrefetch("u", "a", enabled),
    { wrapper, initialProps: { enabled: true } },
  );
  act(() => {
    view.result.current.schedule("p");
    view.result.current.cancel();
  });
  await intentDelay();
  act(() => view.result.current.schedule("p"));
  view.rerender({ enabled: false });
  await intentDelay();
  view.rerender({ enabled: true });
  act(() => view.result.current.schedule("p"));
  view.unmount();
  await intentDelay();
  expect(listVariants).not.toHaveBeenCalled();
});

it("limits speculative work to one read group while another is pending", async () => {
  const { wrapper } = setup();
  let finish!: (value: Awaited<ReturnType<typeof listVariants>>) => void;
  vi.mocked(listVariants).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderHook(() => useCustomizationPrefetch("u", "a", true), {
    wrapper,
  });
  act(() => view.result.current.schedule("p"));
  await waitFor(() => expect(listVariants).toHaveBeenCalledOnce());
  act(() => view.result.current.schedule("another-product"));
  await intentDelay();
  expect(listVariants).toHaveBeenCalledOnce();
  await act(async () => finish({ variants: [], optionGroups: [] }));
});

it("retries a failed prefetch when the screen actually opens", async () => {
  const { client, wrapper } = setup();
  vi.mocked(listVariants).mockRejectedValueOnce(
    new Error("Temporary network failure"),
  );
  const query = customizationQuery("u", "a", "p");
  await client.prefetchQuery(query);
  expect(client.getQueryData(query.queryKey)).toBeUndefined();
  const view = renderHook(() => useQuery(query), { wrapper });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  expect(listVariants).toHaveBeenCalledTimes(2);
});

it("skips speculative reads on save-data connections or after identity changes", async () => {
  const { client, wrapper } = setup();
  const network = { saveData: true };
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    get: () => network,
  });
  const view = renderHook(() => useCustomizationPrefetch("u", "a", true), {
    wrapper,
  });
  act(() => view.result.current.schedule("p"));
  await intentDelay();
  network.saveData = false;
  act(() => view.result.current.schedule("p"));
  client.setQueryData(currentUserKey, { user: { id: "v" } });
  await intentDelay();
  expect(listVariants).not.toHaveBeenCalled();
});
