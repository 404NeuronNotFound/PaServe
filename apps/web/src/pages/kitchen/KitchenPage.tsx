import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link, Navigate, useLocation } from "react-router-dom";
import { FiArrowDown, FiCheck, FiClock, FiCoffee, FiFileText, FiRefreshCw, FiShoppingBag } from "react-icons/fi";
import type { CurrentUserResponse, PreparationQueueResponse } from "@paserve/contracts";
import { currentUserKey } from "../../features/auth/api/session";
import { useActiveShop } from "../../features/shops/active-shop";
import { getPreparationQueue } from "../../features/kitchen/queue";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "./kitchen.css";

const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function KitchenPage() {
  const membership = useActiveShop();
  return <NewOrders key={membership.shopId} />;
}

function NewOrders() {
  const { shopId, shop } = useActiveShop();
  const user = useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user;
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    document.title = `New orders · ${shop.name} · PaServe`;
    heading.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [shop.name]);
  const queue = useInfiniteQuery({
    queryKey: ["kitchen", "queue", user.id, shopId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => getPreparationQueue(shopId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    retry: false, gcTime: 0, staleTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: "always", refetchInterval: 15_000,
  });
  const status = isAxiosError(queue.error) ? queue.error.response?.status : undefined;
  if (status === 401) return <Navigate to="/login" replace state={{ returnTo: location.pathname }} />;
  if (status === 403 || status === 404) return <section className="dashboard-status">
    <h1>Kitchen access required</h1><p role="alert">Your access to this shop is unavailable. Choose a shop with an active kitchen, owner, admin, or manager membership.</p>
    <Link className="secondary-button" to="/app/shops">Choose another shop</Link>
  </section>;
  const orders = [...new Map(queue.data?.pages.flatMap((page) => page.orders).map((order) => [order.id, order])).values()]
    .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt) || a.id.localeCompare(b.id));
  return <section className="kitchen-workspace">
    <header className="kitchen-heading">
      <div><p className="section-label">KITCHEN / BARISTA</p><h1 ref={heading} tabIndex={-1}>New orders<span>.</span></h1>
        <p>The next great order starts here.</p></div>
      <div className="kitchen-refresh"><button className="secondary-button" disabled={queue.isFetching} onClick={() => void queue.refetch()}>
        <FiRefreshCw aria-hidden="true" />{queue.isFetching ? "Refreshing…" : "Refresh orders"}</button>
        <span role="status">{queue.dataUpdatedAt ? `Last checked ${time(new Date(queue.dataUpdatedAt).toISOString())} · checks every 15s` : "Connecting to your queue"}</span></div>
    </header>
    <div className="kitchen-brief">
      <div className="kitchen-brief-icon"><FiCoffee aria-hidden="true" /></div>
      <div><span className="section-label">THE PREPARATION QUEUE</span><h2>One ticket. Every detail.</h2><p>Confirmed, paid, and ready for your attention.</p></div>
      <div className="kitchen-order-count"><strong>{queue.data ? `${orders.length}${queue.hasNextPage ? "+" : ""}` : "—"}</strong><span>{queue.hasNextPage ? "orders loaded" : "orders waiting"}</span></div>
    </div>
    <div className="kitchen-queue-heading"><h2>Queued <span>{queue.data ? orders.length : "—"}</span></h2><p><FiArrowDown aria-hidden="true" /> Oldest first · queue arrival time</p></div>
    {queue.isPending && <div className="kitchen-empty" role="status"><FiCoffee aria-hidden="true" /><h2>Gathering your tickets…</h2><p>Loading the saved preparation queue.</p></div>}
    {queue.isError && <InlineMessage>{queue.data ? "The queue could not refresh. Tickets below may be out of date. " : "We couldn’t load the queue. "}{queue.error.message} <button className="secondary-button" disabled={queue.isFetching} onClick={() => void (queue.isFetchNextPageError ? queue.fetchNextPage() : queue.refetch())}>Try again</button></InlineMessage>}
    {queue.isSuccess && orders.length === 0 && <div className="kitchen-empty"><span className="kitchen-empty-icon"><FiCheck aria-hidden="true" /></span><h2>A little room to breathe.</h2><p>No orders are queued. Newly confirmed and paid orders will appear here.</p></div>}
    <ol className="kitchen-tickets" aria-label="New orders, oldest first">
      {orders.map((order, index) => <Ticket key={order.id} order={order} first={index === 0} now={now} />)}
    </ol>
    {queue.hasNextPage && <div className="kitchen-load-more"><button className="secondary-button" disabled={queue.isFetching} onClick={() => void queue.fetchNextPage()}>{queue.isFetchingNextPage ? "Loading more…" : "Load more orders"}</button><p>Earlier tickets always stay at the top.</p></div>}
  </section>;
}

function Ticket({ order, first, now }: { order: PreparationQueueResponse["orders"][number]; first: boolean; now: number }) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(order.queuedAt)) / 60_000));
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return <li className={`kitchen-ticket${first ? " kitchen-ticket-first" : ""}`}>
    <article aria-label={`Order ${order.orderNumber}`}>
      <div className="kitchen-ticket-ribbon"><span><span className="kitchen-status-dot" />QUEUED</span>{first && <span>Oldest ticket</span>}</div>
      <header className="kitchen-ticket-header"><h3>{order.orderNumber}</h3><div className="kitchen-ticket-context">{order.mode === "DINE_IN" ? <FiCoffee aria-hidden="true" /> : <FiShoppingBag aria-hidden="true" />}<strong>{order.mode === "DINE_IN" ? `Table ${order.tableNumber}` : "Pickup"}</strong><span>{order.mode === "DINE_IN" ? "Dine-in" : "Takeout"}</span></div>
        <p className="kitchen-wait"><FiClock aria-hidden="true" />{minutes < 1 ? "Just queued" : `${minutes} min waiting`}<span> · </span><time dateTime={order.queuedAt} title={new Date(order.queuedAt).toLocaleString()}>{time(order.queuedAt)}</time></p></header>
      <ul className="kitchen-items">{order.items.map((item, index) => <li key={index}>
        <span className="kitchen-quantity" aria-label={`Quantity ${item.quantity}`}>{item.quantity}×</span><div className="kitchen-item-detail"><h4>{item.productName}</h4>
          {(item.variants.length > 0 || item.addOns.length > 0) && <ul className="kitchen-modifiers">{item.variants.map((variant) => <li key={`v-${variant.id}`}>{variant.name}</li>)}{item.addOns.map((addOn) => <li key={`a-${addOn.id}`}>+ {addOn.name}</li>)}</ul>}
          {item.notes && <div className="kitchen-note"><FiFileText aria-hidden="true" /><div><span>ITEM NOTE</span><p>{item.notes}</p></div></div>}</div>
      </li>)}</ul>
      <footer className="kitchen-ticket-footer"><span>{count} {count === 1 ? "item" : "items"}</span><span>Paid <FiCheck aria-hidden="true" /></span></footer>
    </article>
  </li>;
}
