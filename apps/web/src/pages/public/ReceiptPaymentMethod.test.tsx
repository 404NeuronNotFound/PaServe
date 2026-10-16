import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { parseReceiptPaymentDetails } from "@paserve/contracts";
import { ReceiptPaymentMethod } from "./ReceiptPaymentMethod";

afterEach(cleanup);
it.each([['20.00', '8.00', '₱8.00'], ['12.00', '0.00', '₱0.00'], ['20.00', '0.30', '₱0.30']])(
  'displays backend cash change %s / %s', (amountReceived, changeDue, formatted) => {
    render(<ReceiptPaymentMethod payment={{ method: 'CASH', reference: null, description: null, amountReceived, changeDue }} confirmed />);
    expect(screen.getByText(`Change (PHP): ${formatted}`)).toBeInTheDocument();
  },
);
it.each(['-0.01', 'NaN', '8', '10000000000.00', '21.00'])(
  'rejects invalid or excessive saved change %s', (changeDue) => {
    expect(parseReceiptPaymentDetails({ method: 'CASH', amountReceived: '20.00', changeDue })).toBeNull();
  },
);
it.each([['0.00', '₱0.00'], ['20.00', '₱20.00'], ['9999999999.99', '₱9,999,999,999.99']])(
  'displays saved cash tender %s exactly', (amountReceived, formatted) => {
    render(<ReceiptPaymentMethod payment={{ method: 'CASH', reference: null, description: null, amountReceived }} confirmed />);
    expect(screen.getByText(`Amount received (PHP): ${formatted}`)).toBeInTheDocument();
  },
);
it.each(['-1.00', 'NaN', '20', '10000000000.00'])(
  'rejects malformed cash tender %s', (amountReceived) => {
    expect(parseReceiptPaymentDetails({ method: 'CASH', amountReceived })).toBeNull();
  },
);
it.each(['GCASH_MANUAL', 'CARD_MANUAL', 'OTHER'])(
  'does not show cash tender for %s', (method) => {
    const payment = parseReceiptPaymentDetails({ method, amountReceived: '20.00', changeDue: '8.00' });
    render(<ReceiptPaymentMethod payment={payment} confirmed />);
    expect(screen.queryByText(/Amount received/)).not.toBeInTheDocument();
    expect(payment).not.toHaveProperty('amountReceived');
    expect(payment).not.toHaveProperty('changeDue');
    expect(screen.queryByText(/Change/)).not.toBeInTheDocument();
  },
);
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
  view.rerender(<ReceiptPaymentMethod payment={{ method: 'CASH', reference: null, description: null }} confirmed />);
  expect(screen.getByText('Amount received is unavailable in this saved receipt.')).toBeInTheDocument();
  expect(screen.getByText('Change is unavailable in this saved receipt.')).toBeInTheDocument();
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
it.each(["4111.1111.1111.1111", "4111/1111/1111/1111", "4111–1111–1111–1111"])(
  "omits a payment card disguised as a punctuated GCash reference: %s", (reference) => {
    expect(parseReceiptPaymentDetails({ method: "GCASH_MANUAL", reference })?.reference).toBeNull();
  },
);
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
