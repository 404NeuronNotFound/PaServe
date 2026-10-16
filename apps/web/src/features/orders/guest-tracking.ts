import { api } from "../../lib/api/client";
import { isValidOrderNumber } from "@paserve/contracts";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ActiveOrder = { id: string; orderNumber: string; expiresAt: number };
const memory = new Map<string, ActiveOrder[]>();
const key = (slug: string) =>
  `paserve-active-orders:v1:${encodeURIComponent(slug)}`;
export const trackingPath = (slug: string, id: string) =>
  `/menu/${encodeURIComponent(slug)}/orders/${encodeURIComponent(id)}`;
export const trackingApiUrl = (path: string) =>
  `${(api.defaults?.baseURL ?? "").replace(/\/$/, "")}${path}`;
export const isTrackingOrderId = (id: string) => uuid.test(id);

/** Navigation hints only. HttpOnly cookies, verified by the API, authorize reads. */
export function readActiveOrders(slug: string): ActiveOrder[] {
  let values: unknown = memory.get(slug) ?? [];
  try {
    const raw = localStorage.getItem(key(slug));
    values = raw && raw.length <= 8192 ? JSON.parse(raw) : [];
  } catch {
    /* Memory still works if storage is blocked. */
  }
  return (Array.isArray(values) ? values : [])
    .filter(
      (entry): entry is ActiveOrder =>
        !!entry &&
        typeof entry === "object" &&
        uuid.test(entry.id) &&
        isValidOrderNumber(entry.orderNumber) &&
        Number.isFinite(entry.expiresAt) &&
        entry.expiresAt > Date.now(),
    )
    .slice(0, 20)
    .map(({ id, orderNumber, expiresAt }) => ({ id, orderNumber, expiresAt }));
}
function write(slug: string, entries: ActiveOrder[]) {
  memory.set(slug, entries);
  try {
    localStorage.setItem(key(slug), JSON.stringify(entries));
  } catch {
    /* No credential is stored here. */
  }
}
export function rememberActiveOrder(
  slug: string,
  id: string,
  orderNumber: string | null,
  expiresAt: number,
) {
  if (
    !uuid.test(id) ||
    !isValidOrderNumber(orderNumber) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  )
    return;
  write(
    slug,
    [
      { id, orderNumber, expiresAt },
      ...readActiveOrders(slug).filter((entry) => entry.id !== id),
    ].slice(0, 20),
  );
}
export function forgetActiveOrder(slug: string, id: string) {
  write(
    slug,
    readActiveOrders(slug).filter((entry) => entry.id !== id),
  );
}

// StrictMode/repeated mounts share an in-flight redemption without retaining secrets.
const redemptions = new Map<string, Promise<void>>();
export function redeemTrackingLink(slug: string, id: string): Promise<void> {
  const path = trackingPath(slug, id);
  const pending = redemptions.get(path);
  if (pending) return pending;
  if (!window.location.hash.startsWith("#tracking=")) return Promise.resolve();
  const fragment = window.location.hash;
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  let token: string;
  try {
    token = decodeURIComponent(fragment.slice(10));
  } catch {
    return Promise.reject(new Error("Invalid tracking link"));
  }
  if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    return Promise.reject(new Error("Invalid tracking link"));
  const promise = fetch(trackingApiUrl(`${path}/tracking-session`), {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    referrerPolicy: "no-referrer",
  }).then((response) => {
    if (!response.ok) throw new Error("Tracking access unavailable");
  });
  redemptions.set(path, promise);
  void promise.finally(() => redemptions.delete(path)).catch(() => {});
  return promise;
}
