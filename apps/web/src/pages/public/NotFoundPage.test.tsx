import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NotFoundPage } from "./NotFoundPage";
import { useSessionStore } from "../../features/auth/stores/session";

afterEach(() => {
  cleanup();
  useSessionStore.getState().setAccessToken(null);
  window.history.replaceState(null, "", "/");
});

it("focuses the error heading and gives a direct visitor a clear sign-in destination", () => {
  window.history.replaceState({ idx: 0 }, "", "/missing/path");
  render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
  expect(document.title).toBe("Page not found · PaServe");
  expect(screen.getByRole("heading", { name: "Page not found" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Skip to page content" })).toHaveAttribute("href", "#not-found-content");
  expect(screen.getByRole("switch", { name: "Dark appearance" })).toBeInTheDocument();
});

it("offers signed-in users their places through the normal protected route", () => {
  useSessionStore.getState().setAccessToken("test-access-token");
  render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Go to your places" })).toHaveAttribute("href", "/app/account/places");
  expect(screen.queryByRole("link", { name: "Go to sign in" })).not.toBeInTheDocument();
});

it("returns to the prior in-app page when browser-router history is available", async () => {
  window.history.replaceState({ idx: 1 }, "", "/missing/path");
  render(<MemoryRouter initialEntries={["/previous", "/missing/path"]} initialIndex={1}><Routes>
    <Route path="/previous" element={<h1>Previous page</h1>} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></MemoryRouter>);
  await userEvent.setup().click(screen.getByRole("button", { name: "Go back" }));
  expect(screen.getByRole("heading", { name: "Previous page" })).toBeInTheDocument();
});
