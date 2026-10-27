import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotChallenge } from "./BotChallenge";

type Options = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
let options: Options;
const remove = vi.fn();
const renderWidget = vi.fn((_element: HTMLElement, configuration: Options) => { options = configuration; return "widget"; });
beforeEach(() => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
  remove.mockClear();
  renderWidget.mockClear();
  vi.stubGlobal("turnstile", { render: renderWidget, remove });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("renders an explicit action-bound widget and clears expired tokens until a manual retry", async () => {
  const onToken = vi.fn();
  render(<BotChallenge action="login" onToken={onToken} />);
  await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
  expect(options.action).toBe("login");
  expect(options["response-field"]).toBe(false);
  expect(options.retry).toBe("never");
  act(() => options.callback("single-use-proof"));
  expect(onToken).toHaveBeenLastCalledWith("single-use-proof");
  act(() => options["expired-callback"]());
  expect(onToken).toHaveBeenLastCalledWith("");
  expect(screen.getByRole("alert")).toHaveTextContent("expired");
  fireEvent.click(screen.getByRole("button", { name: "Retry security check" }));
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
  expect(remove).toHaveBeenCalledWith("widget");
});
it("shows recoverable provider errors and ignores callbacks after unmount", async () => {
  const onToken = vi.fn();
  const view = render(<BotChallenge action="register" onToken={onToken} />);
  await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
  act(() => { options["error-callback"](); });
  expect(screen.getByRole("alert")).toHaveTextContent("could not complete");
  onToken.mockClear();
  view.unmount();
  options.callback("late-proof");
  expect(onToken).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("widget");
});
it("fails closed without a configured key and does not load a third-party script", () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  render(<BotChallenge action="login" onToken={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
  expect(renderWidget).not.toHaveBeenCalled();
  expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
});
it("allows retry after a script failure without an automatic submission or script loop", async () => {
  vi.stubGlobal("turnstile", undefined);
  const onToken = vi.fn();
  render(<BotChallenge action="login" onToken={onToken} />);
  const script = document.querySelector('script[src*="challenges.cloudflare.com"]') as HTMLScriptElement;
  expect(script).not.toBeNull();
  fireEvent.error(script);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
  expect(script.isConnected).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Retry security check" }));
  await waitFor(() => expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).not.toBeNull());
  const retry = document.querySelector('script[src*="challenges.cloudflare.com"]') as HTMLScriptElement;
  expect(retry).not.toBe(script);
  fireEvent.error(retry);
  await screen.findByRole("alert");
  expect(onToken.mock.calls.every(([token]) => token === "")).toBe(true);
});
