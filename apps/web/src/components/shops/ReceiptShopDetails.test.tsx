import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReceiptShopDetails } from "./ReceiptShopDetails";

afterEach(cleanup);
it("shows saved shop identity and optional contact information as text", () => {
  render(<ReceiptShopDetails details={{
    name: "Cafe Display", address: "12 Main Street\nManila", phone: "09171234567",
    contactEmail: "hello@example.com", website: "https://example.com",
  }} />);
  expect(screen.getByRole("region", { name: "Shop details" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cafe Display" })).toBeInTheDocument();
  expect(screen.getByText("12 Main Street Manila")).toBeInTheDocument();
  expect(screen.getByText("09171234567")).toBeInTheDocument();
  expect(screen.getByText("hello@example.com")).toBeInTheDocument();
  expect(screen.getByText("https://example.com")).toBeInTheDocument();
});
it("omits absent optional details without placeholders", () => {
  const { container } = render(<ReceiptShopDetails details={{
    name: "Cafe", address: null, phone: null, contactEmail: null, website: null,
  }} />);
  expect(screen.getByRole("heading", { name: "Cafe" })).toBeInTheDocument();
  expect(container.querySelector("dt")).toBeNull();
});
it("renders no empty shop section for legacy orders", () => {
  const { container } = render(<ReceiptShopDetails />);
  expect(container).toBeEmptyDOMElement();
});
