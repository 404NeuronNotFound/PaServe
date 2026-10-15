import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useIsMutating,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  FiArrowDown,
  FiArchive,
  FiCheck,
  FiClock,
  FiCoffee,
  FiFileText,
  FiPlay,
  FiRefreshCw,
  FiShoppingBag,
  FiSearch,
  FiX,
  FiChevronLeft,
  FiChevronRight,
} from "react-icons/fi";
import type {
  CurrentUserResponse,
  PreparationQueueResponse,
  PreparationStatus,
  StartPreparationResponse,
  ReadyPreparationResponse,
  CompletePreparationResponse,
} from "@paserve/contracts";
import { hasShopPermission } from "@paserve/contracts";
import { currentUserKey } from "../../features/auth/api/session";
import { useActiveShop } from "../../features/shops/active-shop";
import {
  getPreparationQueue,
  startPreparing,
  markReady,
  completeOrder,
  type HistoryFilters,
} from "../../features/kitchen/queue";
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "./kitchen.css";
import { useNewOrderEvents } from "../../features/orders/useNewOrderEvents";
import { usePreparationEvents } from "../../features/orders/usePreparationEvents";

const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const views = {
  QUEUED: {
    title: "New orders",
    label: "Queued",
    intro: "Accepted by cashier and paid. Preparation has not started.",
    description: "Waiting for kitchen / barista to begin preparation.",
    emptyTitle: "A little room to breathe.",
    empty:
      "No orders are queued. Newly confirmed and paid orders will appear here.",
    list: "New orders, oldest first",
  },
  PREPARING: {
    title: "Preparing",
    label: "Preparing",
    intro: "Started by your team. Every detail, still at hand.",
    description:
      "Preparation has started. Each order retains its original start time.",
    emptyTitle: "Nothing preparing just yet.",
    empty: "Start a queued order when your team begins preparing it.",
    list: "Preparing orders, oldest first",
  },
  READY: {
    title: "Ready",
    label: "Ready",
    intro: "Prepared and waiting for pickup or table service.",
    description:
      "Preparation is complete. Orders are awaiting pickup or service.",
    emptyTitle: "The finishing touches come next.",
    empty: "Mark a preparing order ready when every item is finished.",
    list: "Ready orders, oldest first",
  },
  COMPLETED: {
    title: "Completed",
    label: "Completed",
    intro: "Orders your customers have received, with every detail preserved.",
    description: "Fulfilled orders, most recently completed first.",
    emptyTitle: "A good finish is worth keeping.",
    empty: "Orders appear here after staff confirm service or collection.",
    list: "Completed orders, newest first",
  },
} as const;
type TransitionRequest = {
  source: "QUEUED" | "PREPARING" | "READY";
  actorId: string;
  shopId: string;
  orderId: string;
  orderNumber: string;
  mode: "DINE_IN" | "TAKEOUT";
};
type TransitionResult =
  | StartPreparationResponse
  | ReadyPreparationResponse
  | CompletePreparationResponse;
export function KitchenPage() {
  const membership = useActiveShop();
  return <NewOrders key={membership.shopId} />;
}

