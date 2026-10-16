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
export const receiptPath = (slug: string, id: string) => `${trackingPath(slug, id)}/receipt`;
export const trackingApiUrl = (path: string) =>
  `${(api.defaults?.baseURL ?? "").replace(/\/$/, "")}${path}`;
export const isTrackingOrderId = (id: unknown): id is string =>
  typeof id === "string" && uuid.test(id);

/** Navigation hints only. HttpOnly cookies, verified by the API, authorize reads. */
export function readActiveOrders(slug: string): ActiveOrder[] {
  const seen = new Set<string>();
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
        isTrackingOrderId(entry.id) &&
        isValidOrderNumber(entry.orderNumber) &&
        Number.isFinite(entry.expiresAt) &&
        entry.expiresAt > Date.now(),
    )
    .filter(({ id }) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
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
    !isTrackingOrderId(id) ||
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
function rememberRedemption(path: string, promise: Promise<void>) {
  redemptions.set(path, promise);
  void promise
    .finally(() => {
      if (redemptions.get(path) === promise) redemptions.delete(path);
    })
    .catch(() => {});
  return promise;
}
export function redeemTrackingLink(slug: string, id: string): Promise<void> {
  const path = trackingPath(slug, id);
  const pending = redemptions.get(path);
  if (!window.location.hash.startsWith("#tracking="))
    return pending ?? Promise.resolve();
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
    return rememberRedemption(
      path,
      Promise.reject(new Error("Invalid tracking link")),
    );
  }
  if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    return rememberRedemption(
      path,
      Promise.reject(new Error("Invalid tracking link")),
    );
  // Serialize exchanges for one order so an earlier response cannot overwrite
  // the cookie established by a more recently opened private link.
  const promise = (pending ? pending.catch(() => {}) : Promise.resolve())
    .then(() =>
      fetch(trackingApiUrl(`${path}/tracking-session`), {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        referrerPolicy: "no-referrer",
      }),
    )
    .then((response) => {
      if (!response.ok) throw new Error("Tracking access unavailable");
    });
  return rememberRedemption(path, promise);
}
