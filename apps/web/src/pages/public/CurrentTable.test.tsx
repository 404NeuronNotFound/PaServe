import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurrentTable } from "./CurrentTable";

it("announces the table and shop without exposing codes or tokens", () => {
  render(
    <CurrentTable
      shopName="Cafe"
      table={{
        shopSlug: "cafe",
        code: "T12",
        number: "Patio 4",
        checkoutToken: "private-context",
      }}
    />,
  );
  const status = screen.getByRole("status", { name: "Current table" });
  expect(status).toHaveTextContent("Ordering for Table Patio 4");
  expect(status).toHaveTextContent("Dine-in at Cafe");
  expect(status).not.toHaveTextContent("T12");
  expect(status).not.toHaveTextContent("private-context");
});
