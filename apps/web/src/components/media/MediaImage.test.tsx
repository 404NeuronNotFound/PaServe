import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaImage } from "./MediaImage";
import { ShopBanner } from "../shops/ShopBanner";

afterEach(cleanup);
const props = { alt: "Latte", width: 400, height: 300, fallback: <span>Photo unavailable</span> };

it("reserves dimensions and defers secondary media without exposing referrers", () => {
  render(<MediaImage {...props} src="https://example.com/latte.webp" />);
  const image = screen.getByRole("img", { name: "Latte" });
  expect(image).toHaveAttribute("width", "400");
  expect(image).toHaveAttribute("height", "300");
  expect(image).toHaveAttribute("loading", "lazy");
  expect(image).toHaveAttribute("decoding", "async");
  expect(image).toHaveAttribute("fetchpriority", "low");
  expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
});
it("replaces a broken image and retries a changed source instead of hiding it permanently", () => {
  const { rerender } = render(<MediaImage {...props} src="/old.webp" />);
  fireEvent.error(screen.getByRole("img", { name: "Latte" }));
  expect(screen.getByText("Photo unavailable")).toBeVisible();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  rerender(<MediaImage {...props} src="/new.webp" />);
  expect(screen.getByRole("img", { name: "Latte" })).toHaveAttribute("src", "/new.webp");
  rerender(<MediaImage {...props} src="/old.webp" />);
  expect(screen.getByRole("img", { name: "Latte" })).toHaveAttribute("src", "/old.webp");
});
it("uses a fallback without requesting an empty URL", () => {
  render(<MediaImage {...props} src={null} />);
  expect(screen.getByText("Photo unavailable")).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
});
it("loads an explicitly requested detail or preview eagerly", () => {
  render(<MediaImage {...props} src="blob:preview" loading="eager" />);
  expect(screen.getByRole("img")).toHaveAttribute("loading", "eager");
  expect(screen.getByRole("img")).toHaveAttribute("fetchpriority", "auto");
});
it("keeps a failed banner frame by default and recovers when the shop asset changes", () => {
  const { container, rerender } = render(<ShopBanner url="/old-banner.webp" name="Cafe" />);
  fireEvent.error(screen.getByRole("img", { name: "Cafe banner" }));
  expect(container.querySelector(".shop-banner")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  rerender(<ShopBanner url="/new-banner.webp" name="Cafe" />);
  expect(screen.getByRole("img", { name: "Cafe banner" })).toHaveAttribute("src", "/new-banner.webp");
  rerender(<ShopBanner name="Cafe" />);
  expect(container.querySelector(".shop-banner")).toBeNull();
});
