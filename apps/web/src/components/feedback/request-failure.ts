import { isAxiosError } from "axios";
import { UnverifiedResponseError } from "../../lib/api/UnverifiedResponseError";

export type RequestFailure = {
  kind: "network" | "server" | "session" | "permission" | "unavailable" | "expired" | "validation" | "conflict" | "rate-limit" | "unverified" | "unknown";
  title: string;
  message: string;
  retryable: boolean;
};

/** Describes reads/quotes only. Never use retryable to authorize repeating a write. */
export function describeRequestFailure(error: unknown, resource: string, options: {
  product?: boolean;
  qr?: boolean;
  permissionMessage?: string;
  unavailableMessage?: string;
  action?: "load" | "refresh";
  publicView?: boolean;
} = {}): RequestFailure {
  if (error instanceof UnverifiedResponseError) return {
    kind: "unverified", title: "Saved information could not be verified",
    message: `The saved ${resource} could not be verified. Refresh before relying on these details.`, retryable: true,
  };
  const response = isAxiosError(error) ? error.response : undefined;
  const status = response?.status;
  const code: unknown = response?.data?.code;
  if (status === 401 && options.publicView) return {
    kind: "permission", title: "Menu access unavailable",
    message: `Access to ${resource} is unavailable. Return to the menu or ask the shop staff for the current link.`, retryable: false,
  };
  if (status === 401) return {
    kind: "session", title: "Your session has expired",
    message: `Sign in again to load ${resource}. Your access must be checked before continuing.`, retryable: false,
  };
  if (options.qr && (status === 410 || ((status === 400 || status === 403) && code === "ORDER_TOKEN_INVALID"))) return {
    kind: status === 410 ? "expired" : "unavailable", title: "Order QR unavailable",
    message: "This order QR is invalid or expired. Ask the counter staff to look up the order number; scanning the same code again will not renew it.", retryable: false,
  };
  if (options.product && (status === 404 || (status && status < 500 && code === "PRODUCT_NOT_AVAILABLE"))) return {
    kind: "unavailable", title: "Product unavailable",
    message: "This product is no longer available on this menu. Return to the menu and choose another item, or ask staff about availability.", retryable: false,
  };
  if (status === 403) return {
    kind: "permission", title: "Access unavailable",
    message: options.permissionMessage ?? (options.publicView
      ? `Access to ${resource} is unavailable. Ask the shop staff to check the current menu or product availability.`
      : `You do not have permission to load ${resource}. Choose another shop or ask its owner to check your access.`), retryable: false,
  };
  if (status === 404 || status === 410) return {
    kind: "unavailable", title: `${resource} unavailable`,
    message: options.unavailableMessage ?? `These saved details are no longer available, or your access has changed. Return to the previous view and check the current information.`, retryable: false,
  };
  if (status === 400 || status === 422) return {
    kind: "validation", title: "Check your selection",
    message: options.product
      ? "The selected options or quantity are no longer valid. Refresh product details, check the available choices and try again."
      : "Some requested details are invalid. Check the highlighted fields or the link you opened before trying again.", retryable: false,
  };
  if (status === 409) return {
    kind: "conflict", title: "The saved information changed",
    message: `Refresh ${resource} to see the current information before continuing.`, retryable: true,
  };
  if (status === 429) return {
    kind: "rate-limit", title: "Please wait before trying again",
    message: `Too many requests were made for ${resource}. Wait a little, then retry.`, retryable: true,
  };
  if (status && status >= 500) return {
    kind: "server", title: "The service is temporarily unavailable",
    message: `The server could not load ${resource}. Please try again shortly.`, retryable: true,
  };
  if (status === 408 || (isAxiosError(error) && !response)) return {
    kind: "network", title: "Connection interrupted",
    message: `We could not connect to load ${resource}. Check your connection and try again.`, retryable: true,
  };
  return {
    kind: "unknown", title: `Unable to display ${resource}`,
    message: `We couldn’t ${options.action ?? "load"} ${resource}. Check your connection and try again, or return to the previous view if the problem continues.`, retryable: true,
  };
}
