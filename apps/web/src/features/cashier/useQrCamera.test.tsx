import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useQrCamera } from "./useQrCamera";
import { loadQrDecoder } from "./qr-decoder";

vi.mock("./qr-decoder", () => ({ loadQrDecoder: vi.fn() }));
const getUserMedia = vi.fn();
const decode = vi.fn();
const detected = vi.fn();
function media(id = "rear") {
  const track = new EventTarget();
  return {
    track,
    stop: vi.fn(),
    stream: null as unknown as MediaStream,
    init() {
      const videoTrack = Object.assign(track, {
        stop: this.stop,
        getSettings: () => ({ deviceId: id }),
      });
      this.stream = {
        getTracks: () => [videoTrack],
        getVideoTracks: () => [videoTrack],
      } as unknown as MediaStream;
      return this;
    },
  }.init();
}
function Harness({ preview = true }: { preview?: boolean }) {
  const { videoRef, phase, error, start, stop } = useQrCamera(detected);
  return (
    <>
      {preview && <video ref={videoRef} />}
      <span>{phase}</span>
      <span>{error}</span>
      <button onClick={() => void start()}>Start</button>
      <button onClick={stop}>Stop</button>
      <button onClick={() => void start("front")}>Switch</button>
    </>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  detected.mockReturnValue(false);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
  });
  vi.mocked(loadQrDecoder).mockResolvedValue(decode);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray(16),
      width: 2,
      height: 2,
    }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("opens only on request, prefers the rear camera, and stops all tracks", async () => {
  const source = media();
  getUserMedia.mockResolvedValue(source.stream);
  render(<Harness />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText("scanning");
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  fireEvent.click(screen.getByText("Stop"));
  expect(source.stop).toHaveBeenCalledTimes(1);
});

it("explains insecure origins without requesting a camera", () => {
  vi.stubGlobal("isSecureContext", false);
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  expect(
    screen.getByText(/Camera access requires a secure connection/),
  ).toBeInTheDocument();
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("explains missing browser camera support without throwing", () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  expect(
    screen.getByText(/does not support camera scanning/),
  ).toBeInTheDocument();
  expect(getUserMedia).not.toHaveBeenCalled();
});
it.each(["NotAllowedError", "NotFoundError", "NotReadableError"])(
  "handles %s without leaving a live camera",
  async (name) => {
    getUserMedia.mockRejectedValue(new DOMException("camera error", name));
    render(<Harness />);
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() =>
      expect(screen.queryByText("starting")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/options below/)).toBeInTheDocument();
    expect(detected).not.toHaveBeenCalled();
  },
);
it("releases a camera granted after the request was cancelled", async () => {
  const source = media();
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Stop"));
  await act(async () => resolve(source.stream));
  expect(source.stop).toHaveBeenCalled();
  expect(screen.getByText("idle")).toBeInTheDocument();
});
it("returns to idle if the preview disappears before camera permission is granted", async () => {
  const source = media();
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  view.rerender(<Harness preview={false} />);
  await act(async () => {
    resolve(source.stream);
  });
  expect(source.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByText("idle")).toBeInTheDocument();
});
it("fails gracefully if the camera track ended before playback completed", async () => {
  const source = media();
  Object.assign(source.track, { readyState: "ended" });
  getUserMedia.mockResolvedValue(source.stream);
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await waitFor(() =>
    expect(screen.queryByText("starting")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("idle")).toBeInTheDocument();
  expect(source.stop).toHaveBeenCalled();
  expect(detected).not.toHaveBeenCalled();
});
it("releases a camera granted after leaving the page", async () => {
  const source = media();
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  view.unmount();
  await act(async () => resolve(source.stream));
  expect(source.stop).toHaveBeenCalled();
});
it("stops the old stream before changing cameras", async () => {
  const rear = media();
  const front = media("front");
  getUserMedia
    .mockResolvedValueOnce(rear.stream)
    .mockResolvedValueOnce(front.stream);
  const view = render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText("scanning");
  fireEvent.click(screen.getByText("Switch"));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  expect(rear.stop).toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenLastCalledWith({
    audio: false,
    video: { deviceId: { exact: "front" } },
  });
  view.unmount();
  expect(front.stop).toHaveBeenCalled();
});
it("stops when the browser tab becomes hidden", async () => {
  const source = media();
  getUserMedia.mockResolvedValue(source.stream);
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText("scanning");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(source.stop).toHaveBeenCalled();
});
it("handles camera disconnection", async () => {
  const source = media();
  getUserMedia.mockResolvedValue(source.stream);
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText("scanning");
  act(() => source.track.dispatchEvent(new Event("ended")));
  expect(source.stop).toHaveBeenCalled();
  expect(screen.getByText(/camera disconnected/)).toBeInTheDocument();
});
it("releases the stream if preview playback fails", async () => {
  const source = media();
  getUserMedia.mockResolvedValue(source.stream);
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
    new Error("playback failed"),
  );
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText(/Unable to start camera/);
  expect(source.stop).toHaveBeenCalled();
});
it("retries unsupported default constraints with any video camera", async () => {
  const source = media();
  getUserMedia
    .mockRejectedValueOnce(
      new DOMException("unsupported", "OverconstrainedError"),
    )
    .mockResolvedValueOnce(source.stream);
  render(<Harness />);
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText("scanning");
  expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
});
it("delivers an accepted QR only once and releases the camera", async () => {
  vi.useFakeTimers();
  const source = media();
  getUserMedia.mockResolvedValue(source.stream);
  decode.mockReturnValue({ data: "order-token" });
  detected.mockReturnValue(true);
  const view = render(<Harness />);
  const node = view.container.querySelector("video")!;
  Object.defineProperties(node, {
    readyState: { value: 2 },
    videoWidth: { value: 2 },
    videoHeight: { value: 2 },
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Start"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(detected).toHaveBeenCalledTimes(1);
  expect(source.stop).toHaveBeenCalledTimes(1);
});
