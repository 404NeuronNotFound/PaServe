import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installCropPlatform } from "../../test/crop-platform";
import { BrandImageCropper } from "./BrandImageCropper";
beforeEach(() => {
  installCropPlatform();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:source"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(["logo", "banner"] as const)(
  "exports the configured %s ratio and redraws when position and zoom change",
  async (kind) => {
    const onApply = vi.fn();
    render(
      <BrandImageCropper
        kind={kind}
        file={new File(["source"], "input.png", { type: "image/png" })}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );
    const apply = screen.getByRole("button", { name: "Use crop" });
    await waitFor(() => expect(apply).toBeEnabled());
    const canvas = screen.getByLabelText(
      `${kind} crop preview`,
    ) as HTMLCanvasElement;
    expect(canvas.width / canvas.height).toBe(kind === "logo" ? 1 : 3);
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), {
      target: { value: "2" },
    });
    fireEvent.change(
      screen.getByRole("slider", { name: "Horizontal position" }),
      { target: { value: "0" } },
    );
    const context = canvas.getContext("2d")!;
    expect(context.drawImage).toHaveBeenLastCalledWith(
      expect.anything(),
      0,
      expect.any(Number),
      kind === "logo" ? 450 : 600,
      kind === "logo" ? 450 : 200,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    await userEvent.setup().click(apply);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        name: `${kind}-cropped.png`,
        type: "image/png",
      }),
    );
  },
);
it("does not apply a cancelled crop and releases its temporary image", async () => {
  const onApply = vi.fn(),
    onClose = vi.fn();
  const { unmount } = render(
    <BrandImageCropper
      kind="logo"
      file={new File(["source"], "input.png")}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Cancel crop" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
});
it("rejects undecodable images before a crop can be used", async () => {
  vi.stubGlobal(
    "Image",
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    },
  );
  const onApply = vi.fn();
  render(
    <BrandImageCropper
      kind="logo"
      file={new File(["bad"], "bad.png")}
      onApply={onApply}
      onClose={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be opened",
  );
  expect(screen.getByRole("button", { name: "Use crop" })).toBeDisabled();
  expect(onApply).not.toHaveBeenCalled();
});
it("locks duplicate exports and retains the dialog if image encoding fails", async () => {
  let complete!: BlobCallback;
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      complete = callback;
    },
  );
  const onApply = vi.fn();
  render(
    <BrandImageCropper
      kind="banner"
      file={new File(["source"], "banner.png")}
      onApply={onApply}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use crop" })).toBeEnabled(),
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Use crop" }));
  expect(screen.getByRole("button", { name: "Preparing…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel crop" })).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  complete(null);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be prepared",
  );
  expect(onApply).not.toHaveBeenCalled();
});

it("allows cancellation after the browser throws during export", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {
    throw new Error("Encoding failed");
  });
  const onClose = vi.fn();
  render(
    <BrandImageCropper
      kind="logo"
      file={new File(["source"], "logo.png")}
      onApply={vi.fn()}
      onClose={onClose}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use crop" })).toBeEnabled(),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Use crop" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be prepared",
  );
  await user.click(screen.getByRole("button", { name: "Cancel crop" }));
  expect(onClose).toHaveBeenCalledOnce();
});