function NewOrders() {
  const { shopId, shop } = useActiveShop();
  const user =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user;
  const queryClient = useQueryClient();
  usePreparationEvents(shopId, () => {
    for (const status of ["QUEUED", "PREPARING", "READY", "COMPLETED"])
      void queryClient.invalidateQueries({
        queryKey: ["kitchen", "queue", user.id, shopId, status],
      });
  });
  const liveStatus = useNewOrderEvents(shopId, "kitchen", () => {
    void queryClient.invalidateQueries({
      queryKey: ["kitchen", "queue", user.id, shopId, "QUEUED"],
    });
  });
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<PreparationStatus>("QUEUED");
  const view = views[state];
  const [history, setHistory] = useState<HistoryFilters>({ limit: 12 });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const historyCursor = cursors[cursors.length - 1];
  const [selected, setSelected] = useState<
    PreparationQueueResponse["orders"][number] | null
  >(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    document.title = `${view.title} · ${shop.name} · PaServe`;
    heading.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [shop.name, view.title]);
  const queue = useInfiniteQuery({
    queryKey: [
      "kitchen",
      "queue",
      user.id,
      shopId,
      state,
      ...(state === "COMPLETED" ? [history, historyCursor] : []),
    ],
    initialPageParam:
      state === "COMPLETED" ? historyCursor : (null as string | null),
    queryFn: ({ pageParam, signal }) =>
      getPreparationQueue(
        shopId,
        pageParam,
        signal,
        state,
        state === "COMPLETED" ? history : undefined,
      ),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 15_000,
  });
  const status = isAxiosError(queue.error)
    ? queue.error.response?.status
    : undefined;
  if (status === 401)
    return (
      <Navigate to="/login" replace state={{ returnTo: location.pathname }} />
    );
  if (status === 403 || status === 404)
    return (
      <section className="dashboard-status">
        <h1>Kitchen access required</h1>
        <p role="alert">
          Your access to this shop is unavailable. Choose a shop with an active
          kitchen, owner, admin, or manager membership.
        </p>
        <Link className="secondary-button" to="/app/shops">
          Choose another shop
        </Link>
      </section>
    );
  const orders = [
    ...new Map(
      queue.data?.pages
        .flatMap((page) => page.orders)
        .map((order) => [order.id, order]),
    ).values(),
  ].sort((a, b) =>
    state === "COMPLETED"
      ? Date.parse(b.completedAt!) - Date.parse(a.completedAt!) ||
        b.id.localeCompare(a.id)
      : Date.parse(a.queuedAt) - Date.parse(b.queuedAt) ||
        a.id.localeCompare(b.id),
  );
  return (
    <section className="kitchen-workspace">
      {(liveStatus === "delayed" || liveStatus === "denied") && (
        <InlineMessage tone="warning" className="">
          {liveStatus === "denied"
            ? "Order access is unavailable. Refresh orders to check your access."
            : "Order updates are delayed. Refresh orders to check."}
        </InlineMessage>
      )}
      <header className="kitchen-heading">
        <div>
          <p className="section-label">KITCHEN / BARISTA</p>
          <h1 ref={heading} tabIndex={-1}>
            {view.title}
            <span>.</span>
          </h1>
          <p>
            {state === "COMPLETED" ? "Every order, neatly kept." : view.intro}
          </p>
        </div>
        <div className="kitchen-refresh">
          <button
            className="secondary-button"
            disabled={queue.isFetching}
            onClick={() => void queue.refetch()}
          >
            <FiRefreshCw aria-hidden="true" />
            {queue.isFetching ? "Refreshing…" : "Refresh orders"}
          </button>
          <span role="status">
            {queue.dataUpdatedAt
              ? `Last checked ${time(new Date(queue.dataUpdatedAt).toISOString())} · checks every 15s`
              : "Connecting to your queue"}
          </span>
        </div>
      </header>
      <div
        className="kitchen-state-switch"
        role="group"
        aria-label="Preparation views"
      >
        <button
          aria-pressed={state === "QUEUED"}
          onClick={() => setState("QUEUED")}
        >
          <FiClock aria-hidden="true" />
          Queued
        </button>
        <button
          aria-pressed={state === "PREPARING"}
          onClick={() => setState("PREPARING")}
        >
          <FiCoffee aria-hidden="true" />
          Preparing
        </button>
        <button
          aria-pressed={state === "READY"}
          onClick={() => setState("READY")}
        >
          <FiCheck aria-hidden="true" />
          Ready
        </button>
        <button
          aria-pressed={state === "COMPLETED"}
          onClick={() => setState("COMPLETED")}
        >
          <FiArchive aria-hidden="true" />
          Completed
        </button>
      </div>
      <div hidden={state !== "COMPLETED"}>
        <HistorySearch
          onApply={(filters) => {
            setHistory({ ...filters, limit: 12 });
            setCursors([null]);
          }}
        />
      </div>
      <div className="kitchen-queue-heading">
        <div>
          <h2 id="kitchen-queued-heading" ref={historyHeading} tabIndex={-1}>
            {state === "COMPLETED" ? "Completed history" : view.label}{" "}
            <span>
              {queue.data
                ? `${orders.length}${state !== "COMPLETED" && queue.hasNextPage ? "+" : ""}`
                : "—"}
            </span>
          </h2>
          <p
            id="kitchen-queued-description"
            className="kitchen-queue-description"
          >
            {view.description}
          </p>
        </div>
        <p>
          <FiArrowDown aria-hidden="true" />{" "}
          {state === "COMPLETED"
            ? "Newest first · completion time"
            : "Oldest first · queue arrival time"}
        </p>
      </div>
      {queue.isPending && (
        <div className="kitchen-empty" role="status">
          <FiCoffee aria-hidden="true" />
          <h2>Gathering your tickets…</h2>
          <p>Loading the saved preparation queue.</p>
        </div>
      )}
      {queue.isError && (
        <InlineMessage>
          {queue.data
            ? "The queue could not refresh. Tickets below may be out of date. "
            : "We couldn’t load the queue. "}
          {queue.error.message}{" "}
          <button
            className="secondary-button"
            disabled={queue.isFetching}
            onClick={() =>
              void (queue.isFetchNextPageError
                ? queue.fetchNextPage()
                : queue.refetch())
            }
          >
            Try again
          </button>
        </InlineMessage>
      )}
      {queue.isSuccess && orders.length === 0 && (
        <div className="kitchen-empty">
          <span className="kitchen-empty-icon">
            <FiCheck aria-hidden="true" />
          </span>
          <h2>
            {state === "COMPLETED" &&
            (history.search || history.from || history.to)
              ? "No matching orders."
              : view.emptyTitle}
          </h2>
          <p>
            {state === "COMPLETED" &&
            (history.search || history.from || history.to)
              ? "Try another order number or clear the date filters."
              : view.empty}
          </p>
        </div>
      )}
      {state === "COMPLETED" ? (
        <ol
          className="kitchen-history"
          aria-label={view.list}
          aria-busy={queue.isFetching}
        >
          {orders.map((order) => (
            <li key={order.id}>
              <span className="kitchen-history-check">
                <FiCheck aria-hidden="true" />
              </span>
              <div className="kitchen-history-identity">
                <strong>{order.orderNumber}</strong>
                <span>
                  {order.mode === "TAKEOUT"
                    ? "Pickup · Takeout"
                    : `Table ${order.tableNumber} · Dine-in`}
                </span>
              </div>
              <div className="kitchen-history-summary">
                <strong>
                  {order.items.reduce((sum, item) => sum + item.quantity, 0)}{" "}
                  items
                </strong>
                <span>
                  {order.items
                    .map((item) => `${item.quantity}\u00d7 ${item.productName}`)
                    .join("\u00b7 ")}
                </span>
              </div>
              <time dateTime={order.completedAt!}>
                {new Date(order.completedAt!).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <button
                className="secondary-button"
                aria-label={`View details for ${order.orderNumber}`}
                onClick={(event) => {
                  detailTrigger.current = event.currentTarget;
                  setSelected(order);
                }}
              >
                View details <FiChevronRight aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <ol
          className="kitchen-tickets"
          aria-label={view.list}
          aria-describedby="kitchen-queued-description"
        >
          {orders.map((order, index) => (
            <Ticket
              key={order.id}
              order={order}
              first={index === 0}
              now={now}
              onStarted={() => heading.current?.focus()}
            />
          ))}
        </ol>
      )}
      {state === "COMPLETED" && (
        <nav
          className="kitchen-pagination"
          aria-label="Completed history pages"
        >
          <span role="status">
            Page {cursors.length} · Up to 12 orders per page
          </span>
          <div>
            <button
              className="secondary-button"
              disabled={cursors.length === 1 || queue.isFetching}
              onClick={() => {
                setCursors((pages) => pages.slice(0, -1));
                historyHeading.current?.focus();
              }}
            >
              <FiChevronLeft aria-hidden="true" /> Previous
            </button>
            <button
              className="secondary-button"
              disabled={!queue.hasNextPage || queue.isFetching}
              onClick={() => {
                setCursors((pages) => [
                  ...pages,
                  queue.data?.pages[0].nextCursor ?? null,
                ]);
                historyHeading.current?.focus();
              }}
            >
              Next <FiChevronRight aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
      {selected && state === "COMPLETED" && (
        <TicketDetails
          order={selected}
          now={now}
          onClose={() => {
            setSelected(null);
            detailTrigger.current?.focus();
          }}
        />
      )}
      {state !== "COMPLETED" && queue.hasNextPage && (
        <div className="kitchen-load-more">
          <button
            className="secondary-button"
            disabled={queue.isFetching}
            onClick={() => void queue.fetchNextPage()}
          >
            {queue.isFetchingNextPage ? "Loading more…" : "Load more orders"}
          </button>
          <p>Earlier tickets always stay at the top.</p>
        </div>
      )}
    </section>
  );
}

function HistorySearch({
  onApply,
}: {
  onApply: (filters: HistoryFilters) => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      className="kitchen-history-filters"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const search = String(data.get("search") ?? "").trim();
        const start = String(data.get("from") ?? ""),
          end = String(data.get("to") ?? "");
        if (start && end && start > end) {
          setError("The end date must be on or after the start date.");
          return;
        }
        const from = start ? new Date(`${start}T00:00:00`) : undefined;
        const to = end ? new Date(`${end}T00:00:00`) : undefined;
        if (to) to.setDate(to.getDate() + 1);
        setError("");
        onApply({
          ...(search ? { search } : {}),
          ...(from ? { from: from.toISOString() } : {}),
          ...(to ? { to: to.toISOString() } : {}),
        });
      }}
      onReset={() => {
        setError("");
        onApply({});
      }}
    >
      <label className="kitchen-history-search">
        Order number
        <div>
          <FiSearch aria-hidden="true" />
          <input
            name="search"
            type="search"
            placeholder="Search ORD-000016"
            maxLength={32}
            pattern="[A-Za-z0-9-]*"
          />
        </div>
      </label>
      <label>
        From
        <input name="from" type="date" />
      </label>
      <label>
        To
        <input name="to" type="date" />
      </label>
      <button className="primary-button" type="submit">
        Find orders
      </button>
      <button className="secondary-button" type="reset">
        Clear filters
      </button>
      {error && (
        <div className="kitchen-history-filter-error">
          <InlineMessage>{error}</InlineMessage>
        </div>
      )}
    </form>
  );
}
function TicketDetails({
  order,
  now,
  onClose,
}: {
  order: PreparationQueueResponse["orders"][number];
  now: number;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="kitchen-details"
      aria-label={`Details for ${order.orderNumber}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <span className="section-label">COMPLETED ORDER</span>
        <button autoFocus className="secondary-button" onClick={onClose}>
          <FiX aria-hidden="true" /> Close details
        </button>
      </header>
      <ol className="kitchen-tickets">
        <Ticket order={order} first={false} now={now} onStarted={() => {}} />
      </ol>
    </dialog>
  );
}

function Ticket({
  order,
  first,
  now,
  onStarted,
}: {
  order: PreparationQueueResponse["orders"][number];
  first: boolean;
  now: number;
  onStarted: () => void;
}) {
  const client = useQueryClient();
  const { role, shopId } = useActiveShop();
  const user = client.getQueryData<CurrentUserResponse>(currentUserKey)!.user;
  const preparing = order.preparationStatus === "PREPARING";
  const ready = order.preparationStatus === "READY";
  const completed = order.preparationStatus === "COMPLETED";
  const readyLabel =
    order.mode === "TAKEOUT" ? "Ready for pickup" : "Ready to serve";
  const mutationKey = ["kitchen", "transition", user.id, shopId, order.id];
  const pending = useIsMutating({ mutationKey }) > 0;
  const sameActor = (request: TransitionRequest) =>
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
    request.actorId;
  const finishTransition = async (
    request: TransitionRequest,
    message: string,
  ) => {
    if (!sameActor(request)) return;
    const prefix = ["kitchen", "queue", request.actorId, request.shopId];
    await client.cancelQueries({ queryKey: prefix });
    if (!sameActor(request)) return;
    client.setQueryData<InfiniteData<PreparationQueueResponse>>(
      [...prefix, request.source],
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            orders: page.orders.filter((item) => item.id !== request.orderId),
          })),
        },
    );
    feedback.toast(message);
    onStarted();
    await client.invalidateQueries({ queryKey: prefix });
  };
  const transition = useMutation<TransitionResult, Error, TransitionRequest>({
    mutationKey,
    mutationFn: async (request) =>
      request.source === "QUEUED"
        ? startPreparing(request.shopId, request.orderId)
        : request.source === "PREPARING"
          ? markReady(request.shopId, request.orderId)
          : completeOrder(request.shopId, request.orderId),
    retry: false,
    onSuccess: (result, request) =>
      finishTransition(
        request,
        "alreadyStarted" in result
          ? result.alreadyStarted
            ? "This order is already preparing."
            : `Preparation started for ${request.orderNumber}.`
          : "alreadyReady" in result
            ? result.alreadyReady
              ? "This order is already ready."
              : `${request.orderNumber}: ${request.mode === "TAKEOUT" ? "ready for pickup" : "ready to serve"}.`
            : result.alreadyCompleted
              ? "This order is already completed."
              : `${request.orderNumber} completed.`,
      ),
    onError: (_error, request) => {
      if (!sameActor(request)) return;
      void client.invalidateQueries({
        queryKey: ["kitchen", "queue", request.actorId, request.shopId],
      });
    },
  });
  const submit = (source: TransitionRequest["source"]) => {
    if (client.isMutating({ mutationKey })) return;
    transition.mutate({
      source,
      actorId: user.id,
      shopId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      mode: order.mode,
    });
  };
  const minutes = Math.max(
    0,
    Math.floor((now - Date.parse(order.queuedAt)) / 60_000),
  );
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <li className={`kitchen-ticket${first ? " kitchen-ticket-first" : ""}`}>
      <article aria-label={`Order ${order.orderNumber}`}>
        <div
          className={`kitchen-ticket-ribbon${completed ? " kitchen-ribbon-completed" : preparing ? " kitchen-ribbon-preparing" : ready ? " kitchen-ribbon-ready" : ""}`}
        >
          <span>
            <span className="kitchen-status-dot" />
            {completed
              ? "COMPLETED · FULFILLED"
              : preparing
                ? "PREPARING · IN PROGRESS"
                : ready
                  ? "READY · PREPARATION COMPLETE"
                  : "QUEUED · NOT STARTED"}
          </span>
          {first && (
            <span>{completed ? "Latest completion" : "Oldest ticket"}</span>
          )}
        </div>
        <header className="kitchen-ticket-header">
          <h3>{order.orderNumber}</h3>
          <div className="kitchen-ticket-context">
            {order.mode === "DINE_IN" ? (
              <FiCoffee aria-hidden="true" />
            ) : (
              <FiShoppingBag aria-hidden="true" />
            )}
            <strong>
              {order.mode === "DINE_IN"
                ? `Table ${order.tableNumber}`
                : "Pickup"}
            </strong>
            <span>{order.mode === "DINE_IN" ? "Dine-in" : "Takeout"}</span>
          </div>
          <p className="kitchen-wait">
            <FiClock aria-hidden="true" />
            {preparing || ready || completed
              ? "Queued"
              : minutes < 1
                ? "Just queued"
                : `${minutes} min waiting`}
            <span> · </span>
            <time
              dateTime={order.queuedAt}
              title={new Date(order.queuedAt).toLocaleString()}
            >
              {time(order.queuedAt)}
            </time>
          </p>
        </header>
        {completed && order.completedAt && (
          <div className="kitchen-completed-time">
            <FiCheck aria-hidden="true" />
            <div>
              <strong>
                {order.mode === "TAKEOUT"
                  ? "Collected by customer"
                  : "Served to customer"}
              </strong>
              <span>
                Completed{" "}
                <time dateTime={order.completedAt}>
                  {new Date(order.completedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </span>
            </div>
          </div>
        )}
        {ready && order.preparationReadyAt && (
          <div className="kitchen-ready-time">
            <FiCheck aria-hidden="true" />
            <div>
              <strong>{readyLabel}</strong>
              <span>
                Ready since{" "}
                <time
                  dateTime={order.preparationReadyAt}
                  title={new Date(order.preparationReadyAt).toLocaleString()}
                >
                  {time(order.preparationReadyAt)}
                </time>{" "}
                ·{" "}
                {Math.max(
                  0,
                  Math.floor(
                    (now - Date.parse(order.preparationReadyAt)) / 60_000,
                  ),
                )}{" "}
                min ago
              </span>
              <span>
                Preparation complete · Awaiting{" "}
                {order.mode === "TAKEOUT" ? "collection" : "table service"}
              </span>
            </div>
          </div>
        )}
        {preparing && order.preparationStartedAt && (
          <div className="kitchen-start-time">
            <FiPlay aria-hidden="true" />
            <div>
              <strong>
                Preparing for{" "}
                {Math.max(
                  0,
                  Math.floor(
                    (now - Date.parse(order.preparationStartedAt)) / 60_000,
                  ),
                )}{" "}
                min
              </strong>
              <span>
                Started{" "}
                <time
                  dateTime={order.preparationStartedAt}
                  title={new Date(order.preparationStartedAt).toLocaleString()}
                >
                  {time(order.preparationStartedAt)}
                </time>
              </span>
            </div>
          </div>
        )}
        <ul className="kitchen-items">
          {order.items.map((item, index) => (
            <li key={index}>
              <span
                className="kitchen-quantity"
                aria-label={`Quantity ${item.quantity}`}
              >
                {item.quantity}×
              </span>
              <div className="kitchen-item-detail">
                <h4>{item.productName}</h4>
                {(item.variants.length > 0 || item.addOns.length > 0) && (
                  <ul className="kitchen-modifiers">
                    {item.variants.map((variant) => (
                      <li key={`v-${variant.id}`}>{variant.name}</li>
                    ))}
                    {item.addOns.map((addOn) => (
                      <li key={`a-${addOn.id}`}>+ {addOn.name}</li>
                    ))}
                  </ul>
                )}
                {item.notes && (
                  <div className="kitchen-note">
                    <FiFileText aria-hidden="true" />
                    <div>
                      <span>ITEM NOTE</span>
                      <p>{item.notes}</p>
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <footer className="kitchen-ticket-footer">
          <span>
            {count} {count === 1 ? "item" : "items"}
          </span>
          <span>
            Cashier accepted · Paid <FiCheck aria-hidden="true" />
          </span>
        </footer>
        {order.preparationStatus === "QUEUED" &&
          hasShopPermission(role, "shop.preparation.status.update") && (
            <div className="kitchen-ticket-action">
              <button
                className="primary-button"
                disabled={pending}
                onClick={() => submit("QUEUED")}
                aria-label={`Start preparing ${order.orderNumber}`}
              >
                <FiPlay aria-hidden="true" />
                {pending ? "Action pending…" : "Start preparing"}
              </button>
              {transition.isError &&
                transition.variables.source === "QUEUED" && (
                  <InlineMessage>
                    Couldn’t confirm preparation start.{" "}
                    {transition.error.message} Refresh to check its saved
                    status; retrying preserves any recorded start.
                  </InlineMessage>
                )}
            </div>
          )}
        {preparing &&
          hasShopPermission(role, "shop.preparation.status.update") && (
            <div className="kitchen-ticket-action">
              <button
                className="primary-button"
                disabled={pending}
                onClick={() => submit("PREPARING")}
                aria-label={`Mark ready ${order.orderNumber}`}
              >
                <FiCheck aria-hidden="true" />
                {pending ? "Action pending…" : "Mark ready"}
              </button>
              {transition.isError &&
                transition.variables.source === "PREPARING" && (
                  <InlineMessage>
                    Couldn’t confirm readiness. {transition.error.message}{" "}
                    Refresh to check its saved status; retrying preserves any
                    recorded ready time.
                  </InlineMessage>
                )}
            </div>
          )}
        {ready && hasShopPermission(role, "shop.preparation.status.update") && (
          <div className="kitchen-ticket-action">
            <p className="kitchen-completion-hint">
              Only complete after the customer has received this order.
            </p>
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => submit("READY")}
              aria-label={`Mark completed ${order.orderNumber}`}
            >
              <FiCheck aria-hidden="true" />
              {pending
                ? "Action pending…"
                : order.mode === "TAKEOUT"
                  ? "Mark collected"
                  : "Mark served"}
            </button>
            {transition.isError && transition.variables.source === "READY" && (
              <InlineMessage>
                Couldn’t confirm completion. {transition.error.message} Refresh
                to check its saved status; retrying preserves any recorded
                completion.
              </InlineMessage>
            )}
          </div>
        )}
      </article>
    </li>
  );
}
