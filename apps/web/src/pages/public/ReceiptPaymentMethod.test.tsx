import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { parseReceiptPaymentDetails } from "@paserve/contracts";
import { ReceiptPaymentMethod } from "./ReceiptPaymentMethod";

afterEach(cleanup);
it.each([
  ["CASH", "Cash"], ["GCASH_MANUAL", "GCash (manual)"], ["CARD_MANUAL", "Card (manual)"], ["OTHER", "Other"],
])("shows the recorded %s method and only relevant details", (method, label) => {
  const payment = parseReceiptPaymentDetails({ method, reference: "00001234", description: "Bank transfer", paidBy: "internal-user" });
  render(<ReceiptPaymentMethod payment={payment} confirmed />);
  expect(screen.getByText(label)).toBeInTheDocument();
  if (method === "CASH") expect(screen.queryByText(/00001234/)).not.toBeInTheDocument();
  else expect(screen.getByText(/00001234/)).toBeInTheDocument();
  if (method === "OTHER") expect(screen.getByText("Method details: Bank transfer")).toBeInTheDocument();
  else expect(screen.queryByText(/Bank transfer/)).not.toBeInTheDocument();
  expect(screen.queryByText("internal-user")).not.toBeInTheDocument();
});
it("distinguishes unpaid and older confirmed receipts without guessing a method", () => {
  const view = render(<ReceiptPaymentMethod payment={null} confirmed={false} />);
  expect(screen.getByText("No payment method has been recorded.")).toBeInTheDocument();
  view.rerender(<ReceiptPaymentMethod confirmed />);
  expect(screen.getByText("The recorded payment method is unavailable.")).toBeInTheDocument();
});
it.each(["4111111111111111", "CVV 123", "<script>bad</script>", "unsafe\nreference"])(
  "omits unsafe card reference %s", (reference) => {
    expect(parseReceiptPaymentDetails({ method: "CARD_MANUAL", reference })?.reference).toBeNull();
  },
);
it("preserves numeric GCash transaction IDs and omits unsafe Other descriptions", () => {
  expect(parseReceiptPaymentDetails({ method: "GCASH_MANUAL", reference: "0001234567890" })?.reference).toBe("0001234567890");
  expect(parseReceiptPaymentDetails({ method: "GCASH_MANUAL", reference: "CVV 123" })?.reference).toBeNull();
  expect(parseReceiptPaymentDetails({ method: "OTHER", description: "PIN 1234" })?.description).toBeNull();
  expect(parseReceiptPaymentDetails({ method: "UNKNOWN" })).toBeNull();
});
it.each(["GCASH_MANUAL", "CARD_MANUAL", "OTHER"])(
  "omits card/payment credentials from %s references and descriptions", (method) => {
    const credentials = ["4111111111111111", "4111 1111 1111 1111", "４１１１１１１１１１１１１１１１",
      "password receipt-secret", "OTP 123456", "Bearer private-token", "access_token private-token",
      "sk_live_receiptSecretExample", `payload.${"a".repeat(43)}`, "eyJhbGciOiJIUzI1NiJ9.payload.signature"];
    for (const reference of credentials) {
      const parsed = parseReceiptPaymentDetails({ method, reference, description: reference,
        cardNumber: reference, cvv: "123", pin: "1234", accessToken: "private-token" });
      expect(parsed).toEqual({ method, reference: null, description: null });
    }
  },
);
