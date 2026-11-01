import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CurrentUser, ShopRole } from "@paserve/contracts";
import { KeybeenWalkthrough } from "./KeybeenWalkthrough";
import { accountSteps, shopSteps } from "./steps";
import { useSessionStore } from "../auth/stores/session";
import { getWalkthroughProgress, finishWalkthrough } from "./api";
vi.mock("./api", () => ({
  getWalkthroughProgress: vi.fn(),
  finishWalkthrough: vi.fn(),
}));
let sequence = 0;
const user = () =>
  ({
    id: "keybeen-test-" + ++sequence,
    email: "owner@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    createdAt: "2026-11-01",
    memberships: [],
  }) as CurrentUser;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  useSessionStore.setState({ accessToken: "test-access" });
  vi.mocked(getWalkthroughProgress).mockResolvedValue({ completedScopes: [] });
  vi.mocked(finishWalkthrough).mockResolvedValue({ scope: "account" });
});
afterEach(() => {
  cleanup();
  useSessionStore.setState({ accessToken: null });
});
function setup(account = user()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <KeybeenWalkthrough user={account} />
    </QueryClientProvider>,
  );
  return { account, client, actor: userEvent.setup() };
}
it("welcomes a first-time user, switches poses and saves a skipped tour", async () => {
  const { actor } = setup();
  const dialog = await screen.findByRole("dialog", {
    name: "Uy, welcome, Ada!",
  });
  expect(dialog.querySelector("svg[data-pose]")).toHaveAttribute(
    "data-pose",
    "wave",
  );
  expect(dialog).toHaveTextContent("Ako si Keybeen");
  await actor.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Your personal space");
  expect(
    screen.getByRole("dialog").querySelector("svg[data-pose]"),
  ).toHaveAttribute("data-pose", "think");
  await actor.click(screen.getByRole("button", { name: "Skip tour" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(finishWalkthrough).toHaveBeenCalledWith({
    kind: "account",
    outcome: "skipped",
  });
});
it("does not reopen a tour already completed on another device", async () => {
  vi.mocked(getWalkthroughProgress).mockResolvedValue({
    completedScopes: ["account"],
  });
  const { client, account } = setup();
  await waitFor(() =>
    expect(client.getQueryData(["keybeen", account.id, 1])).toEqual({
      completedScopes: ["account"],
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("finishes the account tour with the celebration pose and remembers it on remount", async () => {
  const { actor, account } = setup();
  await screen.findByRole("dialog");
  for (let i = 0; i < accountSteps().length - 1; i++)
    await actor.click(screen.getByRole("button", { name: "Next" }));
  expect(
    screen.getByRole("dialog").querySelector("svg[data-pose]"),
  ).toHaveAttribute("data-pose", "done");
  await actor.click(screen.getByRole("button", { name: "Tara, let's go!" }));
  await waitFor(() =>
    expect(finishWalkthrough).toHaveBeenCalledWith({
      kind: "account",
      outcome: "completed",
    }),
  );
  cleanup();
  setup(account);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("never shows a tour when progress could not be checked", async () => {
  vi.mocked(getWalkthroughProgress).mockRejectedValue(new Error("offline"));
  const { client, account } = setup();
  await waitFor(() =>
    expect(client.getQueryState(["keybeen", account.id, 1])?.status).toBe(
      "error",
    ),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it.each(["OWNER", "ADMIN", "MANAGER", "CASHIER", "KITCHEN"] as ShopRole[])(
  "builds a logical %s guide with a welcome and finish",
  (role) => {
    const steps = shopSteps(role, "Cafe");
    expect(steps[0].pose).toBe("wave");
    expect(steps.at(-1)?.pose).toBe("done");
    if (role === "CASHIER" || role === "KITCHEN") {
      expect(
        steps.some(
          (step) =>
            step.id === "staff" ||
            step.id === "settings" ||
            step.id === "products",
        ),
      ).toBe(false);
      expect(steps.some((step) => step.id === role.toLowerCase())).toBe(true);
    }
  },
);

it("highlights the actual control and points Keybeen toward it", async () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.walkthrough === "account-profile")
        return {
          left: 24,
          top: 120,
          right: 164,
          bottom: 164,
          width: 140,
          height: 44,
        } as DOMRect;
      return original.call(this);
    },
  );
  const target = document.createElement("button");
  target.dataset.walkthrough = "account-profile";
  target.textContent = "Profile target";
  document.body.appendChild(target);
  try {
    const { actor } = setup();
    await screen.findByRole("dialog");
    await actor.click(screen.getByRole("button", { name: "Next" }));
    await actor.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(document.querySelector(".keybeen-spotlight")).toHaveStyle({
        left: "18px",
        top: "114px",
        width: "152px",
        height: "56px",
      }),
    );
    expect(
      screen.getByRole("dialog").querySelector("svg[data-pose]"),
    ).toHaveAttribute("data-pose", "left");
  } finally {
    target.remove();
  }
});

it("keeps the account usable when progress has an unexpected response", async () => {
  vi.mocked(getWalkthroughProgress).mockResolvedValue(
    {} as Awaited<ReturnType<typeof getWalkthroughProgress>>,
  );
  const { client, account } = setup();
  await waitFor(() =>
    expect(client.getQueryState(["keybeen", account.id, 1])?.status).toBe(
      "success",
    ),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
