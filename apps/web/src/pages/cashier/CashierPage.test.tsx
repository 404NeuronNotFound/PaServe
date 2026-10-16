import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CashierPage } from "./CashierPage";
import { subscribeNewOrders } from "../../features/orders/new-order-events";

vi.mock("../../features/shops/active-shop", () => ({
  useActiveShop: () => ({
    shopId: "shop-a",
    role: "CASHIER",
    shop: { name: "Cafe" },
  }),
}));
vi.mock("./OrderQrScanner", () => ({
  OrderQrScanner: ({ initialOrderNumber }: { initialOrderNumber?: string }) => <div>Order scanner<span data-testid="initial-order-number">{initialOrderNumber}</span></div>,
}));
vi.mock("../../features/orders/new-order-events", () => ({
  subscribeNewOrders: vi.fn(),
}));
const disconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(subscribeNewOrders).mockReturnValue(disconnect);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([['ORD-000042', 'ORD-000042'], ['invalid', ''], ['ORD-000000', '']])('validates the owner handoff number %s without submitting it', (number, expected) => {
  render(<MemoryRouter initialEntries={[`/cashier?orderNumber=${number}`]}><CashierPage /></MemoryRouter>);
  expect(screen.getByTestId('initial-order-number').textContent).toBe(expected);
});

it("announces new cashier work without inventing arrivals on resynchronization", () => {
  render(
    <MemoryRouter>
      <CashierPage />
    </MemoryRouter>,
  );
  const [, workflow, refresh, status] =
    vi.mocked(subscribeNewOrders).mock.calls[0];
  expect(workflow).toBe("cashier");
  act(() => {
    status("live");
    refresh(false);
  });
  expect(
    screen.queryByText(
      /Listening for new orders|Live updates connecting|A new order arrived/,
    ),
  ).not.toBeInTheDocument();
  act(() => refresh(true));
  expect(screen.getByText(/A new order arrived/)).toBeInTheDocument();
  expect(screen.getByText("Order scanner")).toBeInTheDocument();
});

it("keeps scanning guidance during an outage and releases subscriptions on unmount", () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <MemoryRouter>
      <CashierPage />
    </MemoryRouter>,
  );
  const status = vi.mocked(subscribeNewOrders).mock.calls[0][3];
  act(() => status("retrying"));
  expect(
    screen.queryByText(/Order updates are delayed/),
  ).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(20_000));
  act(() => status("retrying"));
  act(() => vi.advanceTimersByTime(10_000));
  expect(
    screen.getByText(/Order updates are delayed. Scan an order QR/),
  ).toBeInTheDocument();
  act(() => status("live"));
  expect(
    screen.queryByText(/Order updates are delayed/),
  ).not.toBeInTheDocument();
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("keeps short reconnects silent and cancels the delayed warning after recovery", () => {
  vi.useFakeTimers();
  render(
    <MemoryRouter>
      <CashierPage />
    </MemoryRouter>,
  );
  const status = vi.mocked(subscribeNewOrders).mock.calls[0][3];
  act(() => status("connecting"));
  act(() => vi.advanceTimersByTime(5_000));
  act(() => status("live"));
  act(() => vi.advanceTimersByTime(60_000));
  expect(
    screen.queryByText(
      /Order updates are delayed|Live updates connecting|Listening for new orders/,
    ),
  ).not.toBeInTheDocument();
});
