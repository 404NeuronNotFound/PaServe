import { expect, it } from "vitest";
import { describeRequestFailure } from "./request-failure";
import { UnverifiedResponseError } from "../../lib/api/UnverifiedResponseError";

const failure = (status?: number, code?: string) => ({
  isAxiosError: true,
  ...(status ? { response: { status, data: { code, message: "private server stack / token" } } } : {}),
});

it.each([
  [undefined, "network", true], [408, "network", true], [500, "server", true],
  [503, "server", true], [401, "session", false], [403, "permission", false],
  [404, "unavailable", false], [400, "validation", false], [422, "validation", false],
  [409, "conflict", true], [429, "rate-limit", true],
] as const)("classifies status %s and exposes only safe read recovery", (status, kind, retryable) => {
  const result = describeRequestFailure(failure(status), "your orders");
  expect(result).toMatchObject({ kind, retryable });
  expect(result.message).not.toContain("private server stack");
});

it("distinguishes unavailable products from broken connections and invalid selections", () => {
  expect(describeRequestFailure(failure(404), "this product", { product: true })).toMatchObject({ kind: "unavailable", retryable: false });
  expect(describeRequestFailure(failure(409, "PRODUCT_NOT_AVAILABLE"), "this product", { product: true })).toMatchObject({ kind: "unavailable", retryable: false });
  expect(describeRequestFailure(failure(400, "PRODUCT_SELECTION_INVALID"), "this product", { product: true })).toMatchObject({ kind: "validation", retryable: false });
  expect(describeRequestFailure(failure(), "this product", { product: true }).kind).toBe("network");
});

it("does not mistake cashier permissions or server failures for an expired QR", () => {
  expect(describeRequestFailure(failure(403), "this order", { qr: true }).kind).toBe("permission");
  expect(describeRequestFailure(failure(403, "ORDER_TOKEN_INVALID"), "this order", { qr: true })).toMatchObject({ kind: "unavailable", retryable: false });
  expect(describeRequestFailure(failure(410), "this order", { qr: true })).toMatchObject({ kind: "expired", retryable: false });
  expect(describeRequestFailure(failure(500, "ORDER_TOKEN_INVALID"), "this order", { qr: true }).kind).toBe("server");
});

it("keeps arbitrary errors and response messages out of user-facing feedback", () => {
  expect(describeRequestFailure(new Error("secret"), "this menu").message).not.toContain("secret");
  expect(describeRequestFailure(new UnverifiedResponseError("private details"), "queue")).toMatchObject({ kind: "unverified", retryable: true });
  expect(describeRequestFailure(new UnverifiedResponseError("private details"), "queue").message).not.toContain("private details");
  expect(describeRequestFailure(failure(401), "this menu", { publicView: true })).toMatchObject({ kind: "permission", retryable: false });
  expect(describeRequestFailure(failure(403), "this product", { publicView: true, product: true }).message).toContain("shop staff");
});
